import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const startTime = Date.now();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("Starting automatic invoice sync...");

    // Verificar si el cron está pausado (solo para triggers automáticos)
    const { trigger = "cron" } = await req.json().catch(() => ({ trigger: "cron" }));
    
    if (trigger === "cron") {
      const { data: cronSettings } = await supabase
        .from("system_settings")
        .select("value")
        .eq("key", "cron_auto_sync_enabled")
        .maybeSingle();

      if (cronSettings && cronSettings.value === "false") {
        console.log("Auto-sync is paused");
        return new Response(
          JSON.stringify({ 
            success: true,
            message: "Auto-sync is paused",
            paused: true 
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Obtener todas las organizaciones activas con Gmail y QuickBooks conectados
    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, name")
      .eq("gmail_connected", true)
      .eq("quickbooks_connected", true)
      .eq("is_active", true);

    if (!orgs || orgs.length === 0) {
      console.log("No organizations with both Gmail and QuickBooks connected");
      return new Response(
        JSON.stringify({ message: "No organizations to sync" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results = [];

    for (const org of orgs) {
      console.log(`Processing organization: ${org.name} (${org.id})`);

      // Crear log de sincronización
      const { data: syncLog } = await supabase
        .from("sync_logs")
        .insert({
          organization_id: org.id,
          trigger_type: trigger,
          status: "running",
        })
        .select()
        .single();

      const syncStartTime = Date.now();

      try {
        // 1. Fetch invoices from Gmail
        console.log(`Fetching Gmail invoices for ${org.name}...`);
        const gmailResponse = await supabase.functions.invoke(
          "gmail-fetch-invoices",
          {
            body: { organization_id: org.id },
          }
        );

        console.log("Gmail response status:", gmailResponse.error);
        
        if (gmailResponse.error) {
          const errorDetails = JSON.stringify(gmailResponse.error);
          console.error("Gmail error details:", errorDetails);
          throw new Error(`Gmail fetch failed: ${errorDetails}`);
        }

        const gmailData = gmailResponse.data;
        
        if (!gmailData) {
          throw new Error("Gmail fetch returned no data");
        }

        console.log(`Gmail sync for ${org.name}: ${gmailData.invoices_processed} processed, ${gmailData.invoices_failed} failed`);

        // 2. Publish to QuickBooks (si hay facturas procesadas)
        if (gmailData.invoices_processed > 0) {
          console.log(`Publishing to QuickBooks for ${org.name}...`);
          
          // Esperar un poco para asegurar que las facturas están en la BD
          await new Promise(resolve => setTimeout(resolve, 2000));

          const qboResponse = await supabase.functions.invoke(
            "publish-to-quickbooks",
            {
              body: { organization_id: org.id },
            }
          );

          console.log("QuickBooks response status:", qboResponse.error);
          
          if (qboResponse.error) {
            const errorDetails = JSON.stringify(qboResponse.error);
            console.error("QuickBooks error details:", errorDetails);
            throw new Error(`QuickBooks publish failed: ${errorDetails}`);
          }

          const qboData = qboResponse.data;
          
          if (!qboData) {
            throw new Error("QuickBooks publish returned no data");
          }
          console.log(`QuickBooks sync for ${org.name}: ${qboData.published} published, ${qboData.failed} failed`);

          // Actualizar log de sincronización
          if (syncLog) {
            await supabase
              .from("sync_logs")
              .update({
                status: "success",
                gmail_fetched: gmailData.messages_found || 0,
                gmail_processed: gmailData.invoices_processed,
                gmail_failed: gmailData.invoices_failed,
                qbo_published: qboData.published,
                qbo_failed: qboData.failed,
                completed_at: new Date().toISOString(),
                execution_time_ms: Date.now() - syncStartTime,
              })
              .eq("id", syncLog.id);
          }

          results.push({
            organization_id: org.id,
            organization_name: org.name,
            gmail_processed: gmailData.invoices_processed,
            gmail_failed: gmailData.invoices_failed,
            qbo_published: qboData.published,
            qbo_failed: qboData.failed,
            status: "success",
          });
        } else {
          // Actualizar log con 0 facturas procesadas pero registrar los fallos
          if (syncLog) {
            const hasFailures = gmailData.invoices_failed > 0;
            await supabase
              .from("sync_logs")
              .update({
                status: hasFailures ? "error" : "success",
                gmail_fetched: gmailData.messages_found || 0,
                gmail_processed: 0,
                gmail_failed: gmailData.invoices_failed,
                error_message: hasFailures ? `${gmailData.invoices_failed} facturas fallaron en procesamiento de Gmail` : null,
                completed_at: new Date().toISOString(),
                execution_time_ms: Date.now() - syncStartTime,
              })
              .eq("id", syncLog.id);
          }

          results.push({
            organization_id: org.id,
            organization_name: org.name,
            gmail_processed: 0,
            gmail_failed: gmailData.invoices_failed,
            status: gmailData.invoices_failed > 0 ? "partial_error" : "no_new_invoices",
          });
        }
      } catch (error) {
        console.error(`Error processing organization ${org.name}:`, error);
        
        // Actualizar log con error
        if (syncLog) {
          await supabase
            .from("sync_logs")
            .update({
              status: "error",
              error_message: error instanceof Error ? error.message : "Unknown error",
              completed_at: new Date().toISOString(),
              execution_time_ms: Date.now() - syncStartTime,
            })
            .eq("id", syncLog.id);
        }

        results.push({
          organization_id: org.id,
          organization_name: org.name,
          status: "error",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    console.log("Auto-sync completed:", results);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Auto-sync completed",
        organizations_processed: orgs.length,
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in auto-sync-invoices:", error);
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
