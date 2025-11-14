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
    const { document_ids, organization_id } = await req.json();

    console.log(`📦 Republishing from extracted data for org: ${organization_id}`);
    console.log(`📄 Document IDs: ${document_ids?.length || 'all errors'}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Build query
    let query = supabase
      .from("processed_documents")
      .select("*")
      .eq("organization_id", organization_id)
      .eq("status", "error")
      .not("xml_data", "is", null); // Solo documentos con datos extraídos

    if (document_ids && document_ids.length > 0) {
      query = query.in("id", document_ids);
    }

    const { data: documents, error: fetchError } = await query;

    if (fetchError) {
      throw fetchError;
    }

    if (!documents || documents.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "No se encontraron documentos con datos extraídos para republicar",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`✅ Found ${documents.length} documents with extracted data`);

    const results = {
      published: 0,
      failed: 0,
      skipped: 0,
      errors: [] as any[],
    };

    // Procesar cada documento
    for (const doc of documents) {
      try {
        console.log(`\n📄 Processing: ${doc.doc_number}`);

        // Verificar que tenga xml_data
        if (!doc.xml_data) {
          console.log(`⚠️ Skipping ${doc.doc_number}: No xml_data available`);
          results.skipped++;
          continue;
        }

        // Resetear status y error_message antes de republicar
        const { error: updateError } = await supabase
          .from("processed_documents")
          .update({
            status: "processed",
            error_message: null,
            retry_count: 0,
            updated_at: new Date().toISOString(),
          })
          .eq("id", doc.id);

        if (updateError) {
          console.error(`❌ Failed to reset document status:`, updateError);
          results.failed++;
          results.errors.push({
            doc_number: doc.doc_number,
            error: updateError.message,
          });
          continue;
        }

        console.log(`✅ Document ${doc.doc_number} reset to 'processed' status`);
        results.published++;

      } catch (error: any) {
        console.error(`❌ Error processing ${doc.doc_number}:`, error);
        results.failed++;
        results.errors.push({
          doc_number: doc.doc_number,
          error: error.message,
        });

        // Marcar documento con error específico
        await supabase
          .from("processed_documents")
          .update({
            error_message: `Error al republicar: ${error.message}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", doc.id);
      }
    }

    // Ahora invocar publish-to-quickbooks para publicar los documentos reseteados
    console.log(`\n📤 Invoking publish-to-quickbooks for ${results.published} documents...`);
    
    const { data: publishResult, error: publishError } = await supabase.functions.invoke(
      "publish-to-quickbooks",
      {
        body: { organization_id },
      }
    );

    if (publishError) {
      console.error("❌ Error invoking publish-to-quickbooks:", publishError);
    } else {
      console.log("✅ Publish result:", publishResult);
    }

    console.log(`\n📊 Final Results:`);
    console.log(`  ✅ Published: ${results.published}`);
    console.log(`  ❌ Failed: ${results.failed}`);
    console.log(`  ⏭️  Skipped: ${results.skipped}`);

    return new Response(
      JSON.stringify({
        success: true,
        results,
        message: `Republicación completada: ${results.published} exitosos, ${results.failed} fallidos, ${results.skipped} omitidos`,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error("❌ Fatal error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
