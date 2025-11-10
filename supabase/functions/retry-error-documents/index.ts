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

    // Intentar corregir y publicar cada documento
    for (const doc of errorDocs) {
      console.log(`\n=== Processing document ${doc.doc_number} ===`);
      
      try {
        const xmlData = doc.xml_data as any;
        let needsUpdate = false;
        const updates: any = {};

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

        // Corrección 1: Validar que tenga líneas en XML
        if (!xmlData?.detalle || !Array.isArray(xmlData.detalle) || xmlData.detalle.length === 0) {
          console.log(`→ Adding default line item for ${doc.doc_number}`);
          updates.xml_data = {
            ...xmlData,
            detalle: [{
              descripcion: `Factura ${doc.doc_number}`,
              montoTotalLinea: doc.total_amount,
              cantidad: 1,
            }],
          };
          needsUpdate = true;
        } else {
          updates.xml_data = xmlData;
        }

        // Corrección 2: Clasificar proveedor si es null
        if (!doc.vendor_id && doc.supplier_name) {
          console.log(`→ Classifying vendor for ${doc.doc_number}: ${doc.supplier_name}`);
          
          try {
            const { data: classifyData } = await supabase.functions.invoke("classify-vendor", {
              body: {
                organization_id: organization_id,
                supplier: {
                  nombre: doc.supplier_name,
                  identificacion: doc.supplier_tax_id || "",
                  email: doc.supplier_email || "",
                },
                xmlData: updates.xml_data || xmlData,
              },
            });

            if (classifyData?.vendorId) {
              console.log(`✓ Vendor classified: ${classifyData.vendorId}`);
              updates.vendor_id = classifyData.vendorId;
              needsUpdate = true;
            } else {
              console.log(`⚠ Could not classify vendor, will use default account`);
            }
          } catch (classifyError) {
            console.error(`⚠ Vendor classification failed:`, classifyError);
          }
        }

        // Corrección 3: Asegurar cuenta contable usando las reglas de clasificación
        const currentXmlData = updates.xml_data || xmlData;
        if (!currentXmlData?.accountRef || currentXmlData.accountRef === "Gastos por clasificar") {
          console.log(`→ Setting account for ${doc.doc_number}`);
          
          let accountRef = "80"; // Default QuickBooks: "Uncategorized Expense"
          
          // Primero intentar con el vendor_id
          if (updates.vendor_id || doc.vendor_id) {
            const { data: vendorData } = await supabase
              .from("vendors")
              .select("default_account_ref")
              .eq("id", updates.vendor_id || doc.vendor_id)
              .maybeSingle();

            if (vendorData?.default_account_ref) {
              accountRef = vendorData.default_account_ref;
            }
          }
          
          // Si no hay cuenta del vendor, buscar en reglas de clasificación
          if (!accountRef || accountRef === "80") {
            const { data: classificationRule } = await supabase
              .from("vendor_classification_rules")
              .select("account_code")
              .eq("organization_id", organization_id)
              .ilike("vendor_name", doc.supplier_name)
              .eq("is_active", true)
              .maybeSingle();
            
            if (classificationRule?.account_code) {
              // Extraer solo el código numérico (ej: "5105" de "5105 Costo de ventas")
              accountRef = classificationRule.account_code.split(" ")[0];
              console.log(`✓ Using account from classification rule: ${accountRef}`);
            }
          }
          
          updates.xml_data = {
            ...currentXmlData,
            accountRef: accountRef,
          };
          needsUpdate = true;
        }

        // Corrección 4: Limpiar nombres problemáticos
        if (doc.supplier_name && (
          doc.supplier_name.includes("@") ||
          doc.supplier_name.includes("<?xml") ||
          doc.supplier_name.length > 100
        )) {
          console.log(`→ Cleaning supplier name for ${doc.doc_number}`);
          updates.supplier_name = doc.supplier_name
            .replace(/<?xml.*?>/g, "")
            .replace(/@.*$/g, "")
            .substring(0, 100)
            .trim();
          needsUpdate = true;
        }

        // Actualizar documento con correcciones
        if (needsUpdate) {
          updates.status = "processed";
          updates.error_message = null;
          
          const { error: updateError } = await supabase
            .from("processed_documents")
            .update(updates)
            .eq("id", doc.id);

          if (updateError) {
            throw updateError;
          }

          console.log(`✓ Document corrected: ${doc.doc_number}`);
          results.fixed++;
        }

        // Intentar publicar a QuickBooks
        console.log(`→ Publishing to QuickBooks: ${doc.doc_number}`);
        
        try {
          const { data: publishData, error: publishError } = await supabase.functions.invoke(
            "publish-to-quickbooks",
            {
              body: {
                organization_id: organization_id,
                document_ids: [doc.id],
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
            
            await supabase
              .from("processed_documents")
              .update({
                status: "error",
                error_message: errorMsg,
              })
              .eq("id", doc.id);
            
            results.failed++;
            results.errors.push({
              doc_number: doc.doc_number,
              error: errorMsg,
            });
          }
        } catch (publishError: any) {
          console.error(`✗ Error publishing ${doc.doc_number}:`, publishError);
          
          const errorMsg = publishError.message || "Error al publicar en QuickBooks";
          
          await supabase
            .from("processed_documents")
            .update({
              status: "error",
              error_message: errorMsg,
            })
            .eq("id", doc.id);
          
          results.failed++;
          results.errors.push({
            doc_number: doc.doc_number,
            error: errorMsg,
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
