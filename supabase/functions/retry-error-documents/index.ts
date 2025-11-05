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

    const { data: errorDocs, error: docError } = await query;

    if (docError) throw docError;

    if (!errorDocs || errorDocs.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No error documents to retry", fixed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${errorDocs.length} error documents`);

    const results = {
      fixed: 0,
      stillFailed: 0,
      errors: [] as any[],
    };

    // Obtener configuración de cuenta por defecto
    const { data: settings } = await supabase
      .from("system_settings")
      .select("value")
      .eq("organization_id", organization_id)
      .eq("key", "default_expense_account")
      .maybeSingle();

    const defaultAccountId = settings?.value || "1"; // Cuenta por defecto

    for (const doc of errorDocs) {
      try {
        console.log(`Processing error document: ${doc.doc_number}`);
        
        let needsUpdate = false;
        let newStatus = doc.status;
        let newDocNumber = doc.doc_number;
        const xmlData = doc.xml_data as any;

        // FIX 1: Acortar número de factura si es muy largo
        if (doc.doc_number.length > 21) {
          newDocNumber = doc.doc_number.substring(0, 21);
          needsUpdate = true;
          console.log(`Shortened doc number from ${doc.doc_number.length} to 21 chars`);
        }

        // FIX 2: Crear línea por defecto si no hay detalle
        if (!xmlData?.detalle || xmlData.detalle.length === 0) {
          if (doc.total_amount > 0) {
            xmlData.detalle = [{
              descripcion: `Factura ${newDocNumber}`,
              cantidad: 1,
              precioUnitario: doc.total_amount,
              montoTotalLinea: doc.total_amount,
              tarifa: 0,
              montoDescuento: 0,
            }];
            needsUpdate = true;
            console.log(`Created default line item for ${newDocNumber}`);
          }
        }

        // FIX 3: Reemplazar cuenta "Gastos por clasificar" con ID numérico
        if (xmlData?.cuentaContable === "Gastos por clasificar") {
          xmlData.cuentaContable = defaultAccountId;
          needsUpdate = true;
          console.log(`Updated account from 'Gastos por clasificar' to ${defaultAccountId}`);
        }

        // FIX 4: Limpiar nombre de vendor problemático
        let cleanSupplierName = doc.supplier_name;
        if (doc.supplier_name.match(/^\d-\d+-\d+/)) {
          // Si el nombre empieza con formato de cédula, usar identificacion del XML
          if (xmlData?.emisor?.nombre) {
            cleanSupplierName = xmlData.emisor.nombre;
            needsUpdate = true;
            console.log(`Updated supplier name from ${doc.supplier_name} to ${cleanSupplierName}`);
          }
        }

        // Si se hicieron correcciones, actualizar el documento
        if (needsUpdate) {
          newStatus = "processed"; // Cambiar a processed para que se reintente la publicación
          
          await supabase
            .from("processed_documents")
            .update({
              doc_number: newDocNumber,
              supplier_name: cleanSupplierName,
              xml_data: xmlData,
              status: newStatus,
              error_message: null,
            })
            .eq("id", doc.id);

          results.fixed++;
          console.log(`Fixed document ${doc.doc_number} -> ready for republishing`);
        } else {
          results.stillFailed++;
          results.errors.push({
            doc_number: doc.doc_number,
            error: "Could not automatically fix this error",
            original_error: doc.error_message?.substring(0, 200),
          });
        }

      } catch (error) {
        console.error(`Error processing document ${doc.doc_number}:`, error);
        results.stillFailed++;
        results.errors.push({
          doc_number: doc.doc_number,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    console.log(`Retry complete: ${results.fixed} fixed, ${results.stillFailed} still failed`);

    return new Response(
      JSON.stringify({
        success: true,
        fixed: results.fixed,
        stillFailed: results.stillFailed,
        errors: results.errors.length > 0 ? results.errors : undefined,
        message: results.fixed > 0 
          ? `${results.fixed} documento(s) corregido(s) y listo(s) para republicar` 
          : "No se pudieron corregir automáticamente los documentos",
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
