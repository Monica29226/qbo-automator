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

    // Default IMAP settings for Hostinger
    // Hostinger uses imap.hostinger.com on port 993 with SSL
    const host = imap_host || "imap.hostinger.com";
    const port = imap_port || 993;

    console.log(`[Hostinger] Connecting for organization: ${organization_id}, email: ${email}`);

    // Validate credentials BEFORE saving them (prevents "conectado" pero luego falla al traer facturas)
    const test = await testImapLogin(host, port, email, password);
    if (!test.ok) {
      console.warn(`[Hostinger] IMAP test failed (${test.reason}) for ${email}:`, test.details);

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

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Store credentials in integration_accounts (encrypted by Supabase)
    const credentials = {
      email,
      password,
      imap_host: host,
      imap_port: port,
      imap_secure: true,
    };

    // Check if there's an existing hostinger account for this org
    const { data: existing } = await supabase
      .from("integration_accounts")
      .select("id")
      .eq("organization_id", organization_id)
      .eq("service_type", "hostinger")
      .maybeSingle();

    if (existing) {
      // Update existing
      const { error: updateError } = await supabase
        .from("integration_accounts")
        .update({
          account_email: email,
          account_name: `Hostinger - ${email}`,
          credentials,
          is_active: true,
          created_by: user_id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (updateError) {
        console.error("[Hostinger] Error updating integration account:", updateError);
        throw updateError;
      }
    } else {
      // Insert new
      const { error: insertError } = await supabase
        .from("integration_accounts")
        .insert({
          organization_id,
          service_type: "hostinger",
          account_email: email,
          account_name: `Hostinger - ${email}`,
          credentials,
          is_active: true,
          created_by: user_id,
        });

      if (insertError) {
        console.error("[Hostinger] Error inserting integration account:", insertError);
        throw insertError;
      }
    }

    // Update organization
    const { error: updateError } = await supabase
      .from("organizations")
      .update({
        hostinger_connected: true,
        hostinger_email: email,
        updated_at: new Date().toISOString(),
      })
      .eq("id", organization_id);

    if (updateError) {
      console.error("[Hostinger] Error updating organization:", updateError);
      throw updateError;
    }

    console.log(`[Hostinger] Connected successfully for ${email}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        email,
        message: "Hostinger conectado exitosamente" 
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("[Hostinger] Error in hostinger-connect:", error);
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
