import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { SP_SCOPES } from "../_shared/sharepoint.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const userIdFromQuery = url.searchParams.get("user_id") || "";
    const returnTo = url.searchParams.get("return_to") || "/admin/sharepoint-setup";

    const clientId = Deno.env.get("MICROSOFT_CLIENT_ID");
    if (!clientId) throw new Error("MICROSOFT_CLIENT_ID not configured");

    const projectId = Deno.env.get("SUPABASE_URL")!.split(".")[0].replace("https://", "");
    const redirectUri = `https://${projectId}.supabase.co/functions/v1/sharepoint-oauth-callback`;

    const state = btoa(JSON.stringify({
      adminMode: true,
      user_id: userIdFromQuery,
      return_to: returnTo,
      ts: Date.now(),
    }));

    const authUrl = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_mode", "query");
    authUrl.searchParams.set("scope", SP_SCOPES);
    authUrl.searchParams.set("prompt", "select_account consent");
    authUrl.searchParams.set("state", state);

    return new Response(JSON.stringify({ auth_url: authUrl.toString() }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
