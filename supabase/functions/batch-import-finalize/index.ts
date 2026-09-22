import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const { batch_id, organization_id, missing_consecutives = [] } = await req.json();
    if (!batch_id || !organization_id) return json({ error: "invalid_payload" }, 400);

    const { data: isAdmin } = await supabase.rpc("is_organization_admin", {
      _org_id: organization_id,
      _user_id: user.id,
    });
    if (!isAdmin) return json({ error: "forbidden" }, 403);

    // Aggregate from items
    const { data: items } = await supabase
      .from("batch_import_items")
      .select("status")
      .eq("batch_id", batch_id);

    const counts = {
      total_files: items?.length ?? 0,
      accepted_count: items?.filter((i) => i.status === "accepted").length ?? 0,
      pending_count: items?.filter((i) => i.status === "pending_hacienda").length ?? 0,
      rejected_count: items?.filter((i) => i.status === "rejected").length ?? 0,
      duplicate_count: items?.filter((i) => i.status === "duplicate").length ?? 0,
    };

    await supabase
      .from("batch_imports")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        missing_consecutives,
        ...counts,
      })
      .eq("id", batch_id);

    // Sin correo: el resumen del lote se ve en el panel. Los avisos por correo
    // quedaron centralizados en el reporte diario (solo problemas críticos).
    await supabase.from("batch_imports").update({ notification_sent: false }).eq("id", batch_id);


    return json({ ok: true, counts });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
