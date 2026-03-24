import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { organization_id, invoice_ids } = await req.json();
    console.log("📤 Publishing sales invoices to QuickBooks:", { organization_id, invoice_ids });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get QuickBooks credentials
    const { data: qbIntegration, error: qbError } = await supabase
      .from("integration_accounts")
      .select("credentials")
      .eq("organization_id", organization_id)
      .eq("service_type", "quickbooks")
      .eq("is_active", true)
      .single();

    if (qbError || !qbIntegration) {
      throw new Error("QuickBooks not connected");
    }

    const { access_token, realm_id } = qbIntegration.credentials as any;

    // Get invoices to publish
    const { data: invoices, error: invoicesError } = await supabase
      .from("sales_invoices")
      .select("*")
      .eq("organization_id", organization_id)
      .in("id", invoice_ids || []);

    if (invoicesError) throw invoicesError;

    let published = 0;
    let failed = 0;
    const errors: any[] = [];

    for (const invoice of invoices || []) {
      try {
        console.log(`📝 Processing invoice ${invoice.doc_number}...`);

        // 1. Find or create customer
        const customerSearchUrl = `https://quickbooks.api.intuit.com/v3/company/${realm_id}/query?query=SELECT * FROM Customer WHERE DisplayName = '${encodeURIComponent(invoice.customer_name)}'&minorversion=65`;
        
        let customerResponse = await fetch(customerSearchUrl, {
          headers: {
            "Authorization": `Bearer ${access_token}`,
            "Accept": "application/json",
          },
        });

        let customerData = await customerResponse.json();
        let customerId: string;

        if (customerData.QueryResponse?.Customer?.[0]) {
          customerId = customerData.QueryResponse.Customer[0].Id;
          console.log("✅ Customer found:", customerId);
        } else {
          // Create customer
          console.log("🆕 Creating new customer:", invoice.customer_name);
          const createCustomerUrl = `https://quickbooks.api.intuit.com/v3/company/${realm_id}/customer?minorversion=65`;
          
          const newCustomerResponse = await fetch(createCustomerUrl, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${access_token}`,
              "Content-Type": "application/json",
              "Accept": "application/json",
            },
            body: JSON.stringify({
              DisplayName: invoice.customer_name,
              PrimaryEmailAddr: invoice.customer_email ? { Address: invoice.customer_email } : undefined,
              CompanyName: invoice.customer_name,
              Notes: `Tax ID: ${invoice.customer_tax_id || "N/A"}`
            }),
          });

          const newCustomerData = await newCustomerResponse.json();
          customerId = newCustomerData.Customer.Id;
          console.log("✅ Customer created:", customerId);

          // Save customer ID
          await supabase
            .from("customer_defaults")
            .upsert({
              organization_id,
              customer_name: invoice.customer_name,
              customer_tax_id: invoice.customer_tax_id,
              qbo_customer_ref: customerId
            }, {
              onConflict: "organization_id,customer_name"
            });
        }

        await delay(1000);

        // 2. Create QuickBooks Invoice
        const xmlData = invoice.xml_data as any;
        const lineItems = xmlData?.detalles || [];

        const qbInvoiceLines = lineItems.map((item: any, index: number) => ({
          DetailType: "SalesItemLineDetail",
          Amount: item.monto_total || item.total,
          Description: item.detalle || `Line ${index + 1}`,
          SalesItemLineDetail: {
            ItemRef: {
              value: "1", // Default sales item
              name: "Services"
            },
            Qty: item.cantidad || 1,
            UnitPrice: item.precio_unitario || (item.monto_total || item.total),
            TaxCodeRef: invoice.total_tax > 0 ? {
              value: "TAX"
            } : undefined
          }
        }));

        const qbInvoicePayload = {
          CustomerRef: {
            value: customerId
          },
          Line: qbInvoiceLines,
          TxnDate: invoice.issue_date,
          DocNumber: invoice.doc_number,
          PrivateNote: `Imported from GTI - Clave: ${invoice.doc_key}`,
          CurrencyRef: invoice.currency !== "CRC" ? {
            value: invoice.currency,
            name: invoice.currency
          } : undefined,
          ExchangeRate: invoice.exchange_rate || undefined,
          ClassRef: invoice.default_class_ref ? {
            value: invoice.default_class_ref
          } : undefined,
        };

        console.log("📤 Creating QuickBooks Invoice...", qbInvoicePayload);

        const createInvoiceUrl = `https://quickbooks.api.intuit.com/v3/company/${realm_id}/invoice?minorversion=65`;
        const invoiceResponse = await fetch(createInvoiceUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${access_token}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          body: JSON.stringify(qbInvoicePayload),
        });

        if (!invoiceResponse.ok) {
          const errorText = await invoiceResponse.text();
          console.error("❌ QuickBooks Invoice creation failed:", errorText);
          throw new Error(`QuickBooks error: ${errorText}`);
        }

        const invoiceData = await invoiceResponse.json();
        const qboInvoiceId = invoiceData.Invoice.Id;
        console.log("✅ QuickBooks Invoice created:", qboInvoiceId);

        // Update sales_invoice record
        await supabase
          .from("sales_invoices")
          .update({
            qbo_entity_id: qboInvoiceId,
            qbo_entity_type: "Invoice",
            qbo_customer_ref: customerId,
            status: "published",
            error_message: null,
            processed_at: new Date().toISOString()
          })
          .eq("id", invoice.id);

        published++;

        // Auto-send email if customer has email
        if (invoice.customer_email) {
          try {
            console.log(`📧 Auto-sending invoice email to ${invoice.customer_email}...`);
            await supabase.functions.invoke("send-invoice-email", {
              body: {
                invoice_id: invoice.id,
                organization_id,
                to_email: invoice.customer_email,
                include_pdf: !!invoice.pdf_attachment_url,
                invoice_type: "sales",
              },
            });
            console.log(`✅ Email sent to ${invoice.customer_email}`);
          } catch (emailErr: any) {
            console.warn(`⚠️ Email send failed for ${invoice.doc_number}:`, emailErr.message);
          }
        }

        await delay(2000); // Rate limiting

      } catch (error: any) {
        console.error(`❌ Failed to publish invoice ${invoice.doc_number}:`, error);
        failed++;
        errors.push({
          invoice_id: invoice.id,
          doc_number: invoice.doc_number,
          error: error.message
        });

        await supabase
          .from("sales_invoices")
          .update({
            status: "error",
            error_message: error.message,
            retry_count: (invoice.retry_count || 0) + 1
          })
          .eq("id", invoice.id);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        published,
        failed,
        errors: errors.length > 0 ? errors : undefined
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("❌ Publish sales error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});