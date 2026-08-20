import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeOrganizationAccess } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type QboEntity = {
  Id?: string;
  DocNumber?: string;
  TxnDate?: string;
  TotalAmt?: number;
  VendorRef?: { value?: string; name?: string };
};

async function fetchAllEntities(
  entityType: "Bill" | "VendorCredit",
  realmId: string,
  accessToken: string,
): Promise<QboEntity[]> {
  const entities: QboEntity[] = [];
  const pageSize = 1000;

  for (let start = 1; start <= 10000; start += pageSize) {
    const query = `SELECT * FROM ${entityType} STARTPOSITION ${start} MAXRESULTS ${pageSize}`;
    const response = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=73`,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`QuickBooks ${entityType} audit failed (HTTP ${response.status}): ${detail.substring(0, 300)}`);
    }

    const payload = await response.json();
    const page = payload.QueryResponse?.[entityType] || [];
    entities.push(...page);
    if (page.length < pageSize) break;
  }

  return entities;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Backend configuration is incomplete");

    const { organization_id: organizationId } = await req.json().catch(() => ({}));
    if (!organizationId) throw new Error("organization_id is required");

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const authorized = await authorizeOrganizationAccess(req, supabase, serviceRoleKey, organizationId);
    if (authorized instanceof Response) return authorized;

    const [{ data: integration, error: integrationError }, { data: documents, error: documentsError }] = await Promise.all([
      supabase
        .from("integration_accounts")
        .select("credentials")
        .eq("organization_id", organizationId)
        .eq("service_type", "quickbooks")
        .eq("is_active", true)
        .maybeSingle(),
      supabase
        .from("processed_documents")
        .select("id, doc_key, doc_number, doc_type, supplier_name, supplier_tax_id, total_amount, qbo_entity_id, qbo_entity_type")
        .eq("organization_id", organizationId),
    ]);

    if (integrationError || !integration?.credentials) throw new Error("QuickBooks is not connected");
    if (documentsError) throw documentsError;
    const credentials = integration.credentials as { access_token?: string; realm_id?: string };
    if (!credentials.access_token || !credentials.realm_id) throw new Error("QuickBooks credentials are incomplete");

    const [bills, vendorCredits] = await Promise.all([
      fetchAllEntities("Bill", credentials.realm_id, credentials.access_token),
      fetchAllEntities("VendorCredit", credentials.realm_id, credentials.access_token),
    ]);

    const documentNumbers = new Set((documents || []).map((doc) => doc.doc_number));
    const candidates = [
      ...bills.map((entity) => ({ ...entity, entity_type: "Bill" })),
      ...vendorCredits.map((entity) => ({ ...entity, entity_type: "VendorCredit" })),
    ].filter((entity) => entity.DocNumber && documentNumbers.has(entity.DocNumber));

    const grouped = new Map<string, typeof candidates>();
    for (const entity of candidates) {
      // A real duplicate can carry a different QBO total when a prior buggy
      // publication recalculated IVA. Group by type + full consecutive +
      // vendor, then expose every amount for comparison with the XML.
      const key = `${entity.entity_type}|${entity.DocNumber}|${entity.VendorRef?.value || ""}`;
      const group = grouped.get(key) || [];
      group.push(entity);
      grouped.set(key, group);
    }

    const duplicateGroups = [...grouped.values()]
      .filter((group) => group.length > 1)
      .map((group) => {
        const first = group[0];
        const matchingDocuments = (documents || []).filter((doc) => doc.doc_number === first.DocNumber);
        const trackedId = matchingDocuments.find((doc) => doc.qbo_entity_id)?.qbo_entity_id || null;
        return {
          doc_number: first.DocNumber,
          entity_type: first.entity_type,
          vendor_id: first.VendorRef?.value || null,
          vendor_name: first.VendorRef?.name || null,
          qbo_totals: group.map((entity) => Math.abs(Number(entity.TotalAmt || 0))),
          qbo_ids: group.map((entity) => entity.Id),
          qbo_dates: group.map((entity) => entity.TxnDate),
          tracked_qbo_id: trackedId,
          suggested_keep_id: trackedId && group.some((entity) => entity.Id === trackedId) ? trackedId : group[0].Id,
          document_keys: matchingDocuments.map((doc) => doc.doc_key),
          xml_totals: matchingDocuments.map((doc) => Math.abs(Number(doc.total_amount || 0))),
        };
      });

    return new Response(JSON.stringify({
      success: true,
      database_documents: documents?.length || 0,
      qbo_bills_scanned: bills.length,
      qbo_vendor_credits_scanned: vendorCredits.length,
      matched_qbo_entities: candidates.length,
      duplicate_groups: duplicateGroups,
      duplicate_group_count: duplicateGroups.length,
      duplicate_entity_count: duplicateGroups.reduce((sum, group) => sum + group.qbo_ids.length, 0),
      note: "Read-only audit. No QuickBooks entities were changed or deleted.",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});