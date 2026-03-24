import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function escapeImapQuotedString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"").replace(/[\r\n]/g, "");
}

async function testImapLogin(
  host: string,
  port: number,
  email: string,
  password: string
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
          if (
            response.includes(`${tag} OK`) ||
            response.includes(`${tag} NO`) ||
            response.includes(`${tag} BAD`)
          ) {
            break;
          }
        } else if (response.includes("\r\n")) {
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      return response;
    };

    // Greeting
    const greeting = await readUntil();
    console.log(`[Bluehost-Connect] IMAP greeting: ${greeting.substring(0, 200)}`);
    if (!greeting.includes("OK")) {
      return {
        ok: false,
        reason: "protocol_error",
        details: `Greeting inválido: ${greeting.substring(0, 200)}`,
      };
    }

    // Login
    const safeEmail = escapeImapQuotedString(email);
    const safePassword = escapeImapQuotedString(password);
    const tag = "A001";
    const cmd = `${tag} LOGIN "${safeEmail}" "${safePassword}"\r\n`;
    await conn.write(encoder.encode(cmd));
    const loginResp = await readUntil(tag);

    console.log(`[Bluehost-Connect] IMAP login response (redacted pwd): ${loginResp.substring(0, 300)}`);

    if (loginResp.includes("AUTHENTICATIONFAILED") || loginResp.includes(`${tag} NO`)) {
      return {
        ok: false,
        reason: "auth_failed",
        details: loginResp.substring(0, 250),
      };
    }

    if (!loginResp.includes(`${tag} OK`)) {
      return {
        ok: false,
        reason: "protocol_error",
        details: loginResp.substring(0, 250),
      };
    }

    // Logout (best-effort)
    try {
      await conn.write(encoder.encode("A999 LOGOUT\r\n"));
      await readUntil("A999");
    } catch {
      // ignore
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: "connect_failed",
      details: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try {
      conn?.close();
    } catch {
      // ignore
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing required environment variables");
    }

    const { 
      organization_id, 
      user_id, 
      email, 
      password, 
      imap_host, 
      imap_port 
    } = await req.json();
    
    if (!organization_id || !user_id || !email || !password) {
      return new Response(
        JSON.stringify({
          success: false,
          error_code: "MISSING_PARAMS",
          message: "Faltan parámetros requeridos",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Default IMAP settings for Bluehost (CEMSA)
    const host = imap_host || "mail.cemsacr.com";
    const port = imap_port || 993;

    console.log(`[Bluehost] Connecting for organization: ${organization_id}, email: ${email}, host: ${host}:${port}`);

    // Validate credentials BEFORE saving (prevents "connected" but fetch fails later)
    const test = await testImapLogin(host, port, email, password);
    if (!test.ok) {
      console.warn(`[Bluehost] IMAP test failed (${test.reason}) for ${email}:`, test.details);

      const userMessage =
        test.reason === "auth_failed"
          ? "No se pudo autenticar en el correo. Verifica que sea la contraseña del buzón (no la del panel) y, si tienes 2FA, usa una contraseña de aplicación."
          : "No se pudo conectar al servidor IMAP. Verifica servidor/puerto e inténtalo de nuevo.";

      return new Response(
        JSON.stringify({
          success: false,
          error_code: test.reason === "auth_failed" ? "IMAP_AUTH_FAILED" : "IMAP_CONNECT_FAILED",
          message: userMessage,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    console.log(`[Bluehost] ✅ IMAP credentials validated successfully for ${email}`);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Store credentials in integration_accounts
    const credentials = {
      email,
      password,
      imap_host: host,
      imap_port: port,
      imap_secure: true,
    };

    // Check if there's an existing bluehost account for this org
    const { data: existing } = await supabase
      .from("integration_accounts")
      .select("id")
      .eq("organization_id", organization_id)
      .eq("service_type", "bluehost")
      .maybeSingle();

    if (existing) {
      const { error: updateError } = await supabase
        .from("integration_accounts")
        .update({
          account_email: email,
          account_name: `Bluehost - ${email}`,
          credentials,
          is_active: true,
          created_by: user_id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (updateError) {
        console.error("[Bluehost] Error updating integration account:", updateError);
        throw updateError;
      }
    } else {
      const { error: insertError } = await supabase
        .from("integration_accounts")
        .insert({
          organization_id,
          service_type: "bluehost",
          account_email: email,
          account_name: `Bluehost - ${email}`,
          credentials,
          is_active: true,
          created_by: user_id,
        });

      if (insertError) {
        console.error("[Bluehost] Error inserting integration account:", insertError);
        throw insertError;
      }
    }

    // Update organization
    const { error: updateError } = await supabase
      .from("organizations")
      .update({
        bluehost_connected: true,
        bluehost_email: email,
        updated_at: new Date().toISOString(),
      })
      .eq("id", organization_id);

    if (updateError) {
      console.error("[Bluehost] Error updating organization:", updateError);
      throw updateError;
    }

    console.log(`[Bluehost] Connected successfully for ${email}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        email,
        message: "Bluehost conectado exitosamente" 
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("[Bluehost] Error in bluehost-connect:", error);
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
