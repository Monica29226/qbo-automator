import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { organization_id, document_ids } = await req.json();
    if (!organization_id) throw new Error("organization_id es requerido");
    if (!Array.isArray(document_ids) || document_ids.length === 0) {
      throw new Error("document_ids es requerido");
    }

    console.log(`🔄 Republicando ${document_ids.length} facturas borradas de QBO (org=${organization_id})`);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1) Clear tracking
    const { error: trackingErr } = await supabase
      .from("qbo_publish_tracking")
      .delete()
      .eq("organization_id", organization_id)
      .in("document_id", document_ids);
    if (trackingErr) console.warn("⚠️ Error limpiando tracking:", trackingErr.message);

    // 2) Reset documents to pending
    const { error: resetErr } = await supabase
      .from("processed_documents")
      .update({
        qbo_entity_id: null,
        qbo_entity_type: null,
        status: "pending",
        error_message: null,
        retry_count: 0,
        processed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", organization_id)
      .in("id", document_ids);
    if (resetErr) throw resetErr;

    console.log(`✅ Limpieza OK. Encolando publicación...`);

    // 3) Re-publish via existing function
    const { data: publishResult, error: publishErr } = await supabase.functions.invoke(
      "publish-to-quickbooks",
      { body: { organization_id, document_ids } }
    );

    if (publishErr) {
      console.error("❌ Publish invoke error:", publishErr);
      throw publishErr;
    }

    // 4) Audit log
    await supabase.from("audit_log").insert({
      organization_id,
      action: "republish_after_qbo_delete",
      resource_type: "processed_document",
      details: { document_ids, publish_result: publishResult },
    }).then(() => {}, (e) => console.warn("audit_log error:", e.message));

    return new Response(JSON.stringify({
      success: true,
      cleared: document_ids.length,
      publish_result: publishResult,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("❌ Republish error:", err.message);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
