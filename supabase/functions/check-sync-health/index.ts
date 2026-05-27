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

        // Check if we sent an alert recently (anti-spam: 2 hours)
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const { data: recentAlert } = await supabase
          .from("alert_history")
          .select("id")
          .eq("organization_id", org.id)
          .eq("alert_type", "critical")
          .gte("sent_at", twoHoursAgo)
          .maybeSingle();

        // Only send alert if there are critical issues and no recent alert
        if (criticalIssues.length > 0 && !recentAlert) {
          // Get alert settings
          const { data: settings } = await supabase
            .from("system_settings")
            .select("key, value")
            .eq("organization_id", org.id)
            .in("key", ["alert_enabled", "alert_email"]);

          const settingsMap = settings?.reduce((acc, s) => {
            acc[s.key] = s.value;
            return acc;
          }, {} as Record<string, string>) || {};

          const alertEnabled = settingsMap.alert_enabled !== "false";
          const alertEmail = settingsMap.alert_email || org.email;

          if (alertEnabled && alertEmail) {
            try {
              // Send alert email
              const emailId = await sendAlertEmail(
                { ...org, alertEmail },
                criticalIssues,
                warnings
              );

              // Save to alert history
              await supabase.from("alert_history").insert({
                organization_id: org.id,
                alert_type: "critical",
                issues_count: issues.length,
                issues_data: issues,
                email_id: emailId,
              });

              alertResults.push({
                organization: org.name,
                alertSent: true,
                emailSentTo: alertEmail,
                criticalIssues: criticalIssues.length,
                warnings: warnings.length,
              });

              console.log(`Alert email sent to ${alertEmail} for ${org.name}`);
            } catch (emailError) {
              console.error(`Failed to send alert email for ${org.name}:`, emailError);
              
              // Save alert even if email failed
              await supabase.from("alert_history").insert({
                organization_id: org.id,
                alert_type: "critical",
                issues_count: issues.length,
                issues_data: issues,
                email_id: null,
              });
            }
          } else {
            console.log(`Alerts disabled or no email configured for ${org.name}`);
          }
        } else if (warnings.length > 0) {
          // Save warnings to history without sending email
          await supabase.from("alert_history").insert({
            organization_id: org.id,
            alert_type: "warning",
            issues_count: warnings.length,
            issues_data: warnings,
          });

          alertResults.push({
            organization: org.name,
            alertSent: false,
            criticalIssues: 0,
            warnings: warnings.length,
          });
        }
      } else {
        console.log(`No issues found for ${org.name}`);
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
      title: "No hay sincronizaciones exitosas",
      description: "No se han encontrado sincronizaciones exitosas en el historial",
      actionRequired: "Verificar conexiones de Gmail y QuickBooks",
    };
  }

  const hoursSinceSync =
    (Date.now() - new Date(lastSync.completed_at).getTime()) / (1000 * 60 * 60);

  if (hoursSinceSync > 24) {
    return {
      type: "critical",
      title: "Sin sincronizaciones en 24+ horas",
      description: `Última sincronización exitosa: ${new Date(
        lastSync.completed_at
      ).toLocaleString("es-ES")}`,
      actionRequired: "Revisar estado del sistema y ejecutar sincronización manual",
      data: {
        lastSyncAt: lastSync.completed_at,
        hoursSince: Math.round(hoursSinceSync),
      },
    };
  }

  if (hoursSinceSync > 6) {
    return {
      type: "warning",
      title: "Sincronización retrasada",
      description: `Han pasado ${Math.round(hoursSinceSync)} horas desde la última sincronización`,
      actionRequired: "Monitorear estado del cron job automático",
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
      title: "Alta tasa de fallos en procesamiento",
      description: `${Math.round(failureRate)}% de facturas fallaron (${totalFailed} de ${totalProcessed + totalFailed}) en las últimas 24h`,
      actionRequired: 'Revisar errores en la página "Documentos con Error"',
      data: {
        totalProcessed,
        totalFailed,
        qboFailed,
        failureRate: Math.round(failureRate),
      },
    };
  }

  if (qboFailed > 5) {
    return {
      type: "warning",
      title: "Múltiples errores de QuickBooks",
      description: `${qboFailed} facturas no se pudieron publicar a QuickBooks`,
      actionRequired: "Verificar conexión de QuickBooks y configuración de cuentas",
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
