// Per-org integration self-check: confirms flags match active integrations,
// reports recent sync status, backlog, and gives a single actionable verdict.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const orgId: string | undefined = body.organization_id;
    if (!orgId) return json({ error: "organization_id required" }, 400);

    // Membership / admin check
    const [{ data: mem }, { data: isAdminRow }] = await Promise.all([
      supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", user.id)
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .maybeSingle(),
      supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle(),
    ]);
    if (!mem && !isAdminRow) return json({ error: "forbidden" }, 403);

    // Load org flags + active integrations + last sync
    const [{ data: org }, { data: integrations }, { data: lastSync }] = await Promise.all([
      supabase
        .from("organizations")
        .select("id, name, gmail_connected, outlook_connected, hostinger_connected, bluehost_connected")
        .eq("id", orgId)
        .maybeSingle(),
      supabase
        .from("integration_accounts")
        .select("service_type, account_email, is_active, updated_at")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .in("service_type", ["gmail", "outlook", "outlook_imap", "hostinger", "bluehost"]),
      supabase
        .from("sync_logs")
        .select("created_at, status, error_message, error_code")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (!org) return json({ error: "organization not found" }, 404);

    const activeServices = (integrations ?? []).map((i) => i.service_type);
    const flagMap = {
      gmail: org.gmail_connected,
      outlook: org.outlook_connected,
      outlook_imap: org.outlook_connected,
      hostinger: org.hostinger_connected,
      bluehost: org.bluehost_connected,
    } as Record<string, boolean>;

    const drift: string[] = [];
    for (const s of activeServices) {
      if (!flagMap[s]) drift.push(`Hay integración activa de '${s}' pero la bandera está apagada`);
    }
    for (const [k, v] of Object.entries(flagMap)) {
      if (v && !activeServices.includes(k) && !(k === "outlook_imap" && activeServices.includes("outlook"))) {
        if (k === "outlook" && activeServices.includes("outlook_imap")) continue;
        drift.push(`La bandera '${k}_connected' está prendida pero no hay integración activa`);
      }
    }

    // Backlog cursors
    const { data: cursors } = await supabase
      .from("system_settings")
      .select("key, value")
      .eq("organization_id", orgId)
      .in("key", [`bluehost_resume_skip_${orgId}`, `hostinger_resume_skip_${orgId}`]);
    let backlog = 0;
    for (const c of cursors ?? []) {
      const n = parseInt(String(c.value), 10);
      if (Number.isFinite(n)) backlog += n;
    }

    // Verdict
    let verdict: "ok" | "warning" | "critical" = "ok";
    const reasons: string[] = [];
    if (activeServices.length === 0) {
      verdict = "critical";
      reasons.push("No hay integraciones de correo activas para esta empresa");
    }
    if (drift.length > 0) {
      verdict = verdict === "critical" ? "critical" : "warning";
      reasons.push(...drift);
    }
    if (lastSync?.status === "error") {
      verdict = "critical";
      reasons.push(`Última sincronización falló: ${lastSync.error_message ?? lastSync.error_code ?? "error"}`);
    }
    const hoursSinceSync = lastSync?.created_at
      ? (Date.now() - new Date(lastSync.created_at).getTime()) / 3600000
      : Infinity;
    if (hoursSinceSync > 24 && activeServices.length > 0) {
      verdict = verdict === "critical" ? "critical" : "warning";
      reasons.push(`Sin sincronizar hace ${Math.round(hoursSinceSync)}h`);
    }
    if (backlog > 200) {
      verdict = verdict === "critical" ? "critical" : "warning";
      reasons.push(`Backlog grande: ${backlog} mensajes pendientes`);
    }

    return json({
      organization_id: orgId,
      organization_name: org.name,
      verdict,
      reasons,
      active_services: activeServices,
      integrations: integrations ?? [],
      flags: {
        gmail: org.gmail_connected,
        outlook: org.outlook_connected,
        hostinger: org.hostinger_connected,
        bluehost: org.bluehost_connected,
      },
      last_sync: lastSync ?? null,
      backlog,
      checked_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("integration-self-check error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
