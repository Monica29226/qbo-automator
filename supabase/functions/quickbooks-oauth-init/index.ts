import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const QBO_CLIENT_ID = Deno.env.get("QBO_CLIENT_ID");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    
    if (!QBO_CLIENT_ID || !SUPABASE_URL) {
      throw new Error("Missing required environment variables");
    }

    const { state } = await req.json();
    
    if (!state) {
      throw new Error("Missing state parameter");
    }

    const redirectUri = `${SUPABASE_URL}/functions/v1/quickbooks-oauth-callback`;
    
    const authUrl = new URL("https://appcenter.intuit.com/connect/oauth2");
    authUrl.searchParams.set("client_id", QBO_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "com.intuit.quickbooks.accounting");
    authUrl.searchParams.set("state", state);

    console.log("QuickBooks OAuth init successful, redirect URL generated");

    return new Response(
      JSON.stringify({ authUrl: authUrl.toString() }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in quickbooks-oauth-init:", error);
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
