import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round2 = (n: number) => Math.round(n * 100) / 100;

interface AuditRow {
  document_id: string;
  doc_number: string;
  supplier_name: string;
  issue_date: string;
  currency: string;
  xml_total: number;
  xml_tax: number;
  qbo_total: number;
  qbo_tax: number;
  qbo_mode: string;
  qbo_entity_id: string;
  status: "ok" | "tax_separated" | "total_mismatch" | "both" | "error";
  notes: string;
  error?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Auth check
    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: userData } = await supabase.auth.getUser(token);
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { organization_id, date_from, date_to, limit: maxDocs } = body ?? {};

    if (!organization_id) {
      return new Response(
        JSON.stringify({ success: false, error: "organization_id requerido" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    // Verify membership
    const { data: member } = await supabase
      .from("organization_members")
      .select("id")
      .eq("organization_id", organization_id)
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!member) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Read org IVA-as-expense flag
    const { data: setting } = await supabase
      .from("system_settings")
      .select("value")
      .eq("organization_id", organization_id)
      .eq("key", "default_uses_tax")
      .maybeSingle();
    const ivaAsExpense = setting?.value === "false";

    // QBO credentials
    const { data: qboAccount } = await supabase
      .from("integration_accounts")
      .select("credentials")
      .eq("organization_id", organization_id)
      .eq("service_type", "quickbooks")
      .eq("is_active", true)
      .maybeSingle();

    if (!qboAccount) {
      return new Response(
        JSON.stringify({ success: false, error: "QuickBooks no conectado" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }
    const credentials = qboAccount.credentials as any;
    const accessToken = credentials.access_token;
    const realmId = credentials.realm_id;

    let query = supabase
      .from("processed_documents")
      .select("id, doc_number, supplier_name, issue_date, currency, total_amount, total_tax, qbo_entity_id, qbo_entity_type")
      .eq("organization_id", organization_id)
      .eq("status", "published")
      .not("qbo_entity_id", "is", null);

    if (date_from) query = query.gte("issue_date", date_from);
    if (date_to) query = query.lte("issue_date", date_to);
    query = query.order("issue_date", { ascending: false }).limit(maxDocs || 100);

    const { data: docs, error: docsErr } = await query;
    if (docsErr) throw docsErr;

    const results: AuditRow[] = [];

    for (const doc of docs ?? []) {
      await sleep(150);
      const xmlTotal = round2(Number(doc.total_amount) || 0);
      const xmlTax = round2(Number(doc.total_tax) || 0);

      try {
        const entityType = (doc.qbo_entity_type || "bill").toLowerCase();
        const endpoint = entityType === "vendorcredit" ? "vendorcredit" : "bill";
        const url = `https://quickbooks.api.intuit.com/v3/company/${realmId}/${endpoint}/${doc.qbo_entity_id}?minorversion=65`;
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        });
        if (!resp.ok) {
          const txt = await resp.text();
          results.push({
            document_id: doc.id,
            doc_number: doc.doc_number,
            supplier_name: doc.supplier_name,
            issue_date: doc.issue_date,
            currency: doc.currency,
            xml_total: xmlTotal,
            xml_tax: xmlTax,
            qbo_total: 0,
            qbo_tax: 0,
            qbo_mode: "",
            qbo_entity_id: doc.qbo_entity_id,
            status: "error",
            notes: "",
            error: `QBO ${resp.status}: ${txt.substring(0, 160)}`,
          });
          continue;
        }
        const qboData = await resp.json();
        const entity = qboData.Bill || qboData.VendorCredit;
        if (!entity) {
          results.push({
            document_id: doc.id,
            doc_number: doc.doc_number,
            supplier_name: doc.supplier_name,
            issue_date: doc.issue_date,
            currency: doc.currency,
            xml_total: xmlTotal,
            xml_tax: xmlTax,
            qbo_total: 0,
            qbo_tax: 0,
            qbo_mode: "",
            qbo_entity_id: doc.qbo_entity_id,
            status: "error",
            notes: "",
            error: "Entidad no encontrada en QBO",
          });
          continue;
        }

        const qboTotal = round2(entity.TotalAmt ?? 0);
        const qboTax = round2(entity.TxnTaxDetail?.TotalTax ?? 0);
        const qboMode = entity.GlobalTaxCalculation || "NotApplicable";

        // Detect issues
        const totalMismatch = Math.abs(qboTotal - xmlTotal) > 1.0;
        // If org expects IVA at expense, then QBO should not have tax separated
        const taxSeparated = ivaAsExpense && (qboTax > 0.5 || qboMode === "TaxExcluded");

        let status: AuditRow["status"] = "ok";
        const notes: string[] = [];
        if (taxSeparated && totalMismatch) {
          status = "both";
          notes.push("IVA separado en QBO");
          notes.push(`Diferencia total: ${round2(qboTotal - xmlTotal)}`);
        } else if (taxSeparated) {
          status = "tax_separated";
          notes.push(`IVA separado (${qboTax}) — debe ir al gasto`);
        } else if (totalMismatch) {
          status = "total_mismatch";
          notes.push(`Diferencia ${round2(qboTotal - xmlTotal)} (XML ${xmlTotal} vs QBO ${qboTotal})`);
        }

        results.push({
          document_id: doc.id,
          doc_number: doc.doc_number,
          supplier_name: doc.supplier_name,
          issue_date: doc.issue_date,
          currency: doc.currency,
          xml_total: xmlTotal,
          xml_tax: xmlTax,
          qbo_total: qboTotal,
          qbo_tax: qboTax,
          qbo_mode: qboMode,
          qbo_entity_id: doc.qbo_entity_id,
          status,
          notes: notes.join(" · "),
        });
      } catch (err: any) {
        results.push({
          document_id: doc.id,
          doc_number: doc.doc_number,
          supplier_name: doc.supplier_name,
          issue_date: doc.issue_date,
          currency: doc.currency,
          xml_total: xmlTotal,
          xml_tax: xmlTax,
          qbo_total: 0,
          qbo_tax: 0,
          qbo_mode: "",
          qbo_entity_id: doc.qbo_entity_id,
          status: "error",
          notes: "",
          error: err?.message || String(err),
        });
      }
    }

    const summary = {
      total: results.length,
      ok: results.filter((r) => r.status === "ok").length,
      tax_separated: results.filter((r) => r.status === "tax_separated").length,
      total_mismatch: results.filter((r) => r.status === "total_mismatch").length,
      both: results.filter((r) => r.status === "both").length,
      error: results.filter((r) => r.status === "error").length,
      iva_as_expense: ivaAsExpense,
    };

    return new Response(
      JSON.stringify({ success: true, summary, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error?.message || String(error) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
