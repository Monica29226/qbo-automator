import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-gti-signature",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const payload = await req.json();
    console.log("📥 GTI Webhook received:", payload);

    // Extract invoice data from GTI webhook payload
    const {
      clave, // Invoice key
      numero, // Invoice number
      tipo, // Document type (FE, FEC, etc.)
      fecha, // Issue date
      emisor, // Customer info (this is the EMISOR because we're receiving sales invoices)
      receptor, // Our company info
      resumen, // Financial summary
      detalles, // Line items
      xml_data,
      pdf_url,
      xml_url
    } = payload;

    // Find organization by receptor tax ID
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("id, name, tax_id")
      .eq("tax_id", receptor.identificacion)
      .single();

    if (orgError || !org) {
      console.error("❌ Organization not found for tax_id:", receptor.identificacion);
      return new Response(
        JSON.stringify({ error: "Organization not found", tax_id: receptor.identificacion }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("✅ Organization found:", org.name);

    // Check for duplicate invoice
    const { data: existing } = await supabase
      .from("sales_invoices")
      .select("id")
      .eq("organization_id", org.id)
      .eq("doc_key", clave)
      .maybeSingle();

    if (existing) {
      console.log("⚠️ Duplicate invoice, skipping:", clave);
      return new Response(
        JSON.stringify({ message: "Invoice already exists", id: existing.id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert sales invoice
    const { data: invoice, error: insertError } = await supabase
      .from("sales_invoices")
      .insert({
        organization_id: org.id,
        doc_key: clave,
        doc_number: numero,
        doc_type: tipo,
        issue_date: fecha,
        customer_name: emisor.nombre,
        customer_tax_id: emisor.identificacion,
        customer_email: emisor.correo,
        currency: resumen.moneda || "CRC",
        exchange_rate: resumen.tipo_cambio,
        subtotal: resumen.total_gravado + resumen.total_exento,
        total_tax: resumen.total_impuesto,
        total_discount: resumen.total_descuentos || 0,
        total_amount: resumen.total_comprobante,
        xml_data: { detalles, resumen, ...xml_data },
        xml_attachment_url: xml_url,
        pdf_attachment_url: pdf_url,
        status: "pending" // Will check for customer defaults next
      })
      .select()
      .single();

    if (insertError) {
      console.error("❌ Error inserting sales invoice:", insertError);
      throw insertError;
    }

    console.log("✅ Sales invoice created:", invoice.id);

    // Check if customer has default configuration
    const { data: customerDefaults } = await supabase
      .from("customer_defaults")
      .select("*")
      .eq("organization_id", org.id)
      .eq("customer_name", emisor.nombre)
      .maybeSingle();

    if (customerDefaults && customerDefaults.default_income_account_ref) {
      // Customer has defaults, update invoice and trigger auto-publish
      const { error: updateError } = await supabase
        .from("sales_invoices")
        .update({
          default_income_account_ref: customerDefaults.default_income_account_ref,
          default_class_ref: customerDefaults.default_class_ref,
          payment_terms_ref: customerDefaults.payment_terms_ref,
          status: "pending" // Ready for auto-publish
        })
        .eq("id", invoice.id);

      if (updateError) {
        console.error("❌ Error updating invoice with defaults:", updateError);
      } else {
        console.log("✅ Invoice updated with customer defaults, ready for auto-publish");
        
        // Trigger auto-publish to QuickBooks
        const { error: publishError } = await supabase.functions.invoke("publish-sales-to-quickbooks", {
          body: { organization_id: org.id, invoice_ids: [invoice.id] }
        });

        if (publishError) {
          console.error("❌ Error auto-publishing invoice:", publishError);
        } else {
          console.log("✅ Invoice auto-published to QuickBooks");
        }
      }
    } else {
      // Customer needs configuration
      console.log("⚠️ Customer needs configuration:", emisor.nombre);
      await supabase
        .from("sales_invoices")
        .update({ status: "pending_config" })
        .eq("id", invoice.id);
    }

    return new Response(
      JSON.stringify({ success: true, invoice_id: invoice.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("❌ GTI Webhook error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});