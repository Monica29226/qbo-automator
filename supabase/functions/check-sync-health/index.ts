import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface HealthIssue {
  type: "critical" | "warning" | "info";
  code: string;
  title: string;
  description: string;
  actionRequired: string;
  action_link?: string;
  data?: any;
}

// Known alert codes — used for dedup and auto-resolve.
const KNOWN_CODES = [
  "no_successful_sync",
  "sync_no_24h",
  "sync_delayed",
  "high_failure_rate",
  "qbo_failed",
  "ai_credits_exhausted",
  "no_mail_channel",
  "qbo_disconnected",
  "stuck_review",
];

interface Organization {
  id: string;
  name: string;
  email: string;
  gmail_connected: boolean;
  outlook_connected: boolean;
  hostinger_connected: boolean;
  bluehost_connected: boolean;
  quickbooks_connected: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    console.log("Starting sync health check...");

    // Get all active organizations
    const { data: orgs, error: orgsError } = await supabase
      .from("organizations")
      .select("id, name, email, gmail_connected, outlook_connected, hostinger_connected, bluehost_connected, quickbooks_connected")
      .eq("is_active", true);

    if (orgsError) {
      throw new Error(`Failed to fetch organizations: ${orgsError.message}`);
    }

    const alertResults = [];

    for (const org of orgs || []) {
      console.log(`Checking health for organization: ${org.name}`);
      
      const issues: HealthIssue[] = [];

      // Run all health checks
      const checks = await Promise.all([
        checkLastSuccessfulSync(supabase, org.id),
        checkFailureRate(supabase, org.id),
        checkAICredits(supabase, org.id),
        checkConnections(org),
        checkStuckInvoices(supabase, org.id),
      ]);

      checks.forEach((issue) => {
        if (issue) issues.push(issue);
      });

      // If there are issues, handle alerts
      if (issues.length > 0) {
        const criticalIssues = issues.filter((i) => i.type === "critical");
        const warnings = issues.filter((i) => i.type === "warning");

        console.log(`Found ${criticalIssues.length} critical and ${warnings.length} warning issues for ${org.name}`);

        // Upsert alerts: dedup by code within unresolved rows for this org.
        const { data: unresolved } = await supabase
          .from("alert_history")
          .select("id, issues_data")
          .eq("organization_id", org.id)
          .eq("resolved", false);

        const byCode = new Map<string, string>(); // code -> row id
        for (const r of unresolved || []) {
          const items = Array.isArray(r.issues_data) ? r.issues_data : [r.issues_data];
          for (const it of items) {
            if (it?.code) byCode.set(it.code, r.id);
          }
        }

        const activeCodes = new Set(issues.map((i) => i.code));
        const nowIso = new Date().toISOString();

        for (const issue of issues) {
          const payload = [{
            type: issue.type,
            code: issue.code,
            title: issue.title,
            description: issue.description,
            actionRequired: issue.actionRequired,
            action_link: issue.action_link,
            data: issue.data,
          }];

          const existingId = byCode.get(issue.code);
          if (existingId) {
            await supabase
              .from("alert_history")
              .update({ issues_data: payload, sent_at: nowIso, alert_type: issue.type })
              .eq("id", existingId);
          } else {
            await supabase.from("alert_history").insert({
              organization_id: org.id,
              alert_type: issue.type,
              issues_count: 1,
              issues_data: payload,
            });
          }
        }

        // Auto-resolve previously-open alerts whose condition no longer holds.
        const staleIds: string[] = [];
        for (const r of unresolved || []) {
          const items = Array.isArray(r.issues_data) ? r.issues_data : [r.issues_data];
          const codes = items.map((i: any) => i?.code).filter(Boolean);
          // Auto-resolve only known codes that are no longer in activeCodes.
          if (codes.length > 0 && codes.every((c: string) => KNOWN_CODES.includes(c) && !activeCodes.has(c))) {
            staleIds.push(r.id);
          }
        }
        if (staleIds.length > 0) {
          await supabase
            .from("alert_history")
            .update({ resolved: true, resolved_at: nowIso })
            .in("id", staleIds);
        }

        // Optional: send critical email (anti-spam 2h) — kept as before.
        const criticalIssues = issues.filter((i) => i.type === "critical");
        if (criticalIssues.length > 0) {
          const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
          const { data: recentEmailAlert } = await supabase
            .from("alert_history")
            .select("id")
            .eq("organization_id", org.id)
            .not("email_id", "is", null)
            .gte("sent_at", twoHoursAgo)
            .maybeSingle();

          if (!recentEmailAlert) {
            const { data: settings } = await supabase
              .from("system_settings")
              .select("key, value")
              .eq("organization_id", org.id)
              .in("key", ["alert_enabled", "alert_email"]);
            const settingsMap = (settings || []).reduce((acc: any, s: any) => {
              acc[s.key] = s.value;
              return acc;
            }, {});
            const alertEnabled = settingsMap.alert_enabled !== "false";
            const alertEmail = settingsMap.alert_email || org.email;
            if (alertEnabled && alertEmail) {
              try {
                const emailId = await sendAlertEmail(
                  { ...org, alertEmail },
                  criticalIssues,
                  issues.filter((i) => i.type === "warning")
                );
                // Attach email_id to the most recent critical row for this org.
                const { data: lastRow } = await supabase
                  .from("alert_history")
                  .select("id")
                  .eq("organization_id", org.id)
                  .eq("alert_type", "critical")
                  .order("sent_at", { ascending: false })
                  .limit(1)
                  .maybeSingle();
                if (lastRow?.id) {
                  await supabase
                    .from("alert_history")
                    .update({ email_id: emailId })
                    .eq("id", lastRow.id);
                }
              } catch (emailError) {
                console.error(`Email send failed for ${org.name}:`, emailError);
              }
            }
          }
        }

        alertResults.push({
          organization: org.name,
          activeCodes: Array.from(activeCodes),
          autoResolved: staleIds.length,
        });
      } else {
        // No issues — auto-resolve all open alerts for this org.
        await supabase
          .from("alert_history")
          .update({ resolved: true, resolved_at: new Date().toISOString() })
          .eq("organization_id", org.id)
          .eq("resolved", false);
        console.log(`No issues found for ${org.name}, cleared open alerts`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        organizationsChecked: orgs?.length || 0,
        alerts: alertResults,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error in check-sync-health:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

// Health check functions
async function checkLastSuccessfulSync(
  supabase: any,
  orgId: string
): Promise<HealthIssue | null> {
  const { data: lastSync } = await supabase
    .from("sync_logs")
    .select("completed_at, status")
    .eq("organization_id", orgId)
    .eq("status", "success")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastSync) {
    return {
      type: "critical",
      code: "no_successful_sync",
      title: "No hay sincronizaciones exitosas",
      description: "No se han encontrado sincronizaciones exitosas en el historial",
      actionRequired: "Verificar conexiones de Gmail y QuickBooks",
      action_link: "/integrations",
    };
  }

  const hoursSinceSync =
    (Date.now() - new Date(lastSync.completed_at).getTime()) / (1000 * 60 * 60);

  if (hoursSinceSync > 24) {
    return {
      type: "critical",
      code: "sync_no_24h",
      title: "Sin sincronizaciones en 24+ horas",
      description: `Última sincronización exitosa: ${new Date(
        lastSync.completed_at
      ).toLocaleString("es-ES")}`,
      actionRequired: "Revisar estado del sistema y ejecutar sincronización manual",
      action_link: "/dashboard",
      data: { lastSyncAt: lastSync.completed_at, hoursSince: Math.round(hoursSinceSync) },
    };
  }

  if (hoursSinceSync > 6) {
    return {
      type: "warning",
      code: "sync_delayed",
      title: "Sincronización retrasada",
      description: `Han pasado ${Math.round(hoursSinceSync)} horas desde la última sincronización`,
      actionRequired: "Monitorear estado del cron job automático",
      action_link: "/dashboard",
      data: { hoursSince: Math.round(hoursSinceSync) },
    };
  }

  return null;
}

async function checkFailureRate(
  supabase: any,
  orgId: string
): Promise<HealthIssue | null> {
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: recentSyncs } = await supabase
    .from("sync_logs")
    .select("status, gmail_processed, gmail_failed, qbo_published, qbo_failed")
    .eq("organization_id", orgId)
    .gte("created_at", last24h);

  if (!recentSyncs || recentSyncs.length === 0) {
    return null;
  }

  const totalProcessed = recentSyncs.reduce(
    (sum: number, s: any) => sum + (s.gmail_processed || 0),
    0
  );
  const totalFailed = recentSyncs.reduce(
    (sum: number, s: any) => sum + (s.gmail_failed || 0),
    0
  );
  const qboFailed = recentSyncs.reduce(
    (sum: number, s: any) => sum + (s.qbo_failed || 0),
    0
  );

  const failureRate =
    totalProcessed + totalFailed > 0
      ? (totalFailed / (totalProcessed + totalFailed)) * 100
      : 0;

  if (failureRate > 50 && totalFailed > 5) {
    return {
      type: "critical",
      code: "high_failure_rate",
      title: "Alta tasa de fallos en procesamiento",
      description: `${Math.round(failureRate)}% de facturas fallaron (${totalFailed} de ${totalProcessed + totalFailed}) en las últimas 24h`,
      actionRequired: 'Revisar errores en la página "Documentos con Error"',
      action_link: "/error-documents",
      data: { totalProcessed, totalFailed, qboFailed, failureRate: Math.round(failureRate) },
    };
  }

  if (qboFailed > 5) {
    return {
      type: "warning",
      code: "qbo_failed",
      title: "Múltiples errores de QuickBooks",
      description: `${qboFailed} facturas no se pudieron publicar a QuickBooks`,
      actionRequired: "Verificar conexión de QuickBooks y configuración de cuentas",
      action_link: "/error-documents",
      data: { qboFailed },
    };
  }

  return null;
}

async function checkAICredits(
  supabase: any,
  orgId: string
): Promise<HealthIssue | null> {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: recentErrors } = await supabase
    .from("processed_documents")
    .select("error_message")
    .eq("organization_id", orgId)
    .eq("status", "error")
    .gte("created_at", yesterday);

  const creditErrors =
    recentErrors?.filter(
      (e: any) =>
        e.error_message?.toLowerCase().includes("payment required") ||
        e.error_message?.toLowerCase().includes("credits") ||
        e.error_message?.toLowerCase().includes("402")
    ).length || 0;

  if (creditErrors > 10) {
    return {
      type: "critical",
      title: "Créditos de IA agotados",
      description: `${creditErrors} facturas bloqueadas por falta de créditos de IA`,
      actionRequired: "Agregar créditos en https://docs.lovable.dev/features/ai",
      data: { creditErrorCount: creditErrors },
    };
  }

  return null;
}

function checkConnections(org: Organization): HealthIssue | null {
  const hasAnyMail =
    org.gmail_connected || org.outlook_connected ||
    org.hostinger_connected || org.bluehost_connected;

  if (!hasAnyMail) {
    return {
      type: "critical",
      title: "Sin canal de correo conectado",
      description: "No hay ninguna cuenta de correo activa (Gmail, Outlook, Hostinger o Bluehost)",
      actionRequired: "Conectar al menos un proveedor de correo en Configuración > Integraciones",
    };
  }

  if (!org.quickbooks_connected) {
    return {
      type: "critical",
      title: "QuickBooks desconectado",
      description: "La cuenta de QuickBooks no está conectada",
      actionRequired: "Reconectar QuickBooks en Configuración > Integraciones",
    };
  }

  return null;
}

async function checkStuckInvoices(
  supabase: any,
  orgId: string
): Promise<HealthIssue | null> {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  const { data: reviewDocs } = await supabase
    .from("processed_documents")
    .select("id")
    .eq("organization_id", orgId)
    .eq("status", "review")
    .lte("created_at", threeDaysAgo);

  const count = reviewDocs?.length || 0;

  if (count > 10) {
    return {
      type: "warning",
      title: "Facturas pendientes de revisión",
      description: `${count} facturas llevan más de 3 días en estado "review"`,
      actionRequired: 'Clasificar vendors pendientes en "Cola de Revisión"',
      data: { stuckInvoices: count },
    };
  }

  return null;
}

async function sendAlertEmail(
  org: { name: string; alertEmail: string },
  criticalIssues: HealthIssue[],
  warnings: HealthIssue[]
): Promise<string> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

  if (!RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY not configured");
  }

  const criticalHTML = criticalIssues
    .map(
      (issue) => `
    <div style="background: #fee2e2; border-left: 4px solid #dc2626; padding: 16px; margin: 16px 0; border-radius: 4px;">
      <h3 style="color: #991b1b; margin: 0 0 8px 0; font-size: 16px;">🚨 ${issue.title}</h3>
      <p style="margin: 8px 0; color: #1f2937;">${issue.description}</p>
      <p style="margin: 8px 0; font-weight: bold; color: #1f2937;">
        <strong>Acción requerida:</strong> ${issue.actionRequired}
      </p>
    </div>
  `
    )
    .join("");

  const warningsHTML =
    warnings.length > 0
      ? warnings
          .map(
            (issue) => `
    <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin: 16px 0; border-radius: 4px;">
      <h3 style="color: #92400e; margin: 0 0 8px 0; font-size: 16px;">⚠️ ${issue.title}</h3>
      <p style="margin: 8px 0; color: #1f2937;">${issue.description}</p>
      <p style="margin: 8px 0; color: #1f2937;">
        <strong>Sugerencia:</strong> ${issue.actionRequired}
      </p>
    </div>
  `
          )
          .join("")
      : "";

  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "InvoiceFlow Alerts <alerts@resend.dev>",
      to: [org.alertEmail],
      subject: `🚨 Alerta: Problemas en ${org.name} - ${criticalIssues.length} críticos`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: #dc2626; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 24px;">🚨 Alerta del Sistema</h1>
          </div>
          
          <div style="background: #ffffff; padding: 20px; border: 1px solid #e5e7eb; border-top: none;">
            <p style="margin: 0 0 16px 0; font-size: 16px; color: #1f2937;">
              Se han detectado problemas en la sincronización de facturas para <strong>${org.name}</strong>:
            </p>
            
            <h2 style="color: #dc2626; font-size: 18px; margin: 24px 0 12px 0;">
              Problemas Críticos (${criticalIssues.length})
            </h2>
            ${criticalHTML}
            
            ${
              warnings.length > 0
                ? `
              <h2 style="color: #f59e0b; font-size: 18px; margin: 24px 0 12px 0;">
                Advertencias (${warnings.length})
              </h2>
              ${warningsHTML}
            `
                : ""
            }
            
            <div style="margin-top: 32px; padding: 20px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;">
              <p style="margin: 0 0 12px 0; font-size: 16px; font-weight: bold; color: #1f2937;">
                ¿Qué hacer ahora?
              </p>
              <ol style="margin: 0; padding-left: 20px; color: #1f2937;">
                <li style="margin-bottom: 8px;">Inicia sesión en tu dashboard</li>
                <li style="margin-bottom: 8px;">Revisa la sección "Documentos con Error"</li>
                <li style="margin-bottom: 8px;">Verifica las conexiones de Gmail y QuickBooks</li>
                <li style="margin-bottom: 8px;">Ejecuta una sincronización manual si es necesario</li>
              </ol>
            </div>
            
            <p style="color: #6b7280; font-size: 12px; margin-top: 24px; padding-top: 24px; border-top: 1px solid #e5e7eb;">
              Esta es una alerta automática del sistema InvoiceFlow.<br>
              Para gestionar estas alertas, ve a Configuración > Notificaciones en tu dashboard.
            </p>
          </div>
        </div>
      `,
    }),
  });

  if (!emailResponse.ok) {
    const errorText = await emailResponse.text();
    throw new Error(`Failed to send alert email: ${errorText}`);
  }

  const data = await emailResponse.json();
  console.log(`Alert email sent successfully. Email ID: ${data.id}`);

  return data.id;
}
