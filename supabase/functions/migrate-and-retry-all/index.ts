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
    const { organization_id } = await req.json();

    console.log(`🔄 Starting mass migration and retry for org: ${organization_id}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Obtener documentos con error que tienen xml_data
    const { data: errorDocs, error: fetchError } = await supabase
      .from("processed_documents")
      .select("*")
      .eq("organization_id", organization_id)
      .eq("status", "error")
      .not("xml_data", "is", null);

    if (fetchError) {
      throw fetchError;
    }

    if (!errorDocs || errorDocs.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No hay documentos con error para migrar",
          results: { migrated: 0, failed: 0 },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📄 Found ${errorDocs.length} documents with xml_data to migrate`);

    const results = {
      migrated: 0,
      failed: 0,
      errors: [] as any[],
    };

    // Procesar cada documento
    for (const doc of errorDocs) {
      try {
        console.log(`\n🔍 Processing: ${doc.doc_number}`);

        // Verificar si necesita migración (formato antiguo sin array de impuestos)
        const needsMigration = !doc.xml_data?.detalle?.[0]?.impuestos;

        if (!needsMigration) {
          console.log(`✓ Already in new format: ${doc.doc_number}`);
          
          // Solo resetear el estado para reintentar
          await supabase
            .from("processed_documents")
            .update({
              status: "pending",
              error_message: null,
              retry_count: 0,
            })
            .eq("id", doc.id);
          
          results.migrated++;
          continue;
        }

        console.log(`🔄 Migrating old format: ${doc.doc_number}`);

        // Migrar el formato antiguo
        const migratedData = { ...doc.xml_data };
        
        if (migratedData.detalle && Array.isArray(migratedData.detalle)) {
          // Calcular la tasa de impuesto promedio si existe
          const defaultTaxRate = migratedData.resumen?.totalImpuestos && migratedData.resumen?.totalComprobante
            ? (migratedData.resumen.totalImpuestos / (migratedData.resumen.totalComprobante - migratedData.resumen.totalImpuestos)) * 100
            : 13;

          console.log(`  Using tax rate: ${defaultTaxRate.toFixed(2)}%`);

          migratedData.detalle = migratedData.detalle.map((item: any) => {
            if (!item.impuestos || !Array.isArray(item.impuestos)) {
              // Calcular el monto de impuesto para este item
              const itemSubtotal = item.subtotal || (item.montoTotal / (1 + defaultTaxRate / 100));
              const itemTax = item.impuesto || (itemSubtotal * defaultTaxRate / 100);

              return {
                ...item,
                impuestos: [{
                  codigo: "01", // IVA
                  codigoTarifa: "08", // Tarifa general
                  tarifa: defaultTaxRate,
                  monto: itemTax,
                }]
              };
            }
            return item;
          });

          console.log(`  ✓ Migrated ${migratedData.detalle.length} line items`);
        }

        // Actualizar con datos migrados
        const { error: updateError } = await supabase
          .from("processed_documents")
          .update({
            xml_data: migratedData,
            status: "pending",
            error_message: null,
            retry_count: 0,
            updated_at: new Date().toISOString(),
          })
          .eq("id", doc.id);

        if (updateError) {
          throw updateError;
        }

        console.log(`✓ Migrated and reset: ${doc.doc_number}`);
        results.migrated++;

      } catch (error: any) {
        console.error(`❌ Error processing ${doc.doc_number}:`, error.message);
        results.failed++;
        results.errors.push({
          doc_number: doc.doc_number,
          error: error.message,
        });
      }
    }

    // Ahora invocar publish-to-quickbooks para publicar todos los documentos pendientes
    console.log(`\n📤 Invoking publish-to-quickbooks for ${results.migrated} migrated documents...`);
    
    const { data: publishResult, error: publishError } = await supabase.functions.invoke(
      "publish-to-quickbooks",
      {
        body: { organization_id },
      }
    );

    if (publishError) {
      console.error("⚠️  Error invoking publish-to-quickbooks:", publishError);
    } else {
      console.log("✅ Publish result:", publishResult);
    }

    console.log(`\n📊 Migration Results:`);
    console.log(`  ✅ Migrated: ${results.migrated}`);
    console.log(`  ❌ Failed: ${results.failed}`);

    return new Response(
      JSON.stringify({
        success: true,
        results,
        publishResult,
        message: `Migración completada: ${results.migrated} exitosos, ${results.failed} fallidos`,
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
