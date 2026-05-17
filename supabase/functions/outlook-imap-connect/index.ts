import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_HOST = "outlook.office365.com";
const DEFAULT_PORT = 993;

function escapeImapQuotedString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, "");
}

async function testImapLogin(
  host: string,
  port: number,
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; reason: "auth_failed" | "connect_failed" | "protocol_error"; details: string }> {
  let conn: Deno.TlsConn | null = null;
  try {
    conn = await Deno.connectTls({ hostname: host, port });
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const buffer = new Uint8Array(8192);

    const readUntil = async (tag?: string) => {
      let response = "";
      for (let attempts = 0; attempts < 80; attempts++) {
        const n = await conn!.read(buffer);
        if (n === null) break;
        response += decoder.decode(buffer.subarray(0, n));
        if (tag) {
          if (response.includes(`${tag} OK`) || response.includes(`${tag} NO`) || response.includes(`${tag} BAD`)) break;
        } else if (response.includes("\r\n")) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      return response;
    };

    const greeting = await readUntil();
    console.log(`[Outlook-IMAP-Connect] Greeting: ${greeting.substring(0, 200)}`);
    if (!greeting.includes("OK")) {
      return { ok: false, reason: "protocol_error", details: `Greeting inválido: ${greeting.substring(0, 200)}` };
    }

    const tag = "A001";
    const cmd = `${tag} LOGIN "${escapeImapQuotedString(email)}" "${escapeImapQuotedString(password)}"\r\n`;
    await conn.write(encoder.encode(cmd));
    const loginResp = await readUntil(tag);
    console.log(`[Outlook-IMAP-Connect] Login response (redacted): ${loginResp.substring(0, 300)}`);

    if (loginResp.includes("AUTHENTICATIONFAILED") || loginResp.includes(`${tag} NO`)) {
      return { ok: false, reason: "auth_failed", details: loginResp.substring(0, 250) };
    }
    if (!loginResp.includes(`${tag} OK`)) {
      return { ok: false, reason: "protocol_error", details: loginResp.substring(0, 250) };
    }

    try {
      await conn.write(encoder.encode("A999 LOGOUT\r\n"));
      await readUntil("A999");
    } catch { /* ignore */ }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: "connect_failed", details: error instanceof Error ? error.message : String(error) };
  } finally {
    try { conn?.close(); } catch { /* ignore */ }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const { organization_id, user_id, email, password, imap_host, imap_port } = await req.json();

    if (!organization_id || !email || !password) {
      return new Response(
        JSON.stringify({ success: false, error_code: "MISSING_PARAMS", message: "Faltan parámetros (organization_id, email, password)" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    const host = imap_host || DEFAULT_HOST;
    const port = imap_port || DEFAULT_PORT;

    console.log(`[Outlook-IMAP-Connect] Testing ${email} on ${host}:${port}`);

    const test = await testImapLogin(host, port, email, password);
    if (!test.ok) {
      let message = "No se pudo conectar al servidor IMAP de Microsoft 365.";
      if (test.reason === "auth_failed") {
        message =
          "Microsoft 365 rechazó la autenticación. Verifica que: (1) generaste una contraseña de aplicación (no la del usuario), (2) tu admin de TI tiene habilitado IMAP y Basic Auth en Exchange Admin Center, (3) la cuenta no requiere MFA interactiva.";
      }
      return new Response(
        JSON.stringify({
          success: false,
          error_code: test.reason === "auth_failed" ? "IMAP_AUTH_FAILED" : "IMAP_CONNECT_FAILED",
          message,
          details: test.details,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const nowIso = new Date().toISOString();
    const credentials = {
      email,
      password,
      imap_host: host,
      imap_port: port,
      imap_secure: true,
      last_test_success_at: nowIso,
    };

    const { data: existing } = await supabase
      .from("integration_accounts")
      .select("id")
      .eq("organization_id", organization_id)
      .eq("service_type", "outlook_imap")
      .maybeSingle();

    if (existing) {
      await supabase.from("integration_accounts").update({
        account_email: email,
        account_name: `Microsoft 365 IMAP - ${email}`,
        credentials,
        is_active: true,
        created_by: user_id,
        updated_at: nowIso,
      }).eq("id", existing.id);
    } else {
      await supabase.from("integration_accounts").insert({
        organization_id,
        service_type: "outlook_imap",
        account_email: email,
        account_name: `Microsoft 365 IMAP - ${email}`,
        credentials,
        is_active: true,
        created_by: user_id,
      });
    }

    // Mark outlook flag so dashboards/UI reflect connectivity
    await supabase.from("organizations").update({
      outlook_connected: true,
      outlook_email: email,
      updated_at: nowIso,
    }).eq("id", organization_id);

    return new Response(
      JSON.stringify({ success: true, email, message: "Microsoft 365 IMAP conectado exitosamente" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    console.error("[Outlook-IMAP-Connect] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
