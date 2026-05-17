import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Severity = "critical" | "warning" | "info";

interface AlertSpec {
  code: string;
  severity: Severity;
  title: string;
  description: string;
  action?: string;
  action_link?: string;
  count?: number;
  metadata?: Record<string, any>;
}

const PROVIDERS = ["gmail", "outlook", "hostinger", "bluehost"] as const;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: orgs, error: orgsError } = await supabase
      .from("organizations")
      .select("id, name, gmail_connected, outlook_connected, hostinger_connected, bluehost_connected, quickbooks_connected")
      .eq("is_active", true);

    if (orgsError) throw orgsError;

    const summary: any[] = [];

    for (const org of orgs || []) {
      try {
        const created = await checkOrganization(supabase, org);
        summary.push({ org: org.name, alerts_created: created });
      } catch (e: any) {
        console.error(`[${org.name}] check failed:`, e?.message);
        summary.push({ org: org.name, error: e?.message });
      }
    }

    return new Response(
      JSON.stringify({ success: true, timestamp: new Date().toISOString(), organizations: summary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("check-system-health failed:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function checkOrganization(supabase: any, org: any): Promise<number> {
  const orgId = org.id;
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();

  const checks: AlertSpec[] = [];

  // 1. Procesadas pero no publicadas (>24h)
  {
    const { count } = await supabase
      .from("processed_documents")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "processed")
      .is("qbo_entity_id", null)
      .lt("created_at", iso(now - 24 * 3600 * 1000));
    if ((count || 0) > 0) {
      checks.push({
        code: "processed_not_published",
        severity: "warning",
        title: "Facturas pendientes de publicar a QBO",
        description: `${count} facturas están procesadas pero no se han publicado a QuickBooks desde hace más de 24h.`,
        action: "Ir a Documentos con Error",
        action_link: "/error-documents",
        count: count || 0,
      });
    }
  }

  // 2. En revisión >48h
  {
    const { count } = await supabase
      .from("processed_documents")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "review")
      .lt("created_at", iso(now - 48 * 3600 * 1000));
    if ((count || 0) > 0) {
      checks.push({
        code: "review_stuck",
        severity: "warning",
        title: "Facturas en revisión hace más de 48h",
        description: `${count} facturas llevan más de 48 horas en estado de revisión esperando clasificación.`,
        action: "Ir a Cola de Revisión",
        action_link: "/review-queue",
        count: count || 0,
      });
    }
  }

  // 3. Errores acumulados (>=5 en 7 días)
  {
    const { count } = await supabase
      .from("processed_documents")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "error")
      .gt("created_at", iso(now - 7 * 24 * 3600 * 1000));
    if ((count || 0) >= 5) {
      checks.push({
        code: "errors_accumulated",
        severity: "critical",
        title: "Múltiples facturas con error esta semana",
        description: `${count} facturas han fallado en los últimos 7 días.`,
        action: "Revisar errores",
        action_link: "/error-documents",
        count: count || 0,
      });
    }
  }

  // 4. Sin facturas recientes (con histórico >=10)
  {
    const { count: total } = await supabase
      .from("processed_documents")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId);
    if ((total || 0) >= 10) {
      const { data: latest } = await supabase
        .from("processed_documents")
        .select("created_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest?.created_at) {
        const days = Math.floor((now - new Date(latest.created_at).getTime()) / (24 * 3600 * 1000));
        if (days >= 7) {
          checks.push({
            code: "no_recent_invoices",
            severity: "warning",
            title: `No han llegado facturas en ${days} días`,
            description: `La última factura recibida fue hace ${days} días. Verifique que el correo siga llegando correctamente.`,
            action: "Recuperar facturas pendientes",
            action_link: "/dashboard?action=recover",
            count: days,
          });
        }
      }
    }
  }

  // 5. Inconsistencia entre organizations.{provider}_connected y integration_accounts
  {
    const { data: integrations } = await supabase
      .from("integration_accounts")
      .select("service_type, is_active")
      .eq("organization_id", orgId);
    const activeSet = new Set(
      (integrations || []).filter((i: any) => i.is_active).map((i: any) => i.service_type)
    );
    for (const provider of PROVIDERS) {
      if (org[`${provider}_connected`] && !activeSet.has(provider)) {
        checks.push({
          code: `mail_integration_inconsistent_${provider}`,
          severity: "critical",
          title: `Integración ${provider} desconectada`,
          description: `La organización tiene ${provider} marcado como conectado, pero no hay una cuenta de integración activa.`,
          action: "Reconectar desde Integraciones",
          action_link: "/integrations",
          metadata: { provider },
        });
      }
    }
  }

  // 6. Token QBO próximo a expirar (<2h)
  {
    const { data: qbo } = await supabase
      .from("integration_accounts")
      .select("credentials, account_email")
      .eq("organization_id", orgId)
      .eq("service_type", "quickbooks")
      .eq("is_active", true)
      .maybeSingle();
    const expiresAt = qbo?.credentials?.expires_at;
    if (expiresAt) {
      const expMs = typeof expiresAt === "number" ? expiresAt : new Date(expiresAt).getTime();
      if (!isNaN(expMs) && expMs - now < 2 * 3600 * 1000) {
        checks.push({
          code: "qbo_token_expiring",
          severity: "warning",
          title: "Token QBO expira pronto",
          description: `El token de QuickBooks expira en menos de 2 horas (${new Date(expMs).toLocaleString("es-CR")}).`,
          action: "Reconectar QuickBooks",
          action_link: "/integrations",
        });
      }
    }
  }

  // 7. Backlog sin procesar: 0 facturas en 24h pero correo activo >24h
  {
    const { count: recentDocs } = await supabase
      .from("processed_documents")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gt("created_at", iso(now - 24 * 3600 * 1000));

    if ((recentDocs || 0) === 0) {
      const { data: oldestActiveMail } = await supabase
        .from("integration_accounts")
        .select("created_at, service_type")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .in("service_type", PROVIDERS as unknown as string[])
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (oldestActiveMail?.created_at && now - new Date(oldestActiveMail.created_at).getTime() > 24 * 3600 * 1000) {
        checks.push({
          code: "mail_backlog_suspected",
          severity: "critical",
          title: "Posible backlog en correo",
          description: "No se han recibido facturas en las últimas 24h, pero el correo está activo. Puede haber correos sin procesar.",
          action: "Recuperar facturas pendientes",
          action_link: "/dashboard?action=recover",
        });
      }
    }
  }

  // 8. Facturas con divisa incompatible (currency_mismatch)
  {
    const { count } = await supabase
      .from("processed_documents")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "currency_mismatch");
    if ((count || 0) > 0) {
      checks.push({
        code: "currency_mismatch",
        severity: "warning",
        title: "Facturas con divisa incompatible",
        description: `${count} factura(s) no se pueden publicar por incompatibilidad de divisa con QBO. Configura multi-currency en QBO o registra manualmente.`,
        action: "Revisar",
        action_link: "/error-documents",
        count: count || 0,
      });
    }
  }

  // Anti-duplicación por (organization_id, code) en últimas 4h.
  // Si existe un row no resuelto reciente, incrementar issues_count en vez de insertar.
  if (checks.length === 0) return 0;

  const fourHoursAgo = iso(now - 4 * 3600 * 1000);
  const { data: recent } = await supabase
    .from("alert_history")
    .select("id, issues_data, issues_count, resolved, created_at")
    .eq("organization_id", orgId)
    .eq("resolved", false)
    .gte("created_at", fourHoursAgo);

  const recentByCode = new Map<string, any>();
  for (const r of recent || []) {
    const code = Array.isArray(r.issues_data) ? r?.issues_data?.[0]?.code : r?.issues_data?.code;
    if (code) recentByCode.set(code, r);
  }

  let createdOrUpdated = 0;
  for (const c of checks) {
    const issuePayload = {
      type: c.severity,
      title: c.title,
      description: c.description,
      code: c.code,
      actionRequired: c.action || "",
      action_link: c.action_link,
      metadata: c.metadata,
    };

    const existing = recentByCode.get(c.code);
    if (existing) {
      const { error } = await supabase
        .from("alert_history")
        .update({
          issues_count: (existing.issues_count || 1) + 1,
          issues_data: [issuePayload],
        })
        .eq("id", existing.id);
      if (error) console.error(`[${org.name}] update alert failed:`, error.message);
      else createdOrUpdated++;
    } else {
      const { error } = await supabase.from("alert_history").insert({
        organization_id: orgId,
        alert_type: c.severity,
        issues_count: c.count ?? 1,
        issues_data: [issuePayload],
      });
      if (error) console.error(`[${org.name}] insert alert failed:`, error.message);
      else createdOrUpdated++;
    }
  }

  console.log(`[${org.name}] processed ${createdOrUpdated} alerts (${checks.map((c) => c.code).join(", ")})`);
  return createdOrUpdated;
}
