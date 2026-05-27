import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CONCURRENCY = 15;
const PAGE_SIZE = 200;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { organization_id, offset = 0, limit = PAGE_SIZE } = await req.json();
    if (!organization_id) throw new Error("organization_id es requerido");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // QBO credentials
    const { data: integration } = await supabase
      .from("integration_accounts")
      .select("credentials")
      .eq("organization_id", organization_id)
      .eq("service_type", "quickbooks")
      .eq("is_active", true)
      .maybeSingle();

    const credentials = integration?.credentials as any;
    if (!credentials?.access_token || !credentials?.realm_id) {
      throw new Error("QuickBooks no está conectado para esta organización");
    }
    const realmId = credentials.realm_id;
    const token = credentials.access_token;

    // Page of published docs with qbo_entity_id
    const { data: docs, count } = await supabase
      .from("processed_documents")
      .select("id, doc_number, doc_key, supplier_name, issue_date, total_amount, currency, qbo_entity_id, qbo_entity_type", { count: "exact" })
      .eq("organization_id", organization_id)
      .eq("status", "published")
      .not("qbo_entity_id", "is", null)
      .order("issue_date", { ascending: false })
      .range(offset, offset + limit - 1);

    const list = docs || [];
    console.log(`🔍 Audit page: offset=${offset}, batch=${list.length}, total=${count}`);

    const orphans: any[] = [];
    const unverifiable: any[] = [];
    let tokenExpired = false;

    // Process in chunks of CONCURRENCY
    for (let i = 0; i < list.length; i += CONCURRENCY) {
      if (tokenExpired) break;
      const chunk = list.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(chunk.map((doc) => checkDoc(doc, realmId, token)));
      for (let j = 0; j < settled.length; j++) {
        const res = settled[j];
        const doc = chunk[j];
        if (res.status === "fulfilled") {
          const r = res.value;
          if (r.tokenExpired) { tokenExpired = true; break; }
          if (r.orphan) orphans.push({ ...doc, reason: r.reason });
          else if (r.unverifiable) unverifiable.push({ ...doc, reason: r.reason });
        } else {
          unverifiable.push({ ...doc, reason: res.reason?.message || "error desconocido" });
        }
      }
    }

    if (tokenExpired) {
      return new Response(JSON.stringify({
        success: false,
        token_expired: true,
        message: "Token de QuickBooks expirado. Reconecta la integración para auditar.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const nextOffset = offset + list.length;
    const hasMore = (count ?? 0) > nextOffset;

    return new Response(JSON.stringify({
      success: true,
      total: count ?? 0,
      checked_in_page: list.length,
      offset,
      next_offset: hasMore ? nextOffset : null,
      has_more: hasMore,
      orphans,
      unverifiable,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("❌ Audit error:", err.message);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function checkDoc(doc: any, realmId: string, token: string) {
  const entityType = (doc.qbo_entity_type || "Bill").toLowerCase();
  const url = `https://quickbooks.api.intuit.com/v3/company/${realmId}/${entityType}/${doc.qbo_entity_id}?minorversion=73`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (resp.status === 401) return { tokenExpired: true };
  if (resp.status === 404) return { orphan: true, reason: "404 Not Found en QBO" };

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    const code = body?.Fault?.Error?.[0]?.code;
    const msg = body?.Fault?.Error?.[0]?.Message || `HTTP ${resp.status}`;
    if (code === "610" || /not found|deleted/i.test(msg)) {
      return { orphan: true, reason: msg };
    }
    return { unverifiable: true, reason: msg };
  }

  const data = await resp.json();
  const entity = data?.Bill || data?.VendorCredit || data?.Invoice;
  if (!entity) return { orphan: true, reason: "Respuesta sin entidad" };
  if (entity.status === "Deleted" || entity.Status === "Deleted") {
    return { orphan: true, reason: "Marcada como Deleted en QBO" };
  }
  return { orphan: false };
}
