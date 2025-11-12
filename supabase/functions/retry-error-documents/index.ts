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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (authError || !user) {
      throw new Error("Authentication failed");
    }

    const { organization_id, document_ids } = await req.json();

    if (!organization_id) {
      throw new Error("organization_id is required");
    }

    console.log(`Retrying error documents for organization: ${organization_id}`);

    // Obtener documentos con error
    let query = supabase
      .from("processed_documents")
      .select("*")
      .eq("organization_id", organization_id)
      .eq("status", "error");

    if (document_ids && document_ids.length > 0) {
      query = query.in("id", document_ids);
    }

    const { data: errorDocs, error: fetchError } = await query;

    if (fetchError) throw fetchError;

    if (!errorDocs || errorDocs.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No error documents to retry", fixed: 0, published: 0, skipped: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${errorDocs.length} error documents to retry`);

    const results = {
      fixed: 0,
      published: 0,
      skipped_duplicates: 0,
      failed: 0,
      errors: [] as any[],
    };

    // Intentar re-procesar y publicar cada documento
    for (const doc of errorDocs) {
      console.log(`\n=== Processing document ${doc.doc_number} ===`);
      
      try {
        // Detectar duplicados - skip y marcar como publicado
        if (doc.error_message?.includes("duplicate") || doc.error_message?.includes("duplicado")) {
          console.log(`✓ Duplicate detected: ${doc.doc_number} - marking as published (skip)`);
          
          await supabase
            .from("processed_documents")
            .update({ 
              status: "published",
              error_message: "Documento duplicado - ya existe en QuickBooks"
            })
            .eq("id", doc.id);
          
          results.skipped_duplicates++;
          continue;
        }

        // Re-procesar el documento con el nuevo flujo XML
        console.log(`→ Re-processing document with XML parser: ${doc.doc_number}`);
        
        // Primero, eliminar el documento con error de la BD
        await supabase
          .from("processed_documents")
          .delete()
          .eq("id", doc.id);

        // Re-procesar usando process-document-xml si hay xml_attachment_url
        if (doc.xml_attachment_url) {
          try {
            // Descargar el XML
            const xmlResponse = await fetch(doc.xml_attachment_url);
            if (!xmlResponse.ok) {
              throw new Error(`Failed to fetch XML: ${xmlResponse.statusText}`);
            }
            const xmlContent = await xmlResponse.text();

            // Re-procesar con process-document-xml
            const { data: reprocessData, error: reprocessError } = await supabase.functions.invoke(
              "process-document-xml",
              {
                body: {
                  organization_id: organization_id,
                  xml_content: xmlContent,
                  pdf_url: doc.pdf_attachment_url,
                  xml_url: doc.xml_attachment_url,
                },
              }
            );

            if (reprocessError) throw reprocessError;

            if (reprocessData?.success && reprocessData?.documentId) {
              console.log(`✓ Document re-processed: ${doc.doc_number}`);
              results.fixed++;

              // Ahora intentar publicar el nuevo documento
              const { data: publishData, error: publishError } = await supabase.functions.invoke(
                "publish-to-quickbooks",
                {
                  body: {
                    organization_id: organization_id,
                    document_ids: [reprocessData.documentId],
                  },
                  headers: {
                    Authorization: authHeader,
                  },
                }
              );

              if (publishError) throw publishError;

              if (publishData?.published > 0) {
                console.log(`✓ Successfully published: ${doc.doc_number}`);
                results.published++;
              } else if (publishData?.failed > 0) {
                console.log(`✗ Publication failed: ${doc.doc_number}`);
                const errorMsg = publishData.errors?.[0]?.error || "Unknown publication error";
                results.failed++;
                results.errors.push({
                  doc_number: doc.doc_number,
                  error: errorMsg,
                });
              }
            } else {
              throw new Error(reprocessData?.error || "Re-processing failed");
            }
          } catch (xmlError: any) {
            console.error(`✗ Error re-processing ${doc.doc_number}:`, xmlError);
            
            // Restaurar el documento con error
            await supabase
              .from("processed_documents")
              .insert({
                ...doc,
                error_message: `Re-processing failed: ${xmlError.message}`,
              });
            
            results.failed++;
            results.errors.push({
              doc_number: doc.doc_number,
              error: xmlError.message,
            });
          }
        } else {
          console.log(`⚠ No XML URL found for ${doc.doc_number}, skipping`);
          
          // Restaurar el documento
          await supabase
            .from("processed_documents")
            .insert(doc);
          
          results.failed++;
          results.errors.push({
            doc_number: doc.doc_number,
            error: "No XML URL available for re-processing",
          });
        }

      } catch (error) {
        console.error(`✗ Failed to process document ${doc.doc_number}:`, error);
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        
        results.failed++;
        results.errors.push({
          doc_number: doc.doc_number,
          error: errorMessage,
        });
      }
    }

    console.log(`\n=== Retry Summary ===`);
    console.log(`Fixed: ${results.fixed}`);
    console.log(`Published: ${results.published}`);
    console.log(`Skipped (duplicates): ${results.skipped_duplicates}`);
    console.log(`Failed: ${results.failed}`);

    return new Response(
      JSON.stringify({
        success: true,
        fixed: results.fixed,
        published: results.published,
        skipped_duplicates: results.skipped_duplicates,
        failed: results.failed,
        errors: results.errors.length > 0 ? results.errors : undefined,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in retry-error-documents:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
