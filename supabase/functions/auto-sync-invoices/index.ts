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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const { trigger = "cron", organization_id: singleOrgId } = body;

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

    // ============================================================
    // MODE 1: Single org processing (called by dispatcher below)
    // ============================================================
    if (singleOrgId) {
      console.log(`🔄 Processing single organization: ${singleOrgId}`);
      
      const { data: org } = await supabase
        .from("organizations")
        .select("id, name, gmail_connected, outlook_connected, bluehost_connected, hostinger_connected, quickbooks_connected")
        .eq("id", singleOrgId)
        .single();

      if (!org) {
        return new Response(
          JSON.stringify({ error: "Organization not found" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
        );
      }

      const result = await processOrganization(supabase, supabaseUrl, supabaseKey, org, trigger);
      
      return new Response(
        JSON.stringify({ success: true, result }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============================================================
    // MODE 2: Dispatcher - fan out to individual org processing
    // ============================================================
    if (trigger === "cron") {
      const { data: cronSettings } = await supabase
        .from("system_settings")
        .select("value")
        .eq("key", "cron_auto_sync_enabled")
        .maybeSingle();

      if (cronSettings && cronSettings.value === "false") {
        console.log("Auto-sync is paused");
        return new Response(
          JSON.stringify({ success: true, message: "Auto-sync is paused", paused: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Get all active organizations (no QuickBooks filter - invoices must be imported regardless)
    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, name, gmail_connected, outlook_connected, bluehost_connected, hostinger_connected, quickbooks_connected")
      .eq("is_active", true);

    const validOrgs = orgs?.filter(org => 
      org.gmail_connected || org.outlook_connected || org.bluehost_connected || org.hostinger_connected
    ) || [];

    if (validOrgs.length === 0) {
      console.log("No active organizations with email connected");
      return new Response(
        JSON.stringify({ message: "No organizations to sync" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`🚀 Dispatching sync for ${validOrgs.length} organizations in parallel`);

    // Fire off individual sync calls for each org with retry + error logging
    const dispatches = validOrgs.map(async (org) => {
      console.log(`📤 Dispatching sync for ${org.name} (${org.id})`);
      
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const resp = await fetch(`${supabaseUrl}/functions/v1/auto-sync-invoices`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ 
              organization_id: org.id, 
              trigger 
            }),
          });
          if (resp.ok || resp.status < 500) return resp;
          console.warn(`⚠️ Dispatch attempt ${attempt + 1} failed for ${org.name}: ${resp.status}`);
        } catch (err) {
          console.warn(`⚠️ Dispatch attempt ${attempt + 1} network error for ${org.name}:`, err);
        }
        if (attempt === 0) await new Promise(r => setTimeout(r, 1000));
      }
      
      // Both attempts failed - log to sync_logs
      console.error(`❌ Dispatch failed for ${org.name} after 2 attempts`);
      await supabase.from("sync_logs").insert({
        organization_id: org.id,
        trigger_type: trigger,
        status: "error",
        error_message: "Dispatch failed after 2 attempts",
        completed_at: new Date().toISOString(),
      });
      return null;
    });

    // Wait for all dispatches to be sent (not for completion)
    await Promise.allSettled(dispatches);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Dispatched sync for ${validOrgs.length} organizations`,
        organizations: validOrgs.map(o => ({ id: o.id, name: o.name })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in auto-sync-invoices:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

// Process a single organization: fetch emails + publish to QB
async function processOrganization(
  supabase: any,
  supabaseUrl: string,
  supabaseKey: string,
  org: any,
  trigger: string
) {
  // Create sync log
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
    // Determine mail provider
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
    } else if (org.hostinger_connected) {
      mailProvider = "hostinger";
      fetchFunctionName = "hostinger-fetch-invoices";
    } else {
      throw new Error("No email provider configured");
    }
    
    console.log(`📧 Fetching invoices from ${mailProvider.toUpperCase()} for ${org.name}...`);
    
    // Call fetch function directly via HTTP to get its own timeout
    const emailResponse = await fetch(`${supabaseUrl}/functions/v1/${fetchFunctionName}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ organization_id: org.id }),
    });

    if (!emailResponse.ok) {
      const errorText = await emailResponse.text().catch(() => "Unknown error");
      throw new Error(`${mailProvider} fetch failed (${emailResponse.status}): ${errorText}`);
    }

    const emailData = await emailResponse.json();
    
    if (!emailData) {
      throw new Error(`${mailProvider} fetch returned no data`);
    }

    const invoicesSkipped = emailData.invoices_skipped || 0;
    const realFailures = emailData.invoices_failed || 0;
    const wasPartial = emailData.status === "partial" || emailData.time_limit_reached;
    
    console.log(`📧 ${mailProvider.toUpperCase()} sync for ${org.name}: ${emailData.invoices_processed} processed, ${invoicesSkipped} skipped, ${realFailures} failed${wasPartial ? ' (PARTIAL)' : ''}`);

    // Publish to QuickBooks: only if the organization has QuickBooks connected
    let qboPublished = 0;
    let qboFailed = 0;

    if (org.quickbooks_connected) {
      // Check if there are any pending/processed documents waiting to be published
      const { count: pendingCount } = await supabase
        .from("processed_documents")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", org.id)
        .in("status", ["pending", "processed"])
        .is("qbo_entity_id", null);

      const hasPendingDocs = (pendingCount || 0) > 0;
      const hasNewInvoices = emailData.invoices_processed > 0;

      if (hasNewInvoices || hasPendingDocs) {
        console.log(`Publishing to QuickBooks for ${org.name}... (new: ${hasNewInvoices}, pending orphans: ${hasPendingDocs ? pendingCount : 0})`);
        if (hasNewInvoices) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        const qboResponse = await fetch(`${supabaseUrl}/functions/v1/publish-to-quickbooks`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ organization_id: org.id }),
        });

        if (qboResponse.ok) {
          const qboData = await qboResponse.json();
          qboPublished = qboData?.published || 0;
          qboFailed = qboData?.failed || 0;
          console.log(`✅ QuickBooks sync for ${org.name}: ${qboPublished} published, ${qboFailed} failed`);
        } else {
          const qboError = await qboResponse.text().catch(() => "Unknown");
          console.error(`QuickBooks publish failed for ${org.name}: ${qboError}`);
          qboFailed = 1;
        }
      } else {
        console.log(`⏭️ No pending documents for ${org.name}, skipping QB publish`);
      }
    } else {
      console.log(`⏭️ QuickBooks not connected for ${org.name}, skipping QB publish`);
    }

    // Update sync log
    const syncStatus = wasPartial ? "partial" : (realFailures > 0 || qboFailed > 0 ? "partial" : "success");
    
    if (syncLog) {
      await supabase
        .from("sync_logs")
        .update({
          status: syncStatus,
          gmail_fetched: emailData.messages_found || 0,
          gmail_processed: emailData.invoices_processed,
          gmail_failed: realFailures,
          qbo_published: qboPublished,
          qbo_failed: qboFailed,
          completed_at: new Date().toISOString(),
          execution_time_ms: Date.now() - syncStartTime,
          error_message: wasPartial ? "Sincronización parcial por límite de tiempo" : 
                        (realFailures > 0 ? `${realFailures} facturas con errores reales` : null),
        })
        .eq("id", syncLog.id);
    }

    return {
      organization_id: org.id,
      organization_name: org.name,
      mail_provider: mailProvider,
      gmail_processed: emailData.invoices_processed,
      gmail_skipped: invoicesSkipped,
      gmail_failed: realFailures,
      qbo_published: qboPublished,
      qbo_failed: qboFailed,
      status: syncStatus,
      partial: wasPartial,
    };
  } catch (error) {
    console.error(`Error processing organization ${org.name}:`, error);
    
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

    return {
      organization_id: org.id,
      organization_name: org.name,
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
