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

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const maybeMessage = Reflect.get(error, "message");
    const maybeDetails = Reflect.get(error, "details");

    if (typeof maybeMessage === "string" && maybeMessage.trim()) {
      return typeof maybeDetails === "string" && maybeDetails.trim()
        ? `${maybeMessage} (${maybeDetails})`
        : maybeMessage;
    }
  }

  return "Unknown error";
};

serve(async (req) => {
  const requestId = (crypto as any).randomUUID?.() ?? `rid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const log = (level: "log" | "warn" | "error", msg: string, extra?: Record<string, unknown>) => {
    const payload = { requestId, ...(extra ?? {}) };
    (console as any)[level](`[oauth-callback rid=${requestId}] ${msg}`, payload);
  };
  log("log", "▶ Callback invoked", { method: req.method });
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const realmId = url.searchParams.get("realmId");
    const error = url.searchParams.get("error");

    if (error) {
      log("error", "OAuth provider returned error", { error });
      return new Response(
        `<html><body><h1>Error</h1><p>OAuth failed: ${escapeHtml(error)}</p><p style="font-size:11px;color:#666">rid: ${escapeHtml(requestId)}</p><script>setTimeout(() => window.close(), 3000);</script></body></html>`,
        { headers: { 
          "Content-Type": "text/html",
          "Content-Security-Policy": "default-src 'self' 'unsafe-inline'"
        }, status: 400 }
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
      log("error", "Token exchange failed", { status: tokenResponse.status, body: errorText.substring(0, 500) });
      throw new Error("Failed to exchange code for tokens");
    }

    const tokens = await tokenResponse.json();
    log("log", "Tokens received", { expires_in: tokens.expires_in });

    // Parse state to get organization_id and user_id
    const stateData = JSON.parse(atob(state));
    const { organization_id, user_id } = stateData;
    log("log", "State decoded", { organization_id, user_id, realmId });

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
          log("error", "Realm already connected to a different organization", {
            realmId,
            attempted_org: organization_id,
            owning_org: conn.organization_id,
          });
          const errorHtml = `<!DOCTYPE html>
            <html>
              <head>
                <meta charset="UTF-8">
                <title>Error</title>
              </head>
              <body>
                <h1>Error de Conexión</h1>
                <p>Esta cuenta de QuickBooks (Realm ${escapeHtml(realmId)}) ya está conectada a otra empresa.</p>
                <p style="font-size: 12px; color: #666;">Cada empresa debe tener su propia conexión de QuickBooks independiente.</p>
                <p style="font-size: 11px; color: #999;">rid: ${escapeHtml(requestId)}</p>
                <script>setTimeout(() => window.close(), 5000);</script>
              </body>
            </html>`;
          
          return new Response(
            new TextEncoder().encode(errorHtml),
            { headers: { 
              "Content-Type": "text/html; charset=utf-8",
              "Content-Security-Policy": "default-src 'self' 'unsafe-inline'"
            }, status: 400 }
          );
        }
      }
    }

    const connectionPayload = {
      organization_id,
      service_type: "quickbooks",
      account_name: `QuickBooks (${realmId})`,
      created_by: user_id,
      is_active: true,
      credentials: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + (tokens.expires_in * 1000),
        realm_id: realmId,
      },
      updated_at: new Date().toISOString(),
    };

    log("log", "Looking up existing integration", {
      organization_id,
      service_type: "quickbooks",
      realm_id: realmId,
    });

    const { data: existingIntegrations, error: existingIntegrationError } = await supabase
      .from("integration_accounts")
      .select("id, organization_id, service_type, is_active, account_name, credentials, created_at, updated_at")
      .eq("organization_id", organization_id)
      .eq("service_type", "quickbooks");

    if (existingIntegrationError) {
      log("error", "Error checking existing QuickBooks integration", {
        message: existingIntegrationError.message,
        details: (existingIntegrationError as any).details,
        hint: (existingIntegrationError as any).hint,
        code: (existingIntegrationError as any).code,
      });
      throw existingIntegrationError;
    }

    log("log", "Found existing integrations", {
      count: existingIntegrations?.length ?? 0,
      records: (existingIntegrations ?? []).map((r) => ({
        id: r.id,
        is_active: r.is_active,
        account_name: r.account_name,
        existing_realm: (r.credentials as any)?.realm_id ?? null,
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
    });

    const existingIntegration = existingIntegrations?.[0] ?? null;

    if ((existingIntegrations?.length ?? 0) > 1) {
      log("warn", "Multiple QuickBooks integrations found for org — updating the first and deactivating the rest", {
        organization_id,
        ids: existingIntegrations!.map((r) => r.id),
      });

      const extraIds = existingIntegrations!.slice(1).map((r) => r.id);
      const { error: deactivateError } = await supabase
        .from("integration_accounts")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .in("id", extraIds);

      if (deactivateError) {
        log("error", "Failed to deactivate duplicate integrations", {
          message: deactivateError.message,
          details: (deactivateError as any).details,
          hint: (deactivateError as any).hint,
          code: (deactivateError as any).code,
          ids: extraIds,
        });
      }
    }

    const writeOperation = existingIntegration ? "update" : "insert";
    log("log", `Performing ${writeOperation} on integration_accounts`, {
      target_id: existingIntegration?.id ?? null,
      organization_id,
      realm_id: realmId,
    });

    const writeQuery = existingIntegration
      ? supabase
          .from("integration_accounts")
          .update(connectionPayload)
          .eq("id", existingIntegration.id)
      : supabase
          .from("integration_accounts")
          .insert(connectionPayload);

    const { error: writeError } = await writeQuery;

    if (writeError) {
      log("error", `Error storing tokens (${writeOperation})`, {
        message: writeError.message,
        details: (writeError as any).details,
        hint: (writeError as any).hint,
        code: (writeError as any).code,
        operation: writeOperation,
        target_id: existingIntegration?.id ?? null,
        payload_summary: {
          organization_id: connectionPayload.organization_id,
          service_type: connectionPayload.service_type,
          account_name: connectionPayload.account_name,
          is_active: connectionPayload.is_active,
          realm_id: realmId,
        },
      });
      throw writeError;
    }

    log("log", `${writeOperation} succeeded`, { organization_id, target_id: existingIntegration?.id ?? null });

    // Update organization connection status
    const { error: orgUpdateError } = await supabase
      .from("organizations")
      .update({
        quickbooks_connected: true,
        qbo_realm_id: realmId,
      })
      .eq("id", organization_id);

    if (orgUpdateError) {
      log("warn", "Organization status update failed (non-fatal)", {
        message: orgUpdateError.message,
        code: (orgUpdateError as any).code,
      });
    }

    log("log", "✅ QuickBooks connected successfully", { organization_id, realmId });

    const escapedRealmId = escapeHtml(realmId);
    const allowedOrigin = new URL(SUPABASE_URL).origin;
    
    const html = `<!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>QuickBooks Connected</title>
        </head>
        <body>
          <h1>¡Conexión Exitosa!</h1>
          <p>QuickBooks conectado correctamente</p>
          <p>Realm ID: ${escapedRealmId}</p>
          <p>Puedes cerrar esta ventana.</p>
          <script>
            console.log('Sending postMessage to opener');
            if (window.opener) {
              window.opener.postMessage({ type: 'quickbooks-connected', realmId: '${escapedRealmId}' }, '${allowedOrigin}');
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
      { headers: { 
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'self' 'unsafe-inline'"
      }, status: 200 }
    );
  } catch (error) {
    log("error", "Unhandled error in callback", {
      error_message: getErrorMessage(error),
      error_name: (error as any)?.name,
      error_code: (error as any)?.code,
      error_details: (error as any)?.details,
      error_hint: (error as any)?.hint,
      stack: (error as Error)?.stack?.split("\n").slice(0, 5).join(" | "),
    });
    const errorMessage = getErrorMessage(error);
    return new Response(
      `<html><body><h1>Error</h1><p>${escapeHtml(errorMessage)}</p><p style="font-size:11px;color:#999">rid: ${escapeHtml(requestId)}</p><script>setTimeout(() => window.close(), 5000);</script></body></html>`,
      { headers: { 
        "Content-Type": "text/html",
        "Content-Security-Policy": "default-src 'self' 'unsafe-inline'"
      }, status: 500 }
    );
  }
});
