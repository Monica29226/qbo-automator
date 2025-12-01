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
    
    if (!state) {
      throw new Error("Missing state parameter");
    }

    const redirectUri = `${SUPABASE_URL}/functions/v1/outlook-oauth-callback`;
    
    // Microsoft OAuth 2.0 authorization endpoint
    // Using "common" tenant to allow both personal and work/school accounts
    const authUrl = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    authUrl.searchParams.set("client_id", MICROSOFT_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    // Scopes: offline_access for refresh token, Mail.Read for reading emails, User.Read for user profile
    authUrl.searchParams.set("scope", "offline_access Mail.Read Mail.ReadBasic User.Read");
    authUrl.searchParams.set("response_mode", "query");
    authUrl.searchParams.set("state", state);
    // Force account selection
    authUrl.searchParams.set("prompt", "select_account");

    console.log("Outlook OAuth init successful, redirect URL generated");

    return new Response(
      JSON.stringify({ authUrl: authUrl.toString() }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in outlook-oauth-init:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
