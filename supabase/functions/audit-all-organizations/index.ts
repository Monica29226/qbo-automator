// Tenant-wide audit: for every organization with QuickBooks connected,
// sample the most recent 'published' documents and check whether they still
// exist in QuickBooks and whether the total/tax match the XML.
//
// This is read-only and safe to run repeatedly. It is the global counterpart
// to audit-qbo-published-vs-actual (single-org).
//
// Body: { sample_per_org?: number = 100, organization_ids?: string[] }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CONCURRENCY = 8;
const AMOUNT_TOLERANCE = 1.0;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const samplePerOrg = Math.min(Math.max(Number(body?.sample_per_org) || 100, 1), 500);
    const orgFilter: string[] | null = Array.isArray(body?.organization_ids) && body.organization_ids.length > 0
      ? body.organization_ids
      : null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1) Organizations with active QuickBooks integration
    let q = supabase
      .from("integration_accounts")
      .select("organization_id, credentials, organizations(name)")
      .eq("service_type", "quickbooks")
      .eq("is_active", true);
    if (orgFilter) q = q.in("organization_id", orgFilter);
    const { data: integrations, error: intErr } = await q;
    if (intErr) throw intErr;

    const summary: any[] = [];

    for (const integ of integrations || []) {
      const orgId = (integ as any).organization_id as string;
      const orgName = (integ as any).organizations?.name || orgId;
      const creds = (integ as any).credentials || {};
      const token = creds.access_token;
      const realmId = creds.realm_id;

      const orgRow: any = {
        organization_id: orgId,
        organization_name: orgName,
        published_total: 0,
        sampled: 0,
        verified_ok: 0,
        orphans: 0,
        amount_mismatches: 0,
        unverifiable: 0,
        token_missing: false,
        published_without_tracking: 0,
        pending_with_qbo_id: 0,
      };

      // Always compute inconsistency counters
      const [pubRes, pendRes, noTrkRes] = await Promise.all([
        supabase.from("processed_documents")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId).eq("status", "published"),
        supabase.from("processed_documents")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId).eq("status", "pending").not("qbo_entity_id", "is", null),
        // published docs whose tracking row is missing
        supabase.rpc("count_published_without_tracking", { p_org: orgId }).then(
          (r: any) => ({ count: typeof r?.data === 'number' ? r.data : 0 }),
          () => ({ count: 0 }),
        ),
      ]);
      orgRow.published_total = pubRes.count || 0;
      orgRow.pending_with_qbo_id = pendRes.count || 0;
      orgRow.published_without_tracking = (noTrkRes as any).count || 0;

      if (!token || !realmId) {
        orgRow.token_missing = true;
        summary.push(orgRow);
        continue;
      }

      // Sample most recent published docs with qbo_entity_id
      const { data: docs } = await supabase
        .from("processed_documents")
        .select("id, doc_number, total_amount, total_tax, currency, qbo_entity_id, qbo_entity_type")
        .eq("organization_id", orgId)
        .eq("status", "published")
        .not("qbo_entity_id", "is", null)
        .order("issue_date", { ascending: false })
        .limit(samplePerOrg);

      const list = docs || [];
      orgRow.sampled = list.length;

      for (let i = 0; i < list.length; i += CONCURRENCY) {
        const chunk = list.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(chunk.map((d) => checkDoc(d, realmId, token)));
        for (const r of results) {
          if (r.status !== "fulfilled") {
            orgRow.unverifiable++;
            continue;
          }
          const v = r.value;
          if (v.tokenExpired) {
            orgRow.token_missing = true;
            orgRow.unverifiable += chunk.length;
            break;
          }
          if (v.orphan) orgRow.orphans++;
          else if (v.amountMismatch) orgRow.amount_mismatches++;
          else if (v.unverifiable) orgRow.unverifiable++;
          else orgRow.verified_ok++;
        }
        if (orgRow.token_missing) break;
      }

      summary.push(orgRow);
    }

    // Sort by riskiest first
    summary.sort((a, b) => (b.orphans + b.amount_mismatches) - (a.orphans + a.amount_mismatches));

    return new Response(
      JSON.stringify({ success: true, organizations: summary, generated_at: new Date().toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("audit-all-organizations error:", err?.message || err);
    return new Response(
      JSON.stringify({ success: false, error: err?.message || String(err) }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

async function checkDoc(doc: any, realmId: string, token: string) {
  const entityType = (doc.qbo_entity_type || "Bill").toLowerCase();
  const url = `https://quickbooks.api.intuit.com/v3/company/${realmId}/${entityType}/${doc.qbo_entity_id}?minorversion=73`;
  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (resp.status === 401) return { tokenExpired: true };
    if (resp.status === 404) return { orphan: true };
    if (!resp.ok) {
      const b = await resp.json().catch(() => ({}));
      const code = b?.Fault?.Error?.[0]?.code;
      const msg = b?.Fault?.Error?.[0]?.Message || `HTTP ${resp.status}`;
      if (code === "610" || /not found|deleted/i.test(msg)) return { orphan: true };
      return { unverifiable: true };
    }
    const data = await resp.json();
    const ent = data?.Bill || data?.VendorCredit || data?.Invoice;
    if (!ent) return { orphan: true };
    if (ent.status === "Deleted" || ent.Status === "Deleted") return { orphan: true };
    const qboTotal = Math.abs(parseFloat(ent.TotalAmt || "0"));
    const qboTax = Math.abs(parseFloat(ent?.TxnTaxDetail?.TotalTax || "0"));
    const xmlTotal = Math.abs(parseFloat(doc.total_amount || "0"));
    const xmlTax = Math.abs(parseFloat(doc.total_tax || "0"));
    if (Math.abs(qboTotal - xmlTotal) > AMOUNT_TOLERANCE || Math.abs(qboTax - xmlTax) > AMOUNT_TOLERANCE) {
      return { amountMismatch: true };
    }
    return {};
  } catch {
    return { unverifiable: true };
  }
}
