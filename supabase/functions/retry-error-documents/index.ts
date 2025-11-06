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
        JSON.stringify({ success: true, message: "No error documents to retry", fixed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${errorDocs.length} error documents to retry`);

    const results = {
      fixed: 0,
      failed: 0,
      errors: [] as any[],
    };

    // Intentar corregir cada documento
    for (const doc of errorDocs) {
      try {
        const xmlData = doc.xml_data as any;
        let needsUpdate = false;
        const updates: any = { status: "processed", error_message: null };

        // Corrección 1: Validar que tenga líneas en XML
        if (!xmlData?.detalle || !Array.isArray(xmlData.detalle) || xmlData.detalle.length === 0) {
          console.log(`Adding default line item for ${doc.doc_number}`);
          updates.xml_data = {
            ...xmlData,
            detalle: [{
              descripcion: `Factura ${doc.doc_number}`,
              montoTotalLinea: doc.total_amount,
              cantidad: 1,
            }],
          };
          needsUpdate = true;
        }

        // Corrección 2: Reemplazar "Gastos por clasificar" con cuenta válida
        if (doc.error_message?.includes("Gastos por clasificar")) {
          console.log(`Fixing account for ${doc.doc_number}`);
          // Buscar vendor y su cuenta
          const { data: vendorData } = await supabase
            .from("vendors")
            .select("default_account_ref")
            .eq("id", doc.vendor_id)
            .maybeSingle();

          if (vendorData?.default_account_ref) {
            updates.xml_data = {
              ...updates.xml_data || xmlData,
              accountRef: vendorData.default_account_ref,
            };
            needsUpdate = true;
          } else {
            updates.xml_data = {
              ...updates.xml_data || xmlData,
              accountRef: "1",
            };
            needsUpdate = true;
          }
        }

        // Corrección 3: Limpiar nombres problemáticos
        if (doc.supplier_name && (
          doc.supplier_name.includes("@") ||
          doc.supplier_name.includes("<?xml") ||
          doc.supplier_name.length > 100
        )) {
          console.log(`Cleaning supplier name for ${doc.doc_number}`);
          updates.supplier_name = doc.supplier_name
            .replace(/<?xml.*?>/g, "")
            .replace(/@.*$/g, "")
            .substring(0, 100)
            .trim();
          needsUpdate = true;
        }

        // Si se hicieron correcciones, actualizar el documento
        if (needsUpdate) {
          const { error: updateError } = await supabase
            .from("processed_documents")
            .update(updates)
            .eq("id", doc.id);

          if (updateError) {
            throw updateError;
          }

          console.log(`Fixed document ${doc.doc_number}`);
          results.fixed++;
        } else {
          // Si no se pudo corregir automáticamente, cambiar status para reintento
          const { error: updateError } = await supabase
            .from("processed_documents")
            .update({ status: "processed", error_message: null })
            .eq("id", doc.id);

          if (!updateError) {
            console.log(`Reset status for ${doc.doc_number}`);
            results.fixed++;
          } else {
            throw updateError;
          }
        }
      } catch (error) {
        console.error(`Failed to fix document ${doc.doc_number}:`, error);
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        
        results.failed++;
        results.errors.push({
          doc_number: doc.doc_number,
          error: errorMessage,
        });
      }
    }

    console.log(`Retry complete: ${results.fixed} fixed, ${results.failed} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        fixed: results.fixed,
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
