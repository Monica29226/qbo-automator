import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const realmId = url.searchParams.get("realmId");
    const error = url.searchParams.get("error");

    if (error) {
      console.error("OAuth error:", error);
      return new Response(
        `<html><body><h1>Error</h1><p>OAuth failed: ${error}</p><script>setTimeout(() => window.close(), 3000);</script></body></html>`,
        { headers: { "Content-Type": "text/html" }, status: 400 }
      );
    }

    if (!code || !state || !realmId) {
      throw new Error("Missing required parameters");
    }

    const QBO_CLIENT_ID = Deno.env.get("QBO_CLIENT_ID");
    const QBO_CLIENT_SECRET = Deno.env.get("QBO_CLIENT_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!QBO_CLIENT_ID || !QBO_CLIENT_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing required environment variables");
    }

    const redirectUri = `${SUPABASE_URL}/functions/v1/quickbooks-oauth-callback`;

    // Exchange code for tokens
    const authString = btoa(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`);
    
    const tokenResponse = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${authString}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Token exchange failed:", errorText);
      throw new Error("Failed to exchange code for tokens");
    }

    const tokens = await tokenResponse.json();
    console.log("Tokens received successfully");

    // Parse state to get organization_id and user_id
    const stateData = JSON.parse(atob(state));
    const { organization_id, user_id } = stateData;

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Check if this QuickBooks realm is already connected to another organization
    const { data: existingConnections } = await supabase
      .from("integration_accounts")
      .select("organization_id, credentials")
      .eq("service_type", "quickbooks")
      .eq("is_active", true);

    // Check if this realm is already connected to a DIFFERENT organization
    if (existingConnections && existingConnections.length > 0) {
      for (const conn of existingConnections) {
        const credentials = conn.credentials as any;
        if (credentials?.realm_id === realmId && conn.organization_id !== organization_id) {
          console.error("QuickBooks realm already connected to another organization");
          const errorHtml = `<!DOCTYPE html>
            <html>
              <head>
                <meta charset="UTF-8">
                <title>Error</title>
              </head>
              <body>
                <h1>Error de Conexión</h1>
                <p>Esta cuenta de QuickBooks (Realm ${realmId}) ya está conectada a otra empresa.</p>
                <p style="font-size: 12px; color: #666;">Cada empresa debe tener su propia conexión de QuickBooks independiente.</p>
                <script>setTimeout(() => window.close(), 5000);</script>
              </body>
            </html>`;
          
          return new Response(
            new TextEncoder().encode(errorHtml),
            { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 400 }
          );
        }
      }
    }

    // Store tokens in integration_accounts
    const { error: insertError } = await supabase
      .from("integration_accounts")
      .insert({
        organization_id,
        service_type: "quickbooks",
        account_name: `QuickBooks (${realmId})`,
        created_by: user_id,
        credentials: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: Date.now() + (tokens.expires_in * 1000),
          realm_id: realmId,
        },
      });

    if (insertError) {
      console.error("Error storing tokens:", insertError);
      throw insertError;
    }

    // Update organization connection status
    await supabase
      .from("organizations")
      .update({
        quickbooks_connected: true,
        qbo_realm_id: realmId,
      })
      .eq("id", organization_id);

    console.log("QuickBooks connected successfully");

    const html = `<!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>QuickBooks Connected</title>
        </head>
        <body>
          <h1>¡Conexión Exitosa!</h1>
          <p>QuickBooks conectado correctamente</p>
          <p>Realm ID: ${realmId}</p>
          <p>Puedes cerrar esta ventana.</p>
          <script>
            console.log('Sending postMessage to opener');
            if (window.opener) {
              window.opener.postMessage({ type: 'quickbooks-connected', realmId: '${realmId}' }, '*');
              console.log('Message sent');
            } else {
              console.error('No window.opener found');
            }
            setTimeout(() => window.close(), 2000);
          </script>
        </body>
      </html>`;
    
    return new Response(
      new TextEncoder().encode(html),
      { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 200 }
    );
  } catch (error) {
    console.error("Error in quickbooks-oauth-callback:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      `<html><body><h1>Error</h1><p>${errorMessage}</p><script>setTimeout(() => window.close(), 3000);</script></body></html>`,
      { headers: { "Content-Type": "text/html" }, status: 500 }
    );
  }
});
