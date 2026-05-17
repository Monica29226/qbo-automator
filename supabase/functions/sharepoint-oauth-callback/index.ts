import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { SP_SCOPES } from "../_shared/sharepoint.ts";

const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH = "https://graph.microsoft.com/v1.0";

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return htmlResponse(`<h1>Error de autorización</h1><p>${error}</p><p>${url.searchParams.get("error_description") || ""}</p>`);
  }
  if (!code || !stateRaw) {
    return htmlResponse(`<h1>Faltan parámetros</h1>`, 400);
  }

  try {
    const state = JSON.parse(atob(stateRaw));
    const projectId = Deno.env.get("SUPABASE_URL")!.split(".")[0].replace("https://", "");
    const redirectUri = `https://${projectId}.supabase.co/functions/v1/sharepoint-oauth-callback`;

    const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!;
    const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!;

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: SP_SCOPES,
    });

    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      return htmlResponse(`<h1>Error obteniendo tokens</h1><pre>${JSON.stringify(tokenJson, null, 2)}</pre>`, 500);
    }

    const accessToken = tokenJson.access_token;
    const refreshToken = tokenJson.refresh_token;
    const expiresIn = Number(tokenJson.expires_in || 3600);

    // Get user
    const meRes = await fetch(`${GRAPH}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const me = await meRes.json();
    const adminEmail = me.mail || me.userPrincipalName || "unknown@unknown";

    const credentials = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      token_type: tokenJson.token_type,
    };

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Deactivate any existing rows, then insert new (singleton-ish but keep history)
    await supabase.from("sharepoint_admin_account").update({ is_active: false }).eq("is_active", true);

    const { data: inserted, error: insErr } = await supabase
      .from("sharepoint_admin_account")
      .insert({
        admin_email: adminEmail,
        credentials,
        is_active: true,
        root_folder_path: "FacturaFlow",
      })
      .select()
      .single();

    if (insErr) {
      return htmlResponse(`<h1>Error guardando cuenta</h1><pre>${insErr.message}</pre>`, 500);
    }

    const returnTo = state.return_to || "/admin/sharepoint-setup";
    // Redirect to app with success flag + account id
    const appOrigin = url.origin.replace(`${projectId}.supabase.co`, "");
    // Use referrer or fallback. We don't reliably know the app URL; show a success page that postMessages and auto-redirects.
    return htmlResponse(`
<!doctype html><html><head><meta charset="utf-8"><title>SharePoint conectado</title>
<style>body{font-family:system-ui;padding:40px;max-width:600px;margin:auto}
.ok{color:#16a34a}.box{background:#f0fdf4;border:1px solid #16a34a;padding:20px;border-radius:8px}
a{color:#2563eb}</style></head>
<body>
<div class="box">
<h1 class="ok">✅ SharePoint conectado</h1>
<p>Cuenta: <strong>${adminEmail}</strong></p>
<p>Ahora puedes cerrar esta ventana y volver a la app para seleccionar el sitio de SharePoint.</p>
<p><a href="javascript:window.close()">Cerrar ventana</a></p>
</div>
<script>
try { if (window.opener) { window.opener.postMessage({ type: 'sharepoint-connected', account_id: '${inserted.id}' }, '*'); } } catch(e){}
setTimeout(function(){ window.location.href = ${JSON.stringify(returnTo)}; }, 1500);
</script>
</body></html>`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return htmlResponse(`<h1>Error</h1><pre>${msg}</pre>`, 500);
  }
});
