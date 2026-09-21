// Envío centralizado de correos de alerta.
// El dominio verificado en Resend es dashboard.aclcostarica.com; cualquier otro
// remitente hace que Resend rechace el envío y la alerta quede en silencio.
export const ALERT_FROM = "ACL Costa Rica <alertas@aclcostarica.com>";

// Destinataria global de todos los avisos del sistema.
export const GLOBAL_ALERT_RECIPIENT = "monica@aclcostarica.com";

export function normalizeRecipients(...values: (string | null | undefined)[]): string[] {
  const out = new Set<string>([GLOBAL_ALERT_RECIPIENT.toLowerCase()]);
  for (const v of values) {
    if (!v) continue;
    for (const part of String(v).split(/[,;\s]+/)) {
      const email = part.trim().replace(/[<>]/g, "").toLowerCase();
      if (email.includes("@") && email.includes(".")) out.add(email);
    }
  }
  return [...out];
}

export interface AlertSendResult {
  ok: boolean;
  id?: string;
  error?: string;
  recipients: string[];
}

export async function sendAlertEmailRaw(
  subject: string,
  html: string,
  recipients: string[],
): Promise<AlertSendResult> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    return { ok: false, error: "RESEND_API_KEY no configurada", recipients };
  }
  if (recipients.length === 0) {
    return { ok: false, error: "Sin destinatarios", recipients };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({ from: ALERT_FROM, to: recipients, subject, html }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`Resend rechazó el envío [${res.status}]: ${body}`);
      return { ok: false, error: `[${res.status}] ${body}`.slice(0, 500), recipients };
    }

    const data = await res.json().catch(() => ({}));
    return { ok: true, id: data?.id, recipients };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error enviando correo de alerta:", msg);
    return { ok: false, error: msg.slice(0, 500), recipients };
  }
}

// Plantilla ACL: navy #15162C, crema #F4F1E6, oro #B6924F. Sin emoji, sin degradados.
export function alertEmailShell(title: string, intro: string, blocks: string, footerNote = ""): string {
  return `
  <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 640px; margin: 0 auto; background: #FFFFFF;">
    <div style="background: #15162C; padding: 24px 28px; border-bottom: 3px solid #B6924F;">
      <p style="margin: 0 0 6px 0; color: #B6924F; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; font-family: Helvetica, Arial, sans-serif;">ACL · Accounting Consulting Leaders</p>
      <h1 style="margin: 0; color: #F4F1E6; font-size: 22px; font-weight: 400;">${title}</h1>
    </div>
    <div style="padding: 24px 28px; border: 1px solid #E8E2CD; border-top: none;">
      <p style="margin: 0 0 18px 0; color: #15162C; font-size: 15px; line-height: 1.6;">${intro}</p>
      ${blocks}
      <p style="margin-top: 28px; padding-top: 16px; border-top: 1px solid #E8E2CD; color: rgba(21,22,44,.60); font-size: 12px; font-family: Helvetica, Arial, sans-serif;">
        Aviso automático del sistema de facturación de ACL.${footerNote ? ` ${footerNote}` : ""}
      </p>
    </div>
  </div>`;
}

export function issueBlock(
  issue: { title: string; description: string; actionRequired?: string; action_link?: string },
  critical: boolean,
): string {
  const accent = critical ? "#8C3A3A" : "#B6924F";
  const link = issue.action_link
    ? `<p style="margin: 10px 0 0 0; font-family: Helvetica, Arial, sans-serif; font-size: 13px;"><a href="https://facturas.aclcostarica.com${issue.action_link}" style="color: #15162C;">Abrir la pantalla para resolverlo</a></p>`
    : "";
  return `
  <div style="border: 1px solid #E8E2CD; border-left: 3px solid ${accent}; padding: 16px 18px; margin: 0 0 14px 0;">
    <p style="margin: 0 0 6px 0; color: ${accent}; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; font-family: Helvetica, Arial, sans-serif;">${critical ? "Crítico" : "Advertencia"}</p>
    <h2 style="margin: 0 0 8px 0; color: #15162C; font-size: 17px; font-weight: 400;">${issue.title}</h2>
    <p style="margin: 0; color: #15162C; font-size: 14px; line-height: 1.6;">${issue.description}</p>
    ${issue.actionRequired ? `<p style="margin: 10px 0 0 0; color: rgba(21,22,44,.60); font-size: 13px; font-family: Helvetica, Arial, sans-serif;">Qué hacer: ${issue.actionRequired}</p>` : ""}
    ${link}
  </div>`;
}
