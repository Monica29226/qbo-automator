import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      console.error("OAuth error:", error);
      return new Response(
        `<html><body><h1>Error</h1><p>OAuth failed: ${error}</p><script>setTimeout(() => window.close(), 3000);</script></body></html>`,
        { headers: { "Content-Type": "text/html" }, status: 400 }
      );
    }

    if (!code || !state) {
      throw new Error("Missing code or state parameter");
    }

    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing required environment variables");
    }

    const redirectUri = `${SUPABASE_URL}/functions/v1/gmail-oauth-callback`;

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
      console.error("Token exchange failed:", errorText);
      console.error("Using Client ID:", GOOGLE_CLIENT_ID?.substring(0, 20) + "...");
      console.error("Using redirect_uri:", redirectUri);
      throw new Error(`Failed to exchange code for tokens: ${errorText}`);
    }

    const tokens = await tokenResponse.json();
    console.log("Tokens received successfully");

    // Get user email from Google
    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userInfoResponse.ok) {
      throw new Error("Failed to get user info");
    }

    const userInfo = await userInfoResponse.json();
    console.log("User info retrieved:", userInfo.email);

    // Parse state to get organization_id and user_id
    const stateData = JSON.parse(atob(state));
    const { organization_id, user_id } = stateData;

    // Initialize Supabase client with service role
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Store or update tokens in integration_accounts (upsert)
    const { error: upsertError } = await supabase
      .from("integration_accounts")
      .upsert({
        organization_id,
        service_type: "gmail",
        account_email: userInfo.email,
        account_name: userInfo.name || userInfo.email,
        created_by: user_id,
        is_active: true,
        credentials: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: Date.now() + (tokens.expires_in * 1000),
        },
      }, {
        onConflict: "organization_id,service_type,account_email"
      });

    if (upsertError) {
      console.error("Error storing tokens:", upsertError);
      throw upsertError;
    }

    // Update organization connection status
    await supabase
      .from("organizations")
      .update({
        gmail_connected: true,
        gmail_email: userInfo.email,
      })
      .eq("id", organization_id);

    console.log("Gmail account connected successfully");

    const successHtml = `<!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Gmail Connected</title>
        </head>
        <body>
          <h1>¡Conexión Exitosa!</h1>
          <p>Gmail conectado: ${userInfo.email}</p>
          <p>Puedes cerrar esta ventana.</p>
          <script>
            console.log('Sending Gmail postMessage to opener');
            if (window.opener) {
              window.opener.postMessage({ type: 'gmail-connected', email: '${userInfo.email}' }, '*');
              console.log('Gmail message sent');
            } else {
              console.error('No window.opener found');
            }
            setTimeout(() => window.close(), 2000);
          </script>
        </body>
      </html>`;

    return new Response(
      new TextEncoder().encode(successHtml),
      { headers: { "Content-Type": "text/html; charset=UTF-8" }, status: 200 }
    );
  } catch (error) {
    console.error("Error in gmail-oauth-callback:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    const errorHtml = `<!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Error</title>
        </head>
        <body>
          <h1>Error de Conexión</h1>
          <p>${errorMessage}</p>
          <p style="font-size: 12px; color: #666;">Verifica que las credenciales de Google estén correctas y que la URL de redirección esté autorizada en Google Cloud Console.</p>
          <script>setTimeout(() => window.close(), 5000);</script>
        </body>
      </html>`;

    return new Response(
      new TextEncoder().encode(errorHtml),
      { headers: { "Content-Type": "text/html; charset=UTF-8" }, status: 500 }
    );
  }
});
