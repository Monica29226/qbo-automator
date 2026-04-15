import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      return redirectWithMessage(`Error de autorización: ${error}`, "error");
    }

    if (!code || !state) {
      return redirectWithMessage("Parámetros faltantes", "error");
    }

    // State format: organizationId
    const organizationId = state;

    const MICROSOFT_CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID")!;
    const MICROSOFT_CLIENT_SECRET = Deno.env.get("MICROSOFT_CLIENT_SECRET")!;
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const redirectUri = `${SUPABASE_URL}/functions/v1/onedrive-oauth-callback`;

    // Exchange code for tokens
    const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID,
        client_secret: MICROSOFT_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        scope: "offline_access Files.Read Files.Read.All User.Read",
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error("Token exchange failed:", errBody);
      return redirectWithMessage("Error obteniendo token de OneDrive", "error");
    }

    const tokenData = await tokenRes.json();

    // Get user profile
    const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = profileRes.ok ? await profileRes.json() : {};

    // Save credentials
    const supabaseAdmin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    await supabaseAdmin.from("integration_accounts").upsert({
      organization_id: organizationId,
      service_type: "onedrive",
      account_email: profile.mail || profile.userPrincipalName || "",
      account_name: profile.displayName || "OneDrive",
      credentials: {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: Date.now() + (tokenData.expires_in * 1000),
      },
      is_active: true,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "organization_id,service_type",
    });

    console.log(`OneDrive connected for org ${organizationId}, email: ${profile.mail}`);

    // Redirect back to bank statements page
    const siteUrl = SUPABASE_URL.replace(".supabase.co", "").replace("https://", "");
    return redirectWithMessage("OneDrive conectado exitosamente", "success");
  } catch (err) {
    console.error("OneDrive callback error:", err);
    return redirectWithMessage("Error interno en callback", "error");
  }
});

function redirectWithMessage(message: string, type: string) {
  // Try to redirect to the app, fallback to a simple HTML page
  const html = `<!DOCTYPE html>
<html><head><title>OneDrive</title></head>
<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
<div style="text-align:center;">
  <h2>${type === "success" ? "✅" : "❌"} ${message}</h2>
  <p>Puedes cerrar esta ventana.</p>
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: "onedrive-oauth-${type}", message: "${message}" }, "*");
      setTimeout(() => window.close(), 2000);
    }
  </script>
</div>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}
