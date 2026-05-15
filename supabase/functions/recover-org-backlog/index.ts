import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FN_MAP: Record<string, string> = {
  hostinger: "hostinger-fetch-invoices",
  bluehost: "bluehost-fetch-invoices",
  gmail: "gmail-fetch-invoices",
  outlook: "outlook-fetch-invoices",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // JWT verification — reject anonymous calls
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === supabaseKey;

    const supabase = createClient(supabaseUrl, supabaseKey);

    let userId: string | null = null;
    if (!isServiceRole) {
      const anonClient = createClient(supabaseUrl, anonKey);
      const { data: userData, error: userErr } = await anonClient.auth.getUser(token);
      if (userErr || !userData?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = userData.user.id;
    }

    const { organization_id, max_chunks } = await req.json().catch(() => ({}));
    if (!organization_id) {
      return new Response(JSON.stringify({ error: "organization_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Enforce org membership when not service-role
    if (!isServiceRole && userId) {
      const { data: isMember } = await supabase.rpc("is_organization_member", {
        _user_id: userId, _org_id: organization_id,
      });
      if (!isMember) {
        return new Response(JSON.stringify({ error: "Forbidden: not a member" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Detect active mail provider
    const { data: org, error: orgErr } = await supabase
      .from("organizations")
      .select("id, name, gmail_connected, outlook_connected, hostinger_connected, bluehost_connected, quickbooks_connected")
      .eq("id", organization_id)
      .maybeSingle();
    if (orgErr || !org) {
      return new Response(JSON.stringify({ error: "Organization not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let provider: string | null = null;
    if (org.hostinger_connected) provider = "hostinger";
    else if (org.bluehost_connected) provider = "bluehost";
    else if (org.gmail_connected) provider = "gmail";
    else if (org.outlook_connected) provider = "outlook";

    if (!provider) {
      return new Response(JSON.stringify({ error: "No mail provider connected for this organization" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fetchFn = FN_MAP[provider];
    const limit = Math.max(1, Math.min(Number(max_chunks) || 30, 50));

    // Resume from persisted cursor if any
    const cursorKey = `${provider}_resume_skip_${organization_id}`;
    const { data: cursorRow } = await supabase
      .from("system_settings")
      .select("value").eq("organization_id", organization_id).eq("key", cursorKey).maybeSingle();
    let skipCount = Number(cursorRow?.value);
    if (!Number.isFinite(skipCount) || skipCount < 0) skipCount = 0;

    console.log(`[recover-backlog] org=${org.name} provider=${provider} starting at skip=${skipCount} max_chunks=${limit}`);

    let totalProcessed = 0, totalFailed = 0, chunksRun = 0;
    let lastError: string | null = null;
    let totalMessages: number | null = null;

    for (let i = 0; i < limit; i++) {
      chunksRun++;

      // Insert sync_log per chunk
      const { data: syncLog } = await supabase.from("sync_logs").insert({
        organization_id,
        trigger_type: "manual_recovery",
        status: "running",
      }).select().single();

      const chunkStart = Date.now();

      try {
        const fetchBody: Record<string, unknown> = { organization_id };
        if ((provider === "hostinger" || provider === "bluehost") && skipCount > 0) {
          fetchBody.skip_count = skipCount;
        }

        const resp = await fetch(`${supabaseUrl}/functions/v1/${fetchFn}`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(fetchBody),
        });

        if (!resp.ok) {
          lastError = `${provider} fetch HTTP ${resp.status}`;
          const txt = await resp.text().catch(() => "");
          if (syncLog) {
            await supabase.from("sync_logs").update({
              status: "error",
              gmail_fetched: 0, gmail_processed: 0, gmail_failed: 0,
              error_message: lastError, error_detail: txt.substring(0, 500),
              error_code: String(resp.status),
              completed_at: new Date().toISOString(),
              execution_time_ms: Date.now() - chunkStart,
            }).eq("id", syncLog.id);
          }
          break;
        }

        const chunk = await resp.json();
        totalMessages = Number(chunk?.total_messages_in_range || chunk?.messages_found || totalMessages || 0);
        const processed = Number(chunk?.invoices_processed || 0);
        const failed = Number(chunk?.invoices_failed || 0);
        totalProcessed += processed;
        totalFailed += failed;

        const nextSkip = Number(chunk?.next_skip_count);
        const hasMore = chunk?.partial === true && Number.isFinite(nextSkip) && nextSkip > skipCount;

        if (syncLog) {
          await supabase.from("sync_logs").update({
            status: hasMore ? "partial" : "success",
            gmail_fetched: totalMessages || 0,
            gmail_processed: processed,
            gmail_failed: failed,
            completed_at: new Date().toISOString(),
            execution_time_ms: Date.now() - chunkStart,
            error_message: hasMore ? `Recuperación: chunk ${i + 1} parcial` : null,
          }).eq("id", syncLog.id);
        }

        if (!hasMore) {
          // Done — clear cursor
          await supabase.from("system_settings").delete()
            .eq("organization_id", organization_id).eq("key", cursorKey);
          break;
        }
        skipCount = nextSkip;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (syncLog) {
          await supabase.from("sync_logs").update({
            status: "error", error_message: lastError.substring(0, 255),
            completed_at: new Date().toISOString(),
            execution_time_ms: Date.now() - chunkStart,
          }).eq("id", syncLog.id);
        }
        break;
      }

      // Small delay between chunks
      await new Promise(r => setTimeout(r, 400));
    }

    // Persist remaining cursor if not finished
    if (skipCount > 0 && (totalMessages == null || skipCount < totalMessages)) {
      await supabase.from("system_settings").upsert({
        organization_id,
        key: cursorKey,
        value: String(skipCount),
        description: `Resume cursor for ${provider} sync`,
      }, { onConflict: "organization_id,key" });
    }

    // Trigger publish-to-quickbooks if anything was processed
    let qboPublished = 0;
    if (totalProcessed > 0 && org.quickbooks_connected) {
      try {
        const qboResp = await fetch(`${supabaseUrl}/functions/v1/publish-to-quickbooks`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ organization_id }),
        });
        if (qboResp.ok) {
          const qboData = await qboResp.json().catch(() => ({}));
          qboPublished = Number(qboData?.published || 0);
        }
      } catch (e) {
        console.warn(`[recover-backlog] publish-to-quickbooks failed: ${e}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        organization_id,
        provider,
        chunks_run: chunksRun,
        total_processed: totalProcessed,
        total_failed: totalFailed,
        total_messages: totalMessages,
        next_skip: skipCount,
        qbo_published: qboPublished,
        last_error: lastError,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[recover-org-backlog] error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
