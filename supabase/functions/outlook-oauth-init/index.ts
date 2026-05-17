import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const MICROSOFT_CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");

    if (!MICROSOFT_CLIENT_ID || !SUPABASE_URL) {
      throw new Error("Missing required environment variables (MICROSOFT_CLIENT_ID or SUPABASE_URL)");
    }

    const { state } = await req.json();
    if (!state) throw new Error("Missing state parameter");

    const redirectUri = `${SUPABASE_URL}/functions/v1/outlook-oauth-callback`;

    // /common = personal + work/school accounts (do NOT use /consumers or /organizations)
    const authUrl = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    authUrl.searchParams.set("client_id", MICROSOFT_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("response_mode", "query");
    // Full URLs for Graph scopes + offline_access (CRITICAL: without it tokens expire in 1h with no refresh)
    authUrl.searchParams.set(
      "scope",
      "offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read",
    );
    authUrl.searchParams.set("state", state);
    // Force account picker + new consent screen to avoid silent re-use of stale tokens
    authUrl.searchParams.set("prompt", "select_account consent");

    console.log("Outlook OAuth init successful, redirect URL generated");

    return new Response(
      JSON.stringify({ authUrl: authUrl.toString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    console.error("Error in outlook-oauth-init:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
