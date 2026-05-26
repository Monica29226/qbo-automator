// Daily import health report — emails admin a summary across all organizations
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface OrgRow {
  organization_id: string;
  organization_name: string;
  has_integration: boolean;
  service_type: string | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  backlog_skip_count: number;
  imported_today: number;
  imported_7d: number;
  imported_month: number;
  pending_config: number;
  errors_count: number;
  health: "ok" | "warning" | "critical";
}

function healthColor(h: string) {
  if (h === "ok") return "#10b981";
  if (h === "warning") return "#f59e0b";
  return "#ef4444";
}
function healthLabel(h: string) {
  if (h === "ok") return "OK";
  if (h === "warning") return "Atención";
  return "Crítico";
}

function fmt(iso: string | null) {
  if (!iso) return "Nunca";
  const d = new Date(iso);
  return d.toLocaleString("es-CR", { dateStyle: "short", timeStyle: "short" });
}

function buildHtml(orgs: OrgRow[]) {
  const summary = orgs.reduce(
    (a, o) => {
      a[o.health]++;
      a.backlog += o.backlog_skip_count;
      a.today += o.imported_today;
      return a;
    },
    { ok: 0, warning: 0, critical: 0, backlog: 0, today: 0 } as Record<string, number>
  );

  const rows = orgs
    .map(
      (o) => `
    <tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:10px 8px;font-weight:600;">${o.organization_name}</td>
      <td style="padding:10px 8px;"><span style="background:${healthColor(o.health)}22;color:${healthColor(o.health)};padding:2px 8px;border-radius:6px;font-size:12px;font-weight:600;">${healthLabel(o.health)}</span></td>
      <td style="padding:10px 8px;">${o.has_integration ? o.service_type : '<span style="color:#ef4444;">sin configurar</span>'}</td>
      <td style="padding:10px 8px;">${fmt(o.last_sync_at)}</td>
      <td style="padding:10px 8px;text-align:right;">${o.backlog_skip_count > 0 ? `<b style="color:#f59e0b;">${o.backlog_skip_count}</b>` : "0"}</td>
      <td style="padding:10px 8px;text-align:right;">${o.imported_today}</td>
      <td style="padding:10px 8px;text-align:right;">${o.imported_7d}</td>
      <td style="padding:10px 8px;text-align:right;">${o.imported_month}</td>
      <td style="padding:10px 8px;text-align:right;">${o.pending_config > 0 ? `<b style="color:#f59e0b;">${o.pending_config}</b>` : "0"}</td>
      <td style="padding:10px 8px;text-align:right;">${o.errors_count > 0 ? `<b style="color:#ef4444;">${o.errors_count}</b>` : "0"}</td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f9fafb;padding:20px;color:#111827;">
  <div style="max-width:900px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e5e7eb;">
    <h1 style="margin:0 0 4px;font-size:22px;">📊 Reporte diario de importación</h1>
    <p style="margin:0 0 20px;color:#6b7280;font-size:13px;">Estado de sincronización de correo de todas las organizaciones — ${new Date().toLocaleDateString("es-CR", { dateStyle: "full" })}</p>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;">
      <div style="flex:1;min-width:120px;border:1px solid #e5e7eb;border-radius:8px;padding:12px;"><div style="font-size:11px;color:#6b7280;">Total orgs</div><div style="font-size:24px;font-weight:700;">${orgs.length}</div></div>
      <div style="flex:1;min-width:120px;border:1px solid #d1fae5;background:#ecfdf5;border-radius:8px;padding:12px;"><div style="font-size:11px;color:#047857;">OK</div><div style="font-size:24px;font-weight:700;color:#10b981;">${summary.ok}</div></div>
      <div style="flex:1;min-width:120px;border:1px solid #fde68a;background:#fffbeb;border-radius:8px;padding:12px;"><div style="font-size:11px;color:#92400e;">Atención</div><div style="font-size:24px;font-weight:700;color:#f59e0b;">${summary.warning}</div></div>
      <div style="flex:1;min-width:120px;border:1px solid #fecaca;background:#fef2f2;border-radius:8px;padding:12px;"><div style="font-size:11px;color:#991b1b;">Críticas</div><div style="font-size:24px;font-weight:700;color:#ef4444;">${summary.critical}</div></div>
      <div style="flex:1;min-width:120px;border:1px solid #e5e7eb;border-radius:8px;padding:12px;"><div style="font-size:11px;color:#6b7280;">Backlog</div><div style="font-size:24px;font-weight:700;">${summary.backlog}</div></div>
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#f3f4f6;text-align:left;">
          <th style="padding:10px 8px;">Organización</th>
          <th style="padding:10px 8px;">Estado</th>
          <th style="padding:10px 8px;">Integración</th>
          <th style="padding:10px 8px;">Última sync</th>
          <th style="padding:10px 8px;text-align:right;">Backlog</th>
          <th style="padding:10px 8px;text-align:right;">Hoy</th>
          <th style="padding:10px 8px;text-align:right;">7d</th>
          <th style="padding:10px 8px;text-align:right;">Mes</th>
          <th style="padding:10px 8px;text-align:right;">Pend.cfg</th>
          <th style="padding:10px 8px;text-align:right;">Err 7d</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <p style="margin-top:24px;color:#6b7280;font-size:12px;">
      • <b>Crítico</b>: sin integración, error reciente o más de 24h sin sincronizar.<br/>
      • <b>Atención</b>: backlog &gt;50, más de 5 errores en 7d, o más de 2h sin sincronizar.<br/>
      • <b>OK</b>: sincronizando normalmente.
    </p>
    <p style="margin-top:8px;color:#9ca3af;font-size:11px;">Generado automáticamente por ACL Costa Rica · QBO Automator</p>
  </div>
</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Gather all active orgs
    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, name")
      .eq("is_active", true);
    const orgIds = (orgs ?? []).map((o) => o.id);
    if (orgIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "No orgs" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orgsMap = new Map((orgs ?? []).map((o) => [o.id, o.name as string]));

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

    const cursorKeys: string[] = [];
    for (const id of orgIds) cursorKeys.push(`bluehost_resume_skip_${id}`, `hostinger_resume_skip_${id}`);
    const { data: settings } = await supabase
      .from("system_settings")
      .select("key, value, organization_id")
      .in("key", cursorKeys);
    const backlogMap = new Map<string, number>();
    for (const s of settings ?? []) {
      const n = parseInt(String(s.value), 10);
      if (Number.isFinite(n) && n > 0) backlogMap.set(s.organization_id as string, n);
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const rows: OrgRow[] = await Promise.all(
      orgIds.map(async (orgId) => {
        const [lastSync, todayQ, weekQ, monthQ, pendingQ, errQ] = await Promise.all([
          supabase
            .from("sync_logs")
            .select("created_at, status")
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
        ]);

        const serviceType = integMap.get(orgId) ?? null;
        const lastSyncAt = lastSync.data?.created_at ?? null;
        const backlog = backlogMap.get(orgId) ?? 0;
        const hoursSinceSync = lastSyncAt
          ? (Date.now() - new Date(lastSyncAt).getTime()) / 3600000
          : Infinity;

        let health: "ok" | "warning" | "critical" = "ok";
        if (!serviceType) health = "critical";
        else if (lastSync.data?.status === "error" || hoursSinceSync > 24) health = "critical";
        else if (hoursSinceSync > 2 || backlog > 50 || (errQ.count ?? 0) > 5) health = "warning";

        return {
          organization_id: orgId,
          organization_name: orgsMap.get(orgId) ?? "—",
          has_integration: !!serviceType,
          service_type: serviceType,
          last_sync_at: lastSyncAt,
          last_sync_status: lastSync.data?.status ?? null,
          backlog_skip_count: backlog,
          imported_today: todayQ.count ?? 0,
          imported_7d: weekQ.count ?? 0,
          imported_month: monthQ.count ?? 0,
          pending_config: pendingQ.count ?? 0,
          errors_count: errQ.count ?? 0,
          health,
        };
      })
    );

    const order = { critical: 0, warning: 1, ok: 2 } as const;
    rows.sort((a, b) => order[a.health] - order[b.health] || a.organization_name.localeCompare(b.organization_name));

    // Resolve recipients: all admin users
    const { data: adminRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    const adminIds = (adminRoles ?? []).map((r) => r.user_id);
    let recipients: string[] = [];
    if (adminIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("email")
        .in("id", adminIds);
      recipients = (profiles ?? []).map((p) => p.email).filter(Boolean);
    }

    if (recipients.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, sent: 0, message: "No admin recipients", rows }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ ok: false, error: "RESEND_API_KEY missing" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const summary = rows.reduce(
      (a, o) => {
        a[o.health]++;
        return a;
      },
      { ok: 0, warning: 0, critical: 0 } as Record<string, number>
    );
    const subject = `📊 Importación diaria — ${summary.critical} crít. / ${summary.warning} aten. / ${summary.ok} ok`;

    const html = buildHtml(rows);

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "ACL Costa Rica <onboarding@resend.dev>",
        to: recipients,
        subject,
        html,
      }),
    });
    const resendJson = await resendRes.json().catch(() => ({}));
    if (!resendRes.ok) {
      console.error("Resend error:", resendJson);
      return new Response(
        JSON.stringify({ ok: false, error: resendJson, rows }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, sent: recipients.length, recipients, rows_count: rows.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("daily-import-health-report error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
