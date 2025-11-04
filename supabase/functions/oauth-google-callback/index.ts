import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state"); // organization_id
    const error = url.searchParams.get("error");

    if (error) {
      console.error("OAuth error:", error);
      return new Response(null, {
        status: 302,
        headers: {
          "Location": `/integrations?error=${encodeURIComponent(error)}`
        }
      });
    }

    if (!code || !state) {
      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/integrations?error=missing_code_or_state"
        }
      });
    }

    const organization_id = state;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Obtener credenciales
    const { data: credentials, error: credError } = await supabase
      .from("oauth_credentials")
      .select("client_id, client_secret")
      .eq("organization_id", organization_id)
      .eq("provider", "google")
      .single();

    if (credError || !credentials) {
      console.error("Error fetching credentials:", credError);
      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/integrations?error=credentials_not_found"
        }
      });
    }

    // Intercambiar código por tokens
    const redirectUri = `${supabaseUrl}/functions/v1/oauth-google-callback`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code: code,
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Token exchange failed:", errorText);
      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/integrations?error=token_exchange_failed"
        }
      });
    }

    const tokens = await tokenResponse.json();

    // Obtener email del usuario
    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    });

    const userInfo = await userInfoResponse.json();

    // Guardar tokens en integration_accounts
    const { error: insertError } = await supabase
      .from("integration_accounts")
      .insert({
        organization_id: organization_id,
        service_type: "gmail",
        account_email: userInfo.email,
        account_name: userInfo.email,
        credentials: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: Date.now() + (tokens.expires_in * 1000),
        },
        is_active: true,
      });

    if (insertError) {
      console.error("Error saving tokens:", insertError);
      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/integrations?error=failed_to_save"
        }
      });
    }

    // Actualizar estado de organización
    await supabase
      .from("organizations")
      .update({
        gmail_connected: true,
        gmail_email: userInfo.email,
      })
      .eq("id", organization_id);

    // Redirigir de vuelta a integraciones con éxito
    return new Response(null, {
      status: 302,
      headers: {
        "Location": "/integrations?success=gmail_connected"
      }
    });
  } catch (error) {
    console.error("Error in oauth-google-callback:", error);
    return new Response(null, {
      status: 302,
      headers: {
        "Location": "/integrations?error=unexpected_error"
      }
    });
  }
});
