import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { organization_id } = await req.json();

    if (!organization_id) {
      throw new Error("organization_id is required");
    }

    console.log(`🔄 Smart retry started for organization: ${organization_id}`);

    // 1. Obtener facturas con error de "cuenta contable"
    const { data: errorDocs, error: errorDocsError } = await supabase
      .from("processed_documents")
      .select("*")
      .eq("organization_id", organization_id)
      .eq("status", "error")
      .ilike("error_message", "%cuenta contable%");

    if (errorDocsError) {
      throw errorDocsError;
    }

    if (!errorDocs || errorDocs.length === 0) {
      return new Response(
        JSON.stringify({ 
          message: "No error documents found",
          resolved: 0,
          still_errors: 0
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📋 Found ${errorDocs.length} documents with account classification errors`);

    // 2. Para cada proveedor con error, buscar facturas exitosas del mismo proveedor
    const resolvedDocs = [];
    const stillErrors = [];

    for (const errorDoc of errorDocs) {
      console.log(`\n🔍 Processing: ${errorDoc.doc_number} - ${errorDoc.supplier_name}`);

      // Buscar facturas publicadas exitosamente del mismo proveedor
      const { data: successfulDocs, error: successError } = await supabase
        .from("processed_documents")
        .select("*")
        .eq("organization_id", organization_id)
        .eq("supplier_tax_id", errorDoc.supplier_tax_id)
        .eq("status", "published")
        .not("qbo_entity_id", "is", null)
        .limit(1);

      if (successError) {
        console.error(`Error searching successful docs for ${errorDoc.supplier_name}:`, successError);
        stillErrors.push(errorDoc);
        continue;
      }

      if (!successfulDocs || successfulDocs.length === 0) {
        console.log(`❌ No successful invoices found for ${errorDoc.supplier_name} (${errorDoc.supplier_tax_id})`);
        stillErrors.push(errorDoc);
        continue;
      }

      const successfulDoc = successfulDocs[0];
      console.log(`✅ Found successful invoice: ${successfulDoc.doc_number} with vendor_id: ${successfulDoc.vendor_id}`);

      // 3. Buscar configuración del vendor exitoso
      const { data: vendor, error: vendorError } = await supabase
        .from("vendors")
        .select("*")
        .eq("id", successfulDoc.vendor_id)
        .maybeSingle();

      if (vendorError || !vendor) {
        console.error(`Error fetching vendor configuration:`, vendorError);
        stillErrors.push(errorDoc);
        continue;
      }

      console.log(`📝 Applying configuration from vendor: ${vendor.vendor_name}`);
      console.log(`   - Account: ${vendor.default_account_ref}`);
      console.log(`   - Tax rate: ${vendor.tax_rate}%`);

      // 4. Crear o actualizar regla de clasificación automática
      const { error: ruleError } = await supabase
        .from("vendor_classification_rules")
        .upsert({
          organization_id,
          vendor_name: errorDoc.supplier_name,
          account_code: vendor.default_account_ref,
          account_description: `Auto-learned from successful invoice ${successfulDoc.doc_number}`,
          is_active: true,
          created_by: null,
        }, {
          onConflict: "organization_id,vendor_name",
        });

      if (ruleError) {
        console.error(`Error creating classification rule:`, ruleError);
      } else {
        console.log(`✅ Classification rule created for ${errorDoc.supplier_name}`);
      }

      // 5. Actualizar el documento con error para usar el mismo vendor_id
      const { error: updateError } = await supabase
        .from("processed_documents")
        .update({
          vendor_id: vendor.id,
          status: "pending",
          error_message: null,
          retry_count: (errorDoc.retry_count || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", errorDoc.id);

      if (updateError) {
        console.error(`Error updating document:`, updateError);
        stillErrors.push(errorDoc);
        continue;
      }

      console.log(`✅ Document ${errorDoc.doc_number} updated to pending status`);
      resolvedDocs.push(errorDoc);
    }

    // 6. Intentar publicar los documentos resueltos
    if (resolvedDocs.length > 0) {
      console.log(`\n📤 Attempting to publish ${resolvedDocs.length} resolved documents...`);
      
      const { data: publishResult, error: publishError } = await supabase.functions.invoke(
        "publish-to-quickbooks",
        {
          body: {
            organization_id,
            document_ids: resolvedDocs.map(d => d.id),
          },
        }
      );

      if (publishError) {
        console.error("Error publishing documents:", publishError);
      } else {
        console.log("✅ Publish result:", publishResult);
      }
    }

    const summary = {
      total_errors_found: errorDocs.length,
      resolved: resolvedDocs.length,
      still_errors: stillErrors.length,
      resolved_suppliers: [...new Set(resolvedDocs.map(d => d.supplier_name))],
      pending_suppliers: [...new Set(stillErrors.map(d => d.supplier_name))],
    };

    console.log("\n📊 Smart Retry Summary:", summary);

    return new Response(
      JSON.stringify(summary),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("❌ Smart retry error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
