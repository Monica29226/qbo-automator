import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-gti-signature, x-webhook-timestamp",
};

// ========== SECURITY: HMAC signature verification ==========
async function verifyWebhookSignature(
  payload: string, 
  signature: string | null, 
  secret: string
): Promise<boolean> {
  if (!signature || !secret) return false;
  
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );
    
    const signatureBuffer = new Uint8Array(
      signature.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
    );
    
    return await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBuffer,
      encoder.encode(payload)
    );
  } catch (error) {
    console.error("Signature verification error:", error);
    return false;
  }
}

// ========== SECURITY: Replay protection ==========
async function checkReplayProtection(
  supabase: any, 
  timestamp: string | null, 
  requestId: string
): Promise<{ valid: boolean; error?: string }> {
  // Check timestamp is within 5 minutes
  if (timestamp) {
    const requestTime = new Date(timestamp).getTime();
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    
    if (Math.abs(now - requestTime) > fiveMinutes) {
      return { valid: false, error: "Request timestamp too old" };
    }
  }
  
  // Check for duplicate request ID
  const { data: existing } = await supabase
    .from("rate_limits")
    .select("id")
    .eq("identifier", requestId)
    .eq("endpoint", "gti-webhook")
    .maybeSingle();
  
  if (existing) {
    return { valid: false, error: "Duplicate request" };
  }
  
  // Store request ID for replay protection
  await supabase.from("rate_limits").insert({
    identifier: requestId,
    endpoint: "gti-webhook",
    window_start: new Date().toISOString()
  });
  
  return { valid: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const gtiWebhookSecret = Deno.env.get("GTI_WEBHOOK_SECRET");
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get raw body for signature verification
    const rawBody = await req.text();
    const payload = JSON.parse(rawBody);
    
    // ========== SECURITY: Verify webhook signature if secret is configured ==========
    const signature = req.headers.get("x-gti-signature");
    if (gtiWebhookSecret) {
      const isValidSignature = await verifyWebhookSignature(rawBody, signature, gtiWebhookSecret);
      if (!isValidSignature) {
        console.error("❌ Invalid webhook signature");
        return new Response(
          JSON.stringify({ error: "Invalid signature" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      console.log("✅ Webhook signature verified");
    } else {
      console.warn("⚠️ GTI_WEBHOOK_SECRET not configured - signature verification skipped");
    }

    // ========== SECURITY: Replay protection ==========
    const timestamp = req.headers.get("x-webhook-timestamp");
    const requestId = payload.clave || `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    const replayCheck = await checkReplayProtection(supabase, timestamp, requestId);
    if (!replayCheck.valid) {
      console.error("❌ Replay protection failed:", replayCheck.error);
      return new Response(
        JSON.stringify({ error: replayCheck.error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
        JSON.stringify({ error: "Organization not found" }),
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
    // Log full details server-side only; never expose internal error messages to callers
    console.error("❌ GTI Webhook error:", error?.message, error?.stack);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});