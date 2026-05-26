// Returns per-organization import health metrics
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

interface OrgHealth {
  organization_id: string;
  organization_name: string;
  has_integration: boolean;
  service_type: string | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  backlog_skip_count: number;
  imported_today: number;
  imported_7d: number;
  imported_month: number;
  pending_config: number;
  errors_count: number;
  recent_error_codes: string[];
  health: "ok" | "warning" | "critical";
}

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
    const requestedOrgId: string | undefined = body.organization_id;

    // Determine which orgs to report on
    const { data: isAdminRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    const isAdmin = !!isAdminRow;

    let orgIds: string[] = [];
    if (requestedOrgId) {
      // verify membership
      const { data: mem } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", user.id)
        .eq("organization_id", requestedOrgId)
        .eq("is_active", true)
        .maybeSingle();
      if (!mem && !isAdmin) return json({ error: "forbidden" }, 403);
      orgIds = [requestedOrgId];
    } else if (isAdmin) {
      const { data: allOrgs } = await supabase
        .from("organizations")
        .select("id")
        .eq("is_active", true);
      orgIds = (allOrgs ?? []).map((o) => o.id);
    } else {
      const { data: mems } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", user.id)
        .eq("is_active", true);
      orgIds = (mems ?? []).map((m) => m.organization_id);
    }

    if (orgIds.length === 0) return json({ orgs: [] });

    // Fetch org metadata
    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, name")
      .in("id", orgIds);
    const orgsMap = new Map((orgs ?? []).map((o) => [o.id, o.name as string]));

    // Active integrations
    const { data: integrations } = await supabase
      .from("integration_accounts")
      .select("organization_id, service_type")
      .in("organization_id", orgIds)
      .eq("is_active", true)
      .in("service_type", ["gmail", "outlook", "outlook_imap", "hostinger", "bluehost"]);
    const integMap = new Map<string, string>();
    for (const i of integrations ?? []) {
      if (!integMap.has(i.organization_id)) integMap.set(i.organization_id, i.service_type);
    }

    // Backlog cursors
    const cursorKeys: string[] = [];
    for (const id of orgIds) {
      cursorKeys.push(`bluehost_resume_skip_${id}`, `hostinger_resume_skip_${id}`);
    }
    const { data: settings } = await supabase
      .from("system_settings")
      .select("key, value, organization_id")
      .in("key", cursorKeys);
    const backlogMap = new Map<string, number>();
    for (const s of settings ?? []) {
      const n = parseInt(String(s.value), 10);
      if (Number.isFinite(n) && n > 0) backlogMap.set(s.organization_id as string, n);
    }

    // Date boundaries
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // Per-org metrics — run in parallel
    const results: OrgHealth[] = await Promise.all(
      orgIds.map(async (orgId): Promise<OrgHealth> => {
        const [lastSync, importedTodayQ, imported7dQ, importedMonthQ, pendingQ, errorsQ, recentErrsQ] =
          await Promise.all([
            supabase
              .from("sync_logs")
              .select("created_at, status, error_message, error_code")
              .eq("organization_id", orgId)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
            supabase
              .from("processed_documents")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", orgId)
              .gte("created_at", todayStart),
            supabase
              .from("processed_documents")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", orgId)
              .gte("created_at", weekStart),
            supabase
              .from("processed_documents")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", orgId)
              .gte("created_at", monthStart),
            supabase
              .from("processed_documents")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", orgId)
              .in("status", ["pending_config", "review", "pending"]),
            supabase
              .from("processed_documents")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", orgId)
              .eq("status", "error")
              .gte("created_at", weekStart),
            supabase
              .from("sync_logs")
              .select("error_code")
              .eq("organization_id", orgId)
              .eq("status", "error")
              .gte("created_at", weekStart)
              .order("created_at", { ascending: false })
              .limit(20),
          ]);

        const serviceType = integMap.get(orgId) ?? null;
        const lastSyncAt = lastSync.data?.created_at ?? null;
        const backlog = backlogMap.get(orgId) ?? 0;

        // Health classification
        let health: "ok" | "warning" | "critical" = "ok";
        const hoursSinceSync = lastSyncAt
          ? (Date.now() - new Date(lastSyncAt).getTime()) / 3600000
          : Infinity;
        if (!serviceType) health = "critical";
        else if (lastSync.data?.status === "error" || hoursSinceSync > 24) health = "critical";
        else if (hoursSinceSync > 2 || backlog > 50 || (errorsQ.count ?? 0) > 5) health = "warning";

        const recentErrCodes = Array.from(
          new Set(
            (recentErrsQ.data ?? [])
              .map((r) => r.error_code)
              .filter((c): c is string => !!c)
          )
        ).slice(0, 5);

        return {
          organization_id: orgId,
          organization_name: orgsMap.get(orgId) ?? "—",
          has_integration: !!serviceType,
          service_type: serviceType,
          last_sync_at: lastSyncAt,
          last_sync_status: lastSync.data?.status ?? null,
          last_sync_error: lastSync.data?.error_message ?? null,
          backlog_skip_count: backlog,
          imported_today: importedTodayQ.count ?? 0,
          imported_7d: imported7dQ.count ?? 0,
          imported_month: importedMonthQ.count ?? 0,
          pending_config: pendingQ.count ?? 0,
          errors_count: errorsQ.count ?? 0,
          recent_error_codes: recentErrCodes,
          health,
        };
      })
    );

    // Sort: critical → warning → ok
    const order = { critical: 0, warning: 1, ok: 2 } as const;
    results.sort((a, b) => order[a.health] - order[b.health] || a.organization_name.localeCompare(b.organization_name));

    return json({ orgs: results, generated_at: new Date().toISOString() });
  } catch (e) {
    console.error("import-health-summary error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
