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

    // Parse trigger
    const { trigger = "cron" } = await req.json().catch(() => ({ trigger: "cron" }));

    // Auto-clean sync_logs stuck in "running" for more than 30 minutes
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: stuckLogs } = await supabase
      .from("sync_logs")
      .update({
        status: "error",
        error_message: "Auto-cleanup: sync stuck in running for >30min",
        completed_at: new Date().toISOString(),
      })
      .eq("status", "running")
      .lt("created_at", thirtyMinAgo)
      .select("id");
    
    if (stuckLogs && stuckLogs.length > 0) {
      console.log(`🧹 Cleaned ${stuckLogs.length} stuck sync logs`);
    }
    
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

    // Obtener todas las organizaciones activas con correo (Gmail, Outlook O Bluehost) y QuickBooks conectados
    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, name, gmail_connected, outlook_connected, bluehost_connected")
      .eq("quickbooks_connected", true)
      .eq("is_active", true);

    // Filtrar orgs que tengan al menos Gmail, Outlook o Bluehost conectado
    const validOrgs = orgs?.filter(org => org.gmail_connected || org.outlook_connected || org.bluehost_connected) || [];

    if (validOrgs.length === 0) {
      console.log("No organizations with email (Gmail/Outlook/Bluehost) and QuickBooks connected");
      return new Response(
        JSON.stringify({ message: "No organizations to sync" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const gmailCount = validOrgs.filter(o => o.gmail_connected).length;
    const outlookCount = validOrgs.filter(o => o.outlook_connected).length;
    const bluehostCount = validOrgs.filter(o => o.bluehost_connected && !o.gmail_connected && !o.outlook_connected).length;
    console.log(`Found ${validOrgs.length} organizations to sync (Gmail: ${gmailCount}, Outlook: ${outlookCount}, Bluehost: ${bluehostCount})`);
    
    const orgsToProcess = validOrgs;

    const results = [];

    for (const org of orgsToProcess) {
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
        // Determinar qué proveedor de correo usar
        let mailProvider: string;
        let fetchFunctionName: string;
        
        if (org.gmail_connected) {
          mailProvider = "gmail";
          fetchFunctionName = "gmail-fetch-invoices";
        } else if (org.outlook_connected) {
          mailProvider = "outlook";
          fetchFunctionName = "outlook-fetch-invoices";
        } else if (org.bluehost_connected) {
          mailProvider = "bluehost";
          fetchFunctionName = "bluehost-fetch-invoices";
        } else {
          throw new Error("No email provider configured");
        }
        
        console.log(`📧 Fetching invoices from ${mailProvider.toUpperCase()} for ${org.name}...`);
        
        const emailResponse = await supabase.functions.invoke(
          fetchFunctionName,
          {
            body: { organization_id: org.id },
          }
        );

        console.log(`${mailProvider} response status:`, emailResponse.error);
        
        if (emailResponse.error) {
          const errorDetails = JSON.stringify(emailResponse.error);
          console.error(`${mailProvider} error details:`, errorDetails);
          throw new Error(`${mailProvider} fetch failed: ${errorDetails}`);
        }

        const emailData = emailResponse.data;
        
        if (!emailData) {
          throw new Error(`${mailProvider} fetch returned no data`);
        }

        const invoicesSkipped = emailData.invoices_skipped || 0;
        const realFailures = emailData.invoices_failed || 0;
        const wasPartial = emailData.status === "partial" || emailData.time_limit_reached;
        
        console.log(`📧 ${mailProvider.toUpperCase()} sync for ${org.name}: ${emailData.invoices_processed} processed, ${invoicesSkipped} skipped, ${realFailures} failed${wasPartial ? ' (PARTIAL - time limit)' : ''}`);

        // 2. Publish to QuickBooks (si hay facturas procesadas)
        if (emailData.invoices_processed > 0) {
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
          console.log(`✅ QuickBooks sync for ${org.name}: ${qboData.published} published, ${qboData.failed} failed`);

          // Actualizar log de sincronización - considerar partial por timeout
          const syncStatus = wasPartial ? "partial" : (realFailures > 0 || qboData.failed > 0 ? "partial" : "success");
          
          if (syncLog) {
            await supabase
              .from("sync_logs")
              .update({
                status: syncStatus,
                gmail_fetched: emailData.messages_found || 0,
                gmail_processed: emailData.invoices_processed,
                gmail_failed: realFailures,
                qbo_published: qboData.published,
                qbo_failed: qboData.failed,
                completed_at: new Date().toISOString(),
                execution_time_ms: Date.now() - syncStartTime,
                error_message: wasPartial ? "Sincronización parcial por límite de tiempo" : null,
              })
              .eq("id", syncLog.id);
          }

          results.push({
            organization_id: org.id,
            organization_name: org.name,
            mail_provider: mailProvider,
            gmail_processed: emailData.invoices_processed,
            gmail_skipped: invoicesSkipped,
            gmail_failed: realFailures,
            qbo_published: qboData.published,
            qbo_failed: qboData.failed,
            status: syncStatus,
            partial: wasPartial,
          });
        } else {
          // Actualizar log con 0 facturas nuevas - considerar partial por timeout
          const syncStatus = wasPartial ? "partial" : (realFailures > 0 ? "partial" : "success");
          
          if (syncLog) {
            await supabase
              .from("sync_logs")
              .update({
                status: syncStatus,
                gmail_fetched: emailData.messages_found || 0,
                gmail_processed: 0,
                gmail_failed: realFailures,
                error_message: wasPartial ? "Sincronización parcial por límite de tiempo" : (realFailures > 0 ? `${realFailures} facturas con errores reales` : null),
                completed_at: new Date().toISOString(),
                execution_time_ms: Date.now() - syncStartTime,
              })
              .eq("id", syncLog.id);
          }

          results.push({
            organization_id: org.id,
            organization_name: org.name,
            mail_provider: mailProvider,
            gmail_processed: 0,
            gmail_skipped: invoicesSkipped,
            gmail_failed: realFailures,
            status: syncStatus,
            partial: wasPartial,
            message: wasPartial ? "Límite de tiempo alcanzado" : (invoicesSkipped > 0 ? `${invoicesSkipped} facturas ya procesadas (duplicados)` : "Sin facturas nuevas"),
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
        organizations_processed: orgsToProcess.length,
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
