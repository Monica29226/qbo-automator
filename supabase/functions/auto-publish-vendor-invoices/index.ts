import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Normalizar nombre de vendor para comparación
const normalizeVendorName = (name: string): string => {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const { organization_id, vendor_name, account_code } = await req.json();

    if (!organization_id || !vendor_name || !account_code) {
      throw new Error("organization_id, vendor_name, and account_code are required");
    }

    console.log(`🔄 Auto-publishing invoices for vendor: ${vendor_name} with account: ${account_code}`);

    const normalizedVendorName = normalizeVendorName(vendor_name);

    // Buscar todas las facturas pendientes de este vendor
    const { data: pendingDocs, error: docsError } = await supabase
      .from("processed_documents")
      .select("id, doc_number, supplier_name")
      .eq("organization_id", organization_id)
      .is("qbo_entity_id", null)
      .in("status", ["pending", "pending_config"])
      .gte("issue_date", "2025-11-01");

    if (docsError) {
      console.error("Error fetching pending documents:", docsError);
      throw docsError;
    }

    if (!pendingDocs || pendingDocs.length === 0) {
      console.log("No pending documents found");
      return new Response(
        JSON.stringify({ success: true, message: "No pending invoices for this vendor", updated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filtrar solo las facturas de este vendor (usando normalización)
    const vendorDocs = pendingDocs.filter(doc => 
      normalizeVendorName(doc.supplier_name) === normalizedVendorName
    );

    if (vendorDocs.length === 0) {
      console.log(`No pending invoices for vendor: ${vendor_name}`);
      return new Response(
        JSON.stringify({ success: true, message: "No pending invoices for this vendor", updated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📋 Found ${vendorDocs.length} pending invoices for vendor: ${vendor_name}`);

    // Actualizar todas las facturas con la cuenta configurada
    const docIds = vendorDocs.map(d => d.id);
    
    const { error: updateError } = await supabase
      .from("processed_documents")
      .update({ 
        default_account_ref: account_code,
        status: "pending" // Asegurar que estén listas para publicar
      })
      .in("id", docIds);

    if (updateError) {
      console.error("Error updating documents:", updateError);
      throw updateError;
    }

    console.log(`✅ Updated ${docIds.length} invoices with account: ${account_code}`);

    // Invocar publish-to-quickbooks para publicar automáticamente
    console.log(`📤 Triggering publish-to-quickbooks for ${docIds.length} documents...`);

    const publishResponse = await supabase.functions.invoke("publish-to-quickbooks", {
      body: { 
        organization_id,
        document_ids: docIds
      },
    });

    if (publishResponse.error) {
      console.error("Error publishing to QuickBooks:", publishResponse.error);
      // No lanzar error, ya actualizamos los documentos
      return new Response(
        JSON.stringify({ 
          success: true, 
          updated: docIds.length,
          publish_error: publishResponse.error.message,
          message: `${docIds.length} invoices updated but publishing failed. They will be published in the next batch.`
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const publishResult = publishResponse.data;
    console.log(`✅ Publish result:`, publishResult);

    return new Response(
      JSON.stringify({
        success: true,
        vendor_name,
        updated: docIds.length,
        published: publishResult?.published || 0,
        failed: publishResult?.failed || 0,
        message: `${publishResult?.published || 0} invoices published to QuickBooks`
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in auto-publish-vendor-invoices:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
