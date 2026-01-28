import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Migrates published documents without tracking records to the qbo_publish_tracking table.
 * This ensures all published invoices are properly tracked to prevent duplicates.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { organization_id, limit = 500 } = await req.json();

    console.log(`🔄 Migrating tracking records for org: ${organization_id || 'ALL'}`);

    // Find published documents without tracking records
    let query = supabase
      .from("processed_documents")
      .select(`
        id,
        doc_key,
        doc_number,
        supplier_name,
        supplier_tax_id,
        total_amount,
        currency,
        qbo_entity_id,
        qbo_entity_type,
        organization_id,
        processed_at
      `)
      .not("qbo_entity_id", "is", null)
      .eq("status", "published");

    if (organization_id) {
      query = query.eq("organization_id", organization_id);
    }

    const { data: documents, error: fetchError } = await query.limit(limit);

    if (fetchError) throw fetchError;

    if (!documents || documents.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No documents to migrate", migrated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📄 Found ${documents.length} documents to check for migration`);

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const doc of documents) {
      try {
        const claveHacienda = doc.doc_key || doc.doc_number;

        // Check if tracking record already exists
        const { data: existing } = await supabase
          .from("qbo_publish_tracking")
          .select("id")
          .eq("organization_id", doc.organization_id)
          .eq("clave_hacienda", claveHacienda)
          .maybeSingle();

        if (existing) {
          skipped++;
          continue;
        }

        // Create tracking record
        const { error: insertError } = await supabase
          .from("qbo_publish_tracking")
          .insert({
            organization_id: doc.organization_id,
            clave_hacienda: claveHacienda,
            doc_number: doc.doc_number,
            document_id: doc.id,
            emisor_identificacion: doc.supplier_tax_id || '',
            receptor_identificacion: '',
            qbo_entity_id: doc.qbo_entity_id,
            qbo_entity_type: doc.qbo_entity_type,
            qbo_doc_number: doc.doc_number.length > 21 
              ? doc.doc_number.substring(doc.doc_number.length - 21) 
              : doc.doc_number,
            total_amount: doc.total_amount,
            currency: doc.currency || 'CRC',
            supplier_name: doc.supplier_name,
            status: 'published',
            published_at: doc.processed_at || new Date().toISOString(),
          });

        if (insertError) {
          console.error(`❌ Error inserting tracking for ${doc.doc_number}:`, insertError);
          errors++;
        } else {
          migrated++;
        }
      } catch (e) {
        console.error(`❌ Error processing ${doc.doc_number}:`, e);
        errors++;
      }
    }

    console.log(`✅ Migration complete: ${migrated} migrated, ${skipped} skipped, ${errors} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        migrated,
        skipped,
        errors,
        total_checked: documents.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("❌ Migration error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
