import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    console.error("❌ RESEND_API_KEY not configured");
    return new Response(
      JSON.stringify({ success: false, error: "Email service not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // SECURITY: require authenticated caller
    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const anon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: userData, error: userErr } = await anon.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { invoice_id, organization_id, to_email, subject, include_pdf, invoice_type } = await req.json();

    // Caller must belong to the organization
    if (organization_id) {
      const { data: membership } = await supabase
        .from("organization_members")
        .select("id")
        .eq("user_id", userData.user.id)
        .eq("organization_id", organization_id)
        .eq("is_active", true)
        .maybeSingle();
      if (!membership) {
        return new Response(JSON.stringify({ success: false, error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }


    // Validation
    if (!invoice_id || !organization_id) {
      return new Response(
        JSON.stringify({ success: false, error: "invoice_id and organization_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!to_email || !EMAIL_REGEX.test(to_email)) {
      return new Response(
        JSON.stringify({ success: false, error: "Valid to_email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📧 SEND_START: invoice=${invoice_id}, to=${to_email}, type=${invoice_type || "purchase"}`);

    // Determine table based on invoice type
    const tableName = invoice_type === "sales" ? "sales_invoices" : "processed_documents";
    
    const { data: invoice, error: invoiceError } = await supabase
      .from(tableName)
      .select("*")
      .eq("id", invoice_id)
      .eq("organization_id", organization_id)
      .single();

    if (invoiceError || !invoice) {
      console.error("❌ Invoice not found:", invoiceError);
      return new Response(
        JSON.stringify({ success: false, error: "Invoice not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get organization info for branding
    const { data: org } = await supabase
      .from("organizations")
      .select("name, email, tax_id")
      .eq("id", organization_id)
      .single();

    const orgName = org?.name || "FacturaFlow";
    const docNumber = invoice.doc_number;
    const supplierOrCustomer = invoice_type === "sales" ? invoice.customer_name : invoice.supplier_name;
    const totalAmount = invoice.total_amount;
    const currency = invoice.currency || "CRC";
    const issueDate = invoice.issue_date;
    const subtotal = invoice_type === "sales" ? invoice.subtotal : (totalAmount - (invoice.total_tax || 0));
    const totalTax = invoice.total_tax || 0;

    const emailSubject = subject || `Factura ${docNumber} - ${orgName}`;

    // Build HTML email
    const formattedTotal = new Intl.NumberFormat('es-CR', {
      style: 'currency',
      currency: currency === 'USD' ? 'USD' : 'CRC',
      minimumFractionDigits: 2,
    }).format(totalAmount);

    const formattedSubtotal = new Intl.NumberFormat('es-CR', {
      style: 'currency',
      currency: currency === 'USD' ? 'USD' : 'CRC',
      minimumFractionDigits: 2,
    }).format(subtotal);

    const formattedTax = new Intl.NumberFormat('es-CR', {
      style: 'currency',
      currency: currency === 'USD' ? 'USD' : 'CRC',
      minimumFractionDigits: 2,
    }).format(totalTax);

    const htmlContent = buildInvoiceEmailHtml({
      orgName,
      docNumber,
      recipientName: supplierOrCustomer,
      issueDate,
      subtotal: formattedSubtotal,
      tax: formattedTax,
      total: formattedTotal,
      currency,
    });

    // Build Resend payload
    const resendPayload: any = {
      from: `${orgName} <facturacion@cemsacr.com>`,
      to: [to_email],
      subject: emailSubject,
      html: htmlContent,
    };

    // If include_pdf and PDF exists, fetch and attach
    if (include_pdf && invoice.pdf_attachment_url) {
      try {
        console.log("📎 Fetching PDF attachment...");
        const pdfResponse = await fetch(invoice.pdf_attachment_url);
        if (pdfResponse.ok) {
          const pdfBuffer = await pdfResponse.arrayBuffer();
          const pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(pdfBuffer)));
          resendPayload.attachments = [{
            filename: `Factura_${docNumber}.pdf`,
            content: pdfBase64,
          }];
          console.log("✅ PDF attached successfully");
        } else {
          console.warn("⚠️ Could not fetch PDF, sending without attachment");
        }
      } catch (pdfErr) {
        console.warn("⚠️ PDF attachment error:", pdfErr);
      }
    }

    // Send via Resend API
    console.log("📤 Sending email via Resend...");
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendPayload),
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error("❌ Resend ERROR:", resendData);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: resendData.message || "Failed to send email",
          details: resendData 
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const messageId = resendData.id;
    console.log(`✅ SUCCESS: message_id=${messageId}, to=${to_email}`);

    // Update invoice with email_sent_at (best effort, don't fail if column doesn't exist)
    try {
      await supabase
        .from(tableName)
        .update({ updated_at: new Date().toISOString() })
        .eq("id", invoice_id);
    } catch (updateErr) {
      console.warn("⚠️ Could not update invoice timestamp:", updateErr);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message_id: messageId,
        to: to_email,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("❌ send-invoice-email error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function buildInvoiceEmailHtml(params: {
  orgName: string;
  docNumber: string;
  recipientName: string;
  issueDate: string;
  subtotal: string;
  tax: string;
  total: string;
  currency: string;
}): string {
  const { orgName, docNumber, recipientName, issueDate, subtotal, tax, total, currency } = params;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f4f6f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f6f9; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1a365d 0%, #2c5282 100%); padding: 32px 40px; text-align: center;">
              <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 600;">${orgName}</h1>
              <p style="color: #e2e8f0; font-size: 14px; margin: 8px 0 0 0;">Factura Electrónica</p>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <p style="color: #4a5568; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                Estimado(a) <strong>${recipientName}</strong>,
              </p>
              <p style="color: #4a5568; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">
                Adjunto encontrará la factura electrónica correspondiente.
              </p>
              
              <!-- Invoice Details -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f7fafc; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 20px 24px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" style="width: 100%;">
                      <tr>
                        <td style="padding: 6px 0; color: #718096; font-size: 14px;">Factura N°:</td>
                        <td style="padding: 6px 0; color: #1a365d; font-size: 14px; font-weight: 600; text-align: right;">${docNumber}</td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; color: #718096; font-size: 14px;">Fecha:</td>
                        <td style="padding: 6px 0; color: #1a365d; font-size: 14px; text-align: right;">${issueDate}</td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; color: #718096; font-size: 14px;">Moneda:</td>
                        <td style="padding: 6px 0; color: #1a365d; font-size: 14px; text-align: right;">${currency}</td>
                      </tr>
                      <tr><td colspan="2" style="border-bottom: 1px solid #e2e8f0; padding: 4px 0;"></td></tr>
                      <tr>
                        <td style="padding: 6px 0; color: #718096; font-size: 14px;">Subtotal:</td>
                        <td style="padding: 6px 0; color: #1a365d; font-size: 14px; text-align: right;">${subtotal}</td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; color: #718096; font-size: 14px;">Impuesto:</td>
                        <td style="padding: 6px 0; color: #1a365d; font-size: 14px; text-align: right;">${tax}</td>
                      </tr>
                      <tr><td colspan="2" style="border-bottom: 2px solid #2c5282; padding: 4px 0;"></td></tr>
                      <tr>
                        <td style="padding: 8px 0; color: #1a365d; font-size: 16px; font-weight: 700;">Total:</td>
                        <td style="padding: 8px 0; color: #1a365d; font-size: 16px; font-weight: 700; text-align: right;">${total}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="color: #a0aec0; font-size: 12px; text-align: center; margin: 24px 0 0 0;">
                Este correo fue enviado automáticamente desde ${orgName}. Por favor no responder a este correo.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
