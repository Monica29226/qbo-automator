import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autenticado" }, 401);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user: requestingUser }, error: authError } =
      await supabaseAdmin.auth.getUser(jwt);

    if (authError || !requestingUser) return json({ error: "No autenticado" }, 401);

    // Only global admins can delete users
    const { data: userRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", requestingUser.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!userRole) return json({ error: "Solo administradores globales pueden eliminar usuarios" }, 403);

    const { userId } = await req.json();
    if (!userId) return json({ error: "ID de usuario requerido" }, 400);
    if (userId === requestingUser.id) return json({ error: "No puedes eliminar tu propia cuenta" }, 400);

    console.log("Deleting user:", userId);

    // Get email up front to clean invitations afterwards
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .maybeSingle();

    // ===== Primary: delete from auth.users (cascade via FKs) =====
    const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (authDeleteError) {
      // If auth user not found, try cascading manually to clean up orphans
      const notFound = authDeleteError.message?.toLowerCase().includes('not found')
        || (authDeleteError as any).status === 404;
      if (!notFound) {
        console.error("Auth delete error:", authDeleteError);
        return json({ error: `Error al eliminar: ${authDeleteError.message}` }, 500);
      }
      console.warn("Auth user not found, cleaning orphan rows");
    }

    // ===== Belt-and-suspenders: clean rows that might not cascade =====
    const cleanups = await Promise.allSettled([
      supabaseAdmin.from("organization_members").delete().eq("user_id", userId),
      supabaseAdmin.from("user_roles").delete().eq("user_id", userId),
      supabaseAdmin.from("user_active_organization").delete().eq("user_id", userId),
      supabaseAdmin.from("profiles").delete().eq("id", userId),
      profile?.email
        ? supabaseAdmin.from("organization_invitations").delete().eq("email", profile.email)
        : Promise.resolve(),
      profile?.email
        ? supabaseAdmin.from("allowed_emails").delete().eq("email", profile.email.toLowerCase().trim())
        : Promise.resolve(),
    ]);

    const failures = cleanups
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.status === "rejected")
      .map(({ r, i }) => ({ step: i, reason: (r as PromiseRejectedResult).reason?.message }));

    if (failures.length > 0) console.warn("Cleanup warnings:", failures);

    return json({
      success: true,
      message: "Usuario eliminado correctamente",
      cleanupWarnings: failures,
    }, 200);

  } catch (error: any) {
    console.error("delete-user error:", error);
    return json({ error: error.message || "Error interno" }, 500);
  }
});

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
