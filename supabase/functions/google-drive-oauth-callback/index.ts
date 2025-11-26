import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const escapeHtml = (str: string): string => {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return str.replace(/[&<>"']/g, (char) => htmlEntities[char]);
};

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const allowedOrigin = SUPABASE_URL || 'https://lqirqvvkjpunhtsvebot.supabase.co';

  if (error) {
    console.error("OAuth error:", error);
    return new Response(
      new TextEncoder().encode(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Error de Conexión</title>
        </head>
        <body>
          <h1>Error</h1>
          <p>No se pudo conectar Google Drive: ${escapeHtml(error)}</p>
          <script>
            setTimeout(() => window.close(), 3000);
          </script>
        </body>
        </html>
      `),
      { 
        headers: { 
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'self' 'unsafe-inline'"
        }, 
        status: 400 
      }
    );
  }

  if (!code || !state) {
    return new Response(
      new TextEncoder().encode(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Error</title>
        </head>
        <body>
          <h1>Error</h1>
          <p>Parámetros inválidos</p>
        </body>
        </html>
      `),
      { 
        headers: { 
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'self' 'unsafe-inline'"
        }, 
        status: 400 
      }
    );
  }

  try {
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
    const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error("Missing required environment variables");
    }

    const redirectUri = `${SUPABASE_URL}/functions/v1/google-drive-oauth-callback`;

    // Exchange code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${errorText}`);
    }

    const tokens = await tokenResponse.json();
    const { access_token, refresh_token, expires_in } = tokens;

    // Get user info
    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!userInfoResponse.ok) {
      throw new Error("Failed to fetch user info");
    }

    const userInfo = await userInfoResponse.json();
    const escapedEmail = escapeHtml(userInfo.email);

    // Decode state
    const stateData = JSON.parse(atob(state));
    const { organization_id, user_id } = stateData;

    // Create root folder in Google Drive
    const folderResponse = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Facturas FacturaFlow",
        mimeType: "application/vnd.google-apps.folder",
      }),
    });

    const folderData = await folderResponse.json();
    const rootFolderId = folderData.id;

    // Store credentials in Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

    const { error: upsertError } = await supabase
      .from("integration_accounts")
      .upsert({
        organization_id,
        service_type: "google_drive",
        account_email: userInfo.email,
        account_name: userInfo.name || userInfo.email,
        credentials: {
          access_token,
          refresh_token,
          expires_at: expiresAt,
        },
        created_by: user_id,
        is_active: true,
      }, {
        onConflict: "organization_id,service_type",
      });

    if (upsertError) {
      throw new Error(`Failed to store credentials: ${upsertError.message}`);
    }

    // Update organization
    const { error: orgError } = await supabase
      .from("organizations")
      .update({
        google_drive_connected: true,
        google_drive_enabled: true,
        google_drive_folder_id: rootFolderId,
      })
      .eq("id", organization_id);

    if (orgError) {
      throw new Error(`Failed to update organization: ${orgError.message}`);
    }

    console.log("Google Drive connected successfully for organization:", organization_id);

    return new Response(
      new TextEncoder().encode(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Conexión Exitosa</title>
        </head>
        <body>
          <h1>¡Conexión Exitosa!</h1>
          <p>Google Drive conectado correctamente: ${escapedEmail}</p>
          <p>Carpeta raíz creada en tu Drive.</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({ 
                type: 'google-drive-connected', 
                email: '${escapedEmail}',
                folderId: '${escapeHtml(rootFolderId)}'
              }, '${allowedOrigin}');
            }
            setTimeout(() => window.close(), 2000);
          </script>
        </body>
        </html>
      `),
      { 
        headers: { 
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'self' 'unsafe-inline'"
        }, 
        status: 200 
      }
    );
  } catch (error) {
    console.error("Error in google-drive-oauth-callback:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const escapedError = escapeHtml(errorMessage);
    
    return new Response(
      new TextEncoder().encode(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Error</title>
        </head>
        <body>
          <h1>Error</h1>
          <p>No se pudo conectar Google Drive: ${escapedError}</p>
          <script>
            setTimeout(() => window.close(), 3000);
          </script>
        </body>
        </html>
      `),
      { 
        headers: { 
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'self' 'unsafe-inline'"
        }, 
        status: 500 
      }
    );
  }
});
