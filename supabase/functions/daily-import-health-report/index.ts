// Único correo automático del sistema: un aviso al día, solo si hay algo grave
// que impide que entren o se publiquen facturas. Si no hay nada grave, no envía.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Remitente de dominio verificado en Resend.
const ALERT_FROM = "ACL Costa Rica <alertas@aclcostarica.com>";
const RECIPIENT = "monica@aclcostarica.com";

// Solo estos problemas ameritan correo: bloquean la entrada o la publicación.
const CRITICAL_CODES = [
  "mailbox_unreachable",
  "mailbox_cursor_stuck",
  "qbo_disconnected",
  "qbo_token_stale",
  "no_mail_channel",
  "no_recent_invoices",
];

interface CriticalIssue {
  code: string;
  title: string;
  description: string;
  action: string | null;
  since: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-CR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildHtml(byOrg: Map<string, CriticalIssue[]>, appUrl: string): string {
  const blocks = [...byOrg.entries()]
    .map(([orgName, issues]) => {
      const items = issues
        .map(
          (i) => `
        <div style="border:1px solid #E8E2CD;border-left:3px solid #8C3A3A;padding:12px 16px;margin:0 0 10px 0;">
          <p style="margin:0 0 4px;color:#15162C;font-size:15px;font-weight:600;">${esc(i.title)}</p>
          <p style="margin:0;color:rgba(21,22,44,.60);font-size:13px;">${esc(i.description)}</p>
          ${i.since ? `<p style="margin:6px 0 0;color:rgba(21,22,44,.40);font-size:12px;">Desde el ${esc(fmtDate(i.since))}</p>` : ""}
          ${i.action ? `<p style="margin:6px 0 0;color:#15162C;font-size:13px;">Qué hacer: ${esc(i.action)}</p>` : ""}
        </div>`,
        )
        .join("");
      return `
      <div style="margin:0 0 22px;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#B6924F;">${esc(orgName)}</p>
        ${items}
      </div>`;
    })
    .join("");

  const total = [...byOrg.values()].reduce((a, v) => a + v.length, 0);

  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#F4F1E6;font-family:Georgia,'Times New Roman',serif;color:#15162C;">
  <div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E8E2CD;padding:28px;">
    <p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#B6924F;">ACL · Revisión diaria</p>
    <h1 style="margin:0 0 6px;font-size:24px;font-weight:400;">${total} asunto${total === 1 ? "" : "s"} que requiere${total === 1 ? "" : "n"} atención</h1>
    <p style="margin:0 0 22px;color:rgba(21,22,44,.60);font-size:14px;">
      Este es el único aviso automático del día e incluye solamente lo que impide que entren o se publiquen facturas.
      El resto del estado se consulta en el panel.
    </p>
    ${blocks}
    <p style="margin:24px 0 0;">
      <a href="${esc(appUrl)}" style="display:inline-block;border:1px solid #B6924F;padding:10px 18px;color:#15162C;text-decoration:none;font-size:14px;">Abrir el panel</a>
    </p>
  </div>
</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    let dryRun = false;
    try {
      const body = await req.json();
      dryRun = body?.dry_run === true;
    } catch (_) {
      // sin cuerpo — ejecución por cron
    }

    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, name")
      .eq("is_active", true);
    const orgNames = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));

    const { data: openAlerts, error } = await supabase
      .from("alert_history")
      .select("organization_id, issues_data, created_at")
      .eq("resolved", false)
      .order("created_at", { ascending: true });
    if (error) throw error;

    // Agrupar por empresa, un solo renglón por código.
    const byOrg = new Map<string, CriticalIssue[]>();
    for (const row of openAlerts ?? []) {
      const orgName = orgNames.get(row.organization_id as string);
      if (!orgName) continue; // empresa inactiva o borrada
      const items = Array.isArray(row.issues_data) ? row.issues_data : [row.issues_data];
      for (const it of items) {
        const code = (it as any)?.code;
        if (!code || !CRITICAL_CODES.includes(code)) continue;
        const list = byOrg.get(orgName) ?? [];
        if (list.some((x) => x.code === code)) continue;
        list.push({
          code,
          title: (it as any)?.title ?? code,
          description: (it as any)?.description ?? "",
          action: (it as any)?.actionRequired ?? null,
          since: row.created_at as string,
        });
        byOrg.set(orgName, list);
      }
    }

    const total = [...byOrg.values()].reduce((a, v) => a + v.length, 0);
    const summary = [...byOrg.entries()].map(([org, issues]) => ({
      organization: org,
      codes: issues.map((i) => i.code),
    }));

    if (total === 0) {
      console.log("Sin problemas críticos abiertos: no se envía correo.");
      return new Response(
        JSON.stringify({ ok: true, sent: false, reason: "nothing_critical", summary }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (dryRun) {
      return new Response(JSON.stringify({ ok: true, sent: false, dry_run: true, total, summary }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "RESEND_API_KEY missing", summary }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const appUrl = Deno.env.get("APP_URL") ?? "https://facturas.aclcostarica.com";
    const orgCount = byOrg.size;
    const subject = `ACL · ${total} asunto${total === 1 ? "" : "s"} pendiente${total === 1 ? "" : "s"} en ${orgCount} empresa${orgCount === 1 ? "" : "s"}`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: ALERT_FROM,
        to: [RECIPIENT],
        subject,
        html: buildHtml(byOrg, appUrl),
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("Resend error:", json);
      return new Response(JSON.stringify({ ok: false, error: json, summary }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ ok: true, sent: true, email_id: (json as any)?.id ?? null, total, summary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("daily-import-health-report error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
