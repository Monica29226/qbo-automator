import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// HTML escape function to prevent XSS
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
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    if (error) {
      console.error("OAuth error:", error, errorDescription);
      return new Response(
        `<html><body><h1>Error</h1><p>OAuth failed: ${escapeHtml(error)} - ${escapeHtml(errorDescription || '')}</p><script>setTimeout(() => window.close(), 3000);</script></body></html>`,
        { headers: { 
          "Content-Type": "text/html",
          "Content-Security-Policy": "default-src 'self' 'unsafe-inline'"
        }, status: 400 }
      );
    }

    if (!code || !state) {
      throw new Error("Missing code or state parameter");
    }

    const MICROSOFT_CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID");
    const MICROSOFT_CLIENT_SECRET = Deno.env.get("MICROSOFT_CLIENT_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing required environment variables");
    }

    const redirectUri = `${SUPABASE_URL}/functions/v1/outlook-oauth-callback`;

    // Exchange code for tokens using Microsoft OAuth 2.0 token endpoint
    const tokenResponse = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: MICROSOFT_CLIENT_ID,
        client_secret: MICROSOFT_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Token exchange failed:", errorText);
      throw new Error(`Failed to exchange code for tokens: ${errorText}`);
    }

    const tokens = await tokenResponse.json();
    console.log("Tokens received successfully from Microsoft");

    // Get user info from Microsoft Graph API
    const userInfoResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userInfoResponse.ok) {
      const errorText = await userInfoResponse.text();
      console.error("Failed to get user info:", errorText);
      throw new Error("Failed to get user info from Microsoft Graph");
    }

    const userInfo = await userInfoResponse.json();
    const userEmail = userInfo.mail || userInfo.userPrincipalName;
    const userName = userInfo.displayName || userEmail;
    
    console.log("User info retrieved:", userEmail);

    // Parse state to get organization_id and user_id
    const stateData = JSON.parse(atob(state));
    const { organization_id, user_id } = stateData;

    // Initialize Supabase client with service role
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Calculate token expiration
    const expiresAt = Date.now() + (tokens.expires_in * 1000);

    // Check if account already exists for this org/email
    const { data: existingAccount } = await supabase
      .from("integration_accounts")
      .select("id")
      .eq("organization_id", organization_id)
      .eq("service_type", "outlook")
      .eq("account_email", userEmail)
      .maybeSingle();

    let saveError = null;
    
    if (existingAccount) {
      // Update existing account with new tokens
      const { error } = await supabase
        .from("integration_accounts")
        .update({
          account_name: userName,
          is_active: true,
          credentials: {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: expiresAt,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingAccount.id);
      saveError = error;
      console.log("Updated existing Outlook account:", existingAccount.id);
    } else {
      // Insert new account
      const { error } = await supabase
        .from("integration_accounts")
        .insert({
          organization_id,
          service_type: "outlook",
          account_email: userEmail,
          account_name: userName,
          created_by: user_id,
          is_active: true,
          credentials: {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: expiresAt,
          },
        });
      saveError = error;
      console.log("Created new Outlook account for:", userEmail);
    }

    if (saveError) {
      console.error("Error storing tokens:", saveError);
      throw saveError;
    }

    // Update organization connection status
    await supabase
      .from("organizations")
      .update({
        outlook_connected: true,
        outlook_email: userEmail,
      })
      .eq("id", organization_id);

    console.log("Outlook account connected successfully for:", userEmail);

    const escapedEmail = escapeHtml(userEmail);
    const allowedOrigin = new URL(SUPABASE_URL).origin;
    
    const successHtml = `<!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Outlook Connected</title>
        </head>
        <body>
          <h1>¡Conexión Exitosa!</h1>
          <p>Outlook conectado: ${escapedEmail}</p>
          <p>Puedes cerrar esta ventana.</p>
          <script>
            console.log('Sending Outlook postMessage to opener');
            if (window.opener) {
              window.opener.postMessage({ type: 'outlook-connected', email: '${escapedEmail}' }, '${allowedOrigin}');
              console.log('Outlook message sent');
            } else {
              console.error('No window.opener found');
            }
            setTimeout(() => window.close(), 2000);
          </script>
        </body>
      </html>`;

    return new Response(
      new TextEncoder().encode(successHtml),
      { headers: { 
        "Content-Type": "text/html; charset=UTF-8",
        "Content-Security-Policy": "default-src 'self' 'unsafe-inline'"
      }, status: 200 }
    );
  } catch (error) {
    console.error("Error in outlook-oauth-callback:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    const errorHtml = `<!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Error</title>
        </head>
        <body>
          <h1>Error de Conexión</h1>
          <p>${escapeHtml(errorMessage)}</p>
          <p style="font-size: 12px; color: #666;">Verifica que las credenciales de Microsoft estén correctas y que la URL de redirección esté autorizada en Azure Portal.</p>
          <script>setTimeout(() => window.close(), 5000);</script>
        </body>
      </html>`;

    return new Response(
      new TextEncoder().encode(errorHtml),
      { headers: { 
        "Content-Type": "text/html; charset=UTF-8",
        "Content-Security-Policy": "default-src 'self' 'unsafe-inline'"
      }, status: 500 }
    );
  }
});
