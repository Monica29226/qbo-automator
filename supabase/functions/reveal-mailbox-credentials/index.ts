import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_SERVICES = ["bluehost", "hostinger", "outlook_imap"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = req.headers.get("Authorization")?.replace("Bearer ", "").trim();
    if (!token) return json({ success: false, error: "No autenticado" }, 401);

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ success: false, error: "No autenticado" }, 401);

    const body = await req.json().catch(() => ({}));
    const organization_id: string | undefined = body.organization_id;
    const service_type: string | undefined = body.service_type;

    if (!organization_id || !service_type) {
      return json({ success: false, error: "Faltan parámetros" }, 400);
    }
    if (!ALLOWED_SERVICES.includes(service_type)) {
      return json({ success: false, error: "Servicio no soportado" }, 400);
    }

    // Solo administradores globales pueden ver credenciales en texto claro.
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });
    if (!isAdmin) {
      return json({ success: false, error: "Solo administradores pueden ver credenciales" }, 403);
    }

    const { data: account, error } = await supabase
      .from("integration_accounts")
      .select("id, account_email, credentials")
      .eq("organization_id", organization_id)
      .eq("service_type", service_type)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return json({ success: false, error: error.message }, 500);
    if (!account) return json({ success: false, error: "No hay una cuenta guardada" }, 404);

    const creds = (account.credentials ?? {}) as Record<string, unknown>;

    // Registro de auditoría del acceso a la credencial.
    await supabase.from("audit_log").insert({
      organization_id,
      user_id: user.id,
      action: "reveal_mailbox_credentials",
      entity_type: "integration_accounts",
      entity_id: account.id,
      details: { service_type },
    }).then(undefined, () => undefined);

    return json({
      success: true,
      data: {
        email: (creds.email as string) ?? account.account_email ?? null,
        password: (creds.password as string) ?? null,
        imap_host: (creds.imap_host as string) ?? null,
        imap_port: (creds.imap_port as number) ?? null,
        imap_secure: creds.imap_secure ?? true,
      },
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : "Error" }, 500);
  }
});
