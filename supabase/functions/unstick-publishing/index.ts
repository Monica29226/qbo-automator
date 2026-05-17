// Universal job: revierte facturas atascadas en status='publishing' >15min.
// NO dispara reintentos — los crons normales (auto-sync-invoices / publish) se encargan.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    // 1) Detectar atascadas con info de org
    const { data: stuck, error: selErr } = await supabase
      .from("processed_documents")
      .select("id, doc_number, organization_id, updated_at, organizations(name)")
      .eq("status", "publishing")
      .lt("updated_at", cutoff);

    if (selErr) throw selErr;

    const total = stuck?.length ?? 0;
    if (total === 0) {
      console.log("[unstick-publishing] No stuck documents found");
      return new Response(
        JSON.stringify({ success: true, reset_count: 0, by_org: {} }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2) Breakdown por organización
    const byOrg: Record<string, number> = {};
    for (const d of stuck!) {
      const name = (d as any).organizations?.name || d.organization_id;
      byOrg[name] = (byOrg[name] || 0) + 1;
    }

    // 3) Reset universal
    const ids = stuck!.map((d) => d.id);
    const { error: updErr } = await supabase
      .from("processed_documents")
      .update({
        status: "processed",
        updated_at: new Date().toISOString(),
        error_message: `Reseteada desde publishing por timeout (cron unstick) - ${new Date().toISOString()}`,
      })
      .in("id", ids);

    if (updErr) throw updErr;

    console.log(`[unstick-publishing] Reset ${total} document(s). By org:`, JSON.stringify(byOrg));

    return new Response(
      JSON.stringify({ success: true, reset_count: total, by_org: byOrg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[unstick-publishing] Error:", e);
    return new Response(
      JSON.stringify({ success: false, error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
