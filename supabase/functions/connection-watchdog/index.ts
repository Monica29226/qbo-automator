// Connection watchdog — detects disconnected companies (QuickBooks / correo)
// and emails the admins immediately. Also emails a recovery notice when the
// connection comes back. Deduplicated so it never spams: one email per
// organization+problem, re-sent as a reminder only every 24h.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALERT_TYPE = "connection_email";
const REMINDER_HOURS = 24;
const MAIL_SERVICES = ["gmail", "outlook", "outlook_imap", "hostinger", "bluehost"];

type Problem = {
  code: "qbo_disconnected" | "no_mail_channel";
  title: string;
  detail: string;
};

function fmtDate(iso: string | null) {
  if (!iso) return "sin registro";
  return new Date(iso).toLocaleString("es-CR", { dateStyle: "medium", timeStyle: "short" });
}

function expiresAtMs(credentials: any): number | null {
  const raw = credentials?.expires_at;
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "number") return raw;
  if (/^\d+$/.test(String(raw))) return parseInt(String(raw), 10);
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : null;
}

function buildHtml(opts: {
  orgName: string;
  problems: Problem[];
  lastSyncAt: string | null;
  pendingPublish: number;
  appUrl: string;
  recovered?: boolean;
}) {
  const { orgName, problems, lastSyncAt, pendingPublish, appUrl, recovered } = opts;
  const accent = recovered ? "#0f766e" : "#b91c1c";
  const heading = recovered
    ? `Conexión restablecida — ${orgName}`
    : `Conexión caída — ${orgName}`;
  const intro = recovered
    ? "La conexión de esta empresa volvió a funcionar. El sistema retoma la sincronización y la publicación automáticamente."
    : "Esta empresa dejó de estar conectada. Mientras siga así, no se importan ni se publican documentos.";

  const list = problems
    .map(
      (p) => `<li style="margin-bottom:8px;">
        <b>${p.title}</b><br/>
        <span style="color:#475569;">${p.detail}</span>
      </li>`
    )
    .join("");

  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
    <div style="background:${accent};padding:18px 24px;color:#ffffff;">
      <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;opacity:.85;">ACL — Accounting Consulting Leaders</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px;">${heading}</div>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">${intro}</p>
      ${problems.length ? `<ul style="margin:0 0 16px;padding-left:18px;font-size:14px;line-height:1.5;">${list}</ul>` : ""}
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;font-variant-numeric:tabular-nums;">
        <tr><td style="padding:8px 0;color:#64748b;">Última sincronización</td><td style="padding:8px 0;text-align:right;font-weight:600;">${fmtDate(lastSyncAt)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Documentos esperando publicación</td><td style="padding:8px 0;text-align:right;font-weight:600;">${pendingPublish.toLocaleString("en-US")}</td></tr>
      </table>
      ${
        recovered
          ? ""
          : `<a href="${appUrl}/integrations" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-size:14px;font-weight:600;">Reconectar ahora</a>
      <p style="margin:16px 0 0;font-size:12px;color:#64748b;">La reconexión de QuickBooks es un OAuth: debe autorizarla una persona con acceso a la empresa.</p>`
      }
    </div>
    <div style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;">
      Aviso automático de FacturaFlow · ACL Costa Rica
    </div>
  </div>
</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch (_) {
      body = {};
    }
    const dryRun = body?.dry_run === true;
    const appUrl = (body?.app_url as string) || "https://facturas.aclcostarica.com";

    const { data: orgs, error: orgsError } = await supabase
      .from("organizations")
      .select("id, name")
      .eq("is_active", true);
    if (orgsError) throw new Error(orgsError.message);
    const orgIds = (orgs ?? []).map((o) => o.id);
    if (orgIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, checked: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Integrations for all orgs
    const { data: integrations } = await supabase
      .from("integration_accounts")
      .select("organization_id, service_type, is_active, credentials, updated_at")
      .in("organization_id", orgIds);

    // Recipients: all admins
    const { data: adminRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    const adminIds = (adminRoles ?? []).map((r) => r.user_id);
    let recipients: string[] = [];
    if (adminIds.length > 0) {
      const { data: profiles } = await supabase.from("profiles").select("email").in("id", adminIds);
      recipients = (profiles ?? []).map((p: any) => p.email).filter(Boolean);
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const nowMs = Date.now();
    const nowIso = new Date().toISOString();
    const results: any[] = [];

    for (const org of orgs ?? []) {
      const orgIntegrations = (integrations ?? []).filter((i) => i.organization_id === org.id);

      // --- QuickBooks state ---
      const qbo = orgIntegrations
        .filter((i) => i.service_type === "quickbooks")
        .sort((a, b) => Date.parse(b.updated_at ?? "") - Date.parse(a.updated_at ?? ""))[0];

      const problems: Problem[] = [];

      if (!qbo) {
        problems.push({
          code: "qbo_disconnected",
          title: "QuickBooks nunca fue conectado",
          detail: "No existe una conexión de QuickBooks para esta empresa.",
        });
      } else {
        const exp = expiresAtMs(qbo.credentials);
        const hasRefresh = Boolean((qbo.credentials as any)?.refresh_token);
        // Access tokens last ~1h and are auto-renewed. Treat as disconnected when
        // the integration was deactivated, the refresh token is gone, or the
        // access token has been expired for more than 24h (renewal is failing).
        const staleFor24h = exp !== null && nowMs - exp > 24 * 60 * 60 * 1000;
        if (!qbo.is_active || !hasRefresh || staleFor24h) {
          problems.push({
            code: "qbo_disconnected",
            title: "QuickBooks desconectado",
            detail: !hasRefresh
              ? "Se perdió el token de renovación; hay que volver a autorizar la conexión."
              : !qbo.is_active
                ? "La integración quedó inactiva (token revocado o expirado)."
                : `El token no se ha podido renovar desde ${fmtDate(new Date(exp!).toISOString())}.`,
          });
        }
      }

      // --- Mail channel state ---
      const activeMail = orgIntegrations.filter(
        (i) => i.is_active && MAIL_SERVICES.includes(i.service_type)
      );
      if (activeMail.length === 0) {
        problems.push({
          code: "no_mail_channel",
          title: "Sin canal de correo activo",
          detail:
            "Ninguna cuenta de correo (Gmail, Outlook, Hostinger o Bluehost) está activa, así que no entran facturas nuevas.",
        });
      }

      // Context numbers
      const { data: lastSync } = await supabase
        .from("sync_logs")
        .select("created_at")
        .eq("organization_id", org.id)
        .order("created_at", { ascending: false })
        .limit(1);
      const lastSyncAt = lastSync?.[0]?.created_at ?? null;

      const { count: pendingPublish } = await supabase
        .from("processed_documents")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", org.id)
        .in("status", ["processed", "publishing", "pending"]);

      // Existing open email alerts for this org
      const { data: openAlerts } = await supabase
        .from("alert_history")
        .select("id, issues_data, sent_at, created_at")
        .eq("organization_id", org.id)
        .eq("alert_type", ALERT_TYPE)
        .eq("resolved", false);

      const openByCode = new Map<string, any>();
      for (const row of openAlerts ?? []) {
        const items = Array.isArray(row.issues_data) ? row.issues_data : [row.issues_data];
        for (const it of items) if (it?.code) openByCode.set(it.code, row);
      }

      const activeCodes = new Set(problems.map((p) => p.code));

      // 1) New / reminder emails
      const toNotify: Problem[] = [];
      for (const p of problems) {
        const existing = openByCode.get(p.code);
        if (!existing) {
          toNotify.push(p);
          continue;
        }
        if (!existing.sent_at) {
          // Alert row exists but the email never went out — send it now.
          toNotify.push(p);
          continue;
        }
        const last = Date.parse(existing.sent_at) || 0;
        if (nowMs - last > REMINDER_HOURS * 60 * 60 * 1000) toNotify.push(p);
      }

      let emailed = false;
      if (toNotify.length > 0 && recipients.length > 0 && RESEND_API_KEY && !dryRun) {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "ACL Costa Rica <alertas@aureoncr.com>",
            to: recipients,
            subject: `🔴 ${org.name} está desconectada — ${toNotify.map((p) => p.title).join(" · ")}`,
            html: buildHtml({
              orgName: org.name,
              problems: toNotify,
              lastSyncAt,
              pendingPublish: pendingPublish ?? 0,
              appUrl,
            }),
          }),
        });
        emailed = res.ok;
        if (!res.ok) console.error("Resend error", await res.text());
      }

      // Persist / refresh alert rows
      if (!dryRun) {
        for (const p of problems) {
          const existing = openByCode.get(p.code);
          const payload = [
            {
              type: "critical",
              code: p.code,
              title: p.title,
              description: p.detail,
              actionRequired: "Reconectar en Configuración > Integraciones",
              action_link: "/integrations",
            },
          ];
          if (existing) {
            const patch: any = { issues_data: payload };
            if (toNotify.some((n) => n.code === p.code) && emailed) patch.sent_at = nowIso;
            await supabase.from("alert_history").update(patch).eq("id", existing.id);
          } else {
            await supabase.from("alert_history").insert({
              organization_id: org.id,
              alert_type: ALERT_TYPE,
              issues_count: 1,
              issues_data: payload,
              sent_at: emailed ? nowIso : null,
            });
          }
        }

        // 2) Auto-resolve + recovery email
        const recovered: string[] = [];
        for (const [code, row] of openByCode.entries()) {
          if (activeCodes.has(code)) continue;
          await supabase
            .from("alert_history")
            .update({ resolved: true, resolved_at: nowIso })
            .eq("id", row.id);
          recovered.push(code);
        }
        if (recovered.length > 0 && recipients.length > 0 && RESEND_API_KEY) {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "ACL Costa Rica <alertas@aureoncr.com>",
              to: recipients,
              subject: `🟢 ${org.name} volvió a estar conectada`,
              html: buildHtml({
                orgName: org.name,
                problems: [],
                lastSyncAt,
                pendingPublish: pendingPublish ?? 0,
                appUrl,
                recovered: true,
              }),
            }),
          });
        }
      }

      results.push({
        organization: org.name,
        organization_id: org.id,
        problems: problems.map((p) => p.code),
        notified: toNotify.map((p) => p.code),
        emailed,
        last_sync_at: lastSyncAt,
        pending_publish: pendingPublish ?? 0,
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        dry_run: dryRun,
        recipients,
        checked: results.length,
        disconnected: results.filter((r) => r.problems.length > 0).length,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("connection-watchdog error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
