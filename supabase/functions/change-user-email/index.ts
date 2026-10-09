import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Solo administradores globales. Cambia el correo de acceso conservando el mismo usuario.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user: caller } } = await admin.auth.getUser(token);
    if (!caller) return json({ error: "No autenticado" }, 401);
    const { data: role } = await admin.from("user_roles").select("role").eq("user_id", caller.id).eq("role", "admin").maybeSingle();
    if (!role) return json({ error: "Solo administradores globales" }, 403);

    const { user_id, new_email } = await req.json();
    const email = String(new_email ?? "").toLowerCase().trim();
    if (!user_id || !email.includes("@")) return json({ error: "Datos inválidos" }, 400);

    const { error } = await admin.auth.admin.updateUserById(user_id, { email, email_confirm: true });
    if (error) return json({ error: error.message }, 400);
    await admin.from("profiles").update({ email }).eq("id", user_id);
    await admin.from("audit_log").insert({
      user_id: caller.id, action: "change_user_email", resource_type: "user", resource_id: user_id, details: { new_email: email },
    });
    return json({ success: true, email });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
