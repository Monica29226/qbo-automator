import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const escapeHtml = (str: string): string => {
  const m: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return str.replace(/[&<>"']/g, (c) => m[c]);
};

const AADSTS_MAP: Record<string, string> = {
  AADSTS50020: "Tu cuenta no es del tipo aceptado por la app. Si es una cuenta empresarial, contacta a tu admin de TI.",
  AADSTS65001: "Tu administrador de TI debe aprobar la app de FacturaFlow primero. Comparte la URL de aprobación con ellos.",
  AADSTS50105: "Tu administrador bloqueó las apps OAuth de terceros. Considera conectar vía IMAP en su lugar.",
  AADSTS500113: "Error de configuración (redirect_uri). Reporta al soporte de FacturaFlow.",
  AADSTS70008: "El código de autorización expiró. Vuelve a intentar la conexión.",
};

function mapAadError(errorCode: string | null, errorDescription: string | null): { code: string; message: string } {
  const desc = errorDescription || "";
  // Try direct code, then extract AADSTSxxxxx from description
  if (errorCode && AADSTS_MAP[errorCode]) return { code: errorCode, message: AADSTS_MAP[errorCode] };
  const match = desc.match(/AADSTS(\d+)/);
  if (match) {
    const code = `AADSTS${match[1]}`;
    if (AADSTS_MAP[code]) return { code, message: AADSTS_MAP[code] };
    return { code, message: `Error de Microsoft: ${code}. Si persiste, intenta conexión IMAP.` };
  }
  return { code: errorCode || "oauth_error", message: errorDescription || "Error desconocido de OAuth." };
}

function buildResultHtml(opts: {
  success: boolean;
  email?: string;
  errorCode?: string;
  errorMessage?: string;
  allowedOrigin: string;
}): string {
  const payload = opts.success
    ? { type: "outlook-connected", email: opts.email }
    : { type: "outlook-error", code: opts.errorCode, message: opts.errorMessage };
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  const title = opts.success ? "¡Conexión exitosa!" : "Error de conexión";
  const body = opts.success
    ? `<h1>${title}</h1><p>Outlook conectado: ${escapeHtml(opts.email || "")}</p><p>Puedes cerrar esta ventana.</p>`
    : `<h1>${title}</h1><p><strong>${escapeHtml(opts.errorCode || "")}</strong></p><p>${escapeHtml(opts.errorMessage || "")}</p><p style="color:#666;font-size:12px">Esta ventana se cerrará automáticamente.</p>`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title></head><body>${body}<script>
    try { if (window.opener) window.opener.postMessage(${json}, '${opts.allowedOrigin}'); } catch (e) {}
    setTimeout(() => window.close(), 3500);
  </script></body></html>`;
}

serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const allowedOrigin = "*"; // permissive: opener may be on lovable.app, custom domain, or preview

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    if (error) {
      console.error("OAuth error from Microsoft:", error, errorDescription);
      const mapped = mapAadError(error, errorDescription);
      return new Response(
        buildResultHtml({ success: false, errorCode: mapped.code, errorMessage: mapped.message, allowedOrigin }),
        { headers: { "Content-Type": "text/html; charset=UTF-8" }, status: 400 },
      );
    }

    if (!code || !state) throw new Error("Missing code or state parameter");

    const MICROSOFT_CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID")!;
    const MICROSOFT_CLIENT_SECRET = Deno.env.get("MICROSOFT_CLIENT_SECRET")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing required environment variables");
    }

    const redirectUri = `${SUPABASE_URL}/functions/v1/outlook-oauth-callback`;

    const tokenResponse = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: MICROSOFT_CLIENT_ID,
        client_secret: MICROSOFT_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        scope: "offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read",
      }),
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error("Token exchange failed:", errText);
      let parsed: any = {};
      try { parsed = JSON.parse(errText); } catch (_) { /* ignore */ }
      const mapped = mapAadError(parsed.error || null, parsed.error_description || errText);
      return new Response(
        buildResultHtml({ success: false, errorCode: mapped.code, errorMessage: mapped.message, allowedOrigin }),
        { headers: { "Content-Type": "text/html; charset=UTF-8" }, status: 400 },
      );
    }

    const tokens = await tokenResponse.json();

    // CRITICAL: validate immediately by calling Graph /me
    const meResp = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!meResp.ok) {
      const errText = await meResp.text();
      console.error("Graph /me failed:", meResp.status, errText);
      return new Response(
        buildResultHtml({
          success: false,
          errorCode: `graph_${meResp.status}`,
          errorMessage: "El token se obtuvo pero Microsoft Graph rechazó la petición. Posiblemente faltan permisos. Intenta IMAP si tu admin bloquea OAuth.",
          allowedOrigin,
        }),
        { headers: { "Content-Type": "text/html; charset=UTF-8" }, status: 400 },
      );
    }

    const userInfo = await meResp.json();
    const userEmail = userInfo.mail || userInfo.userPrincipalName;
    const userName = userInfo.displayName || userEmail;

    const stateData = JSON.parse(atob(state));
    const { organization_id, user_id } = stateData;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const expiresAt = Date.now() + (tokens.expires_in * 1000);
    const nowIso = new Date().toISOString();

    const { data: existing } = await supabase
      .from("integration_accounts")
      .select("id")
      .eq("organization_id", organization_id)
      .eq("service_type", "outlook")
      .eq("account_email", userEmail)
      .maybeSingle();

    const credentials = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      last_test_success_at: nowIso,
    };

    if (existing) {
      await supabase.from("integration_accounts").update({
        account_name: userName,
        is_active: true,
        credentials,
        updated_at: nowIso,
      }).eq("id", existing.id);
    } else {
      await supabase.from("integration_accounts").insert({
        organization_id,
        service_type: "outlook",
        account_email: userEmail,
        account_name: userName,
        created_by: user_id,
        is_active: true,
        credentials,
      });
    }

    await supabase.from("organizations").update({
      outlook_connected: true,
      outlook_email: userEmail,
    }).eq("id", organization_id);

    console.log("Outlook connected successfully:", userEmail);

    return new Response(
      buildResultHtml({ success: true, email: userEmail, allowedOrigin }),
      { headers: { "Content-Type": "text/html; charset=UTF-8" }, status: 200 },
    );
  } catch (error) {
    console.error("Error in outlook-oauth-callback:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      buildResultHtml({ success: false, errorCode: "callback_error", errorMessage: msg, allowedOrigin }),
      { headers: { "Content-Type": "text/html; charset=UTF-8" }, status: 500 },
    );
  }
});
