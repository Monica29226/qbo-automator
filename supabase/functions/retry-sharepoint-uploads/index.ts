import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: account } = await supabase
      .from("sharepoint_admin_account")
      .select("id")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (!account) return json({ skipped: true, reason: "no active account" });

    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: docs, error } = await supabase
      .from("processed_documents")
      .select("id, doc_number, sharepoint_retry_count")
      .not("qbo_entity_id", "is", null)
      .is("sharepoint_uploaded_at", null)
      .gte("created_at", cutoff)
      .lt("sharepoint_retry_count", 5)
      .limit(50);

    if (error) return json({ error: error.message }, 500);

    let ok = 0, failed = 0;
    for (const d of (docs || [])) {
      try {
        const res = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/upload-to-sharepoint`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ document_id: d.id }),
          },
        );
        if (res.ok) ok++;
        else {
          failed++;
          await supabase
            .from("processed_documents")
            .update({ sharepoint_retry_count: (d.sharepoint_retry_count || 0) + 1 })
            .eq("id", d.id);
        }
      } catch (_e) {
        failed++;
      }
    }

    return json({ ok: true, processed: docs?.length || 0, succeeded: ok, failed });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
