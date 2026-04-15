import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const MICROSOFT_CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");

    if (!MICROSOFT_CLIENT_ID || !SUPABASE_URL) {
      throw new Error("Missing MICROSOFT_CLIENT_ID or SUPABASE_URL");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const { state } = await req.json();
    if (!state) throw new Error("Missing state parameter");

    const redirectUri = `${SUPABASE_URL}/functions/v1/onedrive-oauth-callback`;

    const authUrl = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    authUrl.searchParams.set("client_id", MICROSOFT_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "offline_access Files.Read Files.Read.All User.Read");
    authUrl.searchParams.set("response_mode", "query");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("prompt", "select_account");

    return new Response(
      JSON.stringify({ authUrl: authUrl.toString() }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
