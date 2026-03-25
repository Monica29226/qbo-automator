import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ComparisonField {
  field: string;
  xml_value: string | number | null;
  qbo_value: string | number | null;
  match: boolean;
  severity: "ok" | "minor" | "critical";
}

interface ReconcileResult {
  document_id: string;
  doc_number: string;
  supplier_name: string;
  issue_date: string;
  currency: string;
  status: "match" | "minor" | "critical" | "error";
  fields: ComparisonField[];
  error?: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function compareNumeric(
  field: string,
  xmlVal: number | null,
  qboVal: number | null,
  tolerance = 1.0
): ComparisonField {
  const x = round2(xmlVal ?? 0);
  const q = round2(qboVal ?? 0);
  const diff = Math.abs(x - q);
  return {
    field,
    xml_value: x,
    qbo_value: q,
    match: diff < 0.01,
    severity: diff < 0.01 ? "ok" : diff <= tolerance ? "minor" : "critical",
  };
}

function compareString(
  field: string,
  xmlVal: string | null,
  qboVal: string | null
): ComparisonField {
  const x = (xmlVal ?? "").trim();
  const q = (qboVal ?? "").trim();
  return {
    field,
    xml_value: x || null,
    qbo_value: q || null,
    match: x === q,
    severity: x === q ? "ok" : "critical",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => null);
    const { organization_id, document_ids, date_from, date_to, limit: maxDocs } = body ?? {};

    if (!organization_id) {
      return new Response(
        JSON.stringify({ success: false, error: "organization_id requerido" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Get QBO credentials
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
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const credentials = qboAccount.credentials as any;
    const accessToken = credentials.access_token;
    const realmId = credentials.realm_id;

    // Build query for published documents with qbo_entity_id
    let query = supabase
      .from("processed_documents")
      .select("id, doc_number, supplier_name, issue_date, currency, total_amount, total_tax, total_discount, xml_data, qbo_entity_id, qbo_entity_type, default_account_ref")
      .eq("organization_id", organization_id)
      .eq("status", "published")
      .not("qbo_entity_id", "is", null);

    if (document_ids?.length) {
      query = query.in("id", document_ids);
    } else {
      if (date_from) query = query.gte("issue_date", date_from);
      if (date_to) query = query.lte("issue_date", date_to);
      query = query.order("issue_date", { ascending: false }).limit(maxDocs || 50);
    }

    const { data: docs, error: docsErr } = await query;
    if (docsErr) throw docsErr;

    const results: ReconcileResult[] = [];

    for (const doc of docs ?? []) {
      await sleep(200); // Rate limit QBO API

      try {
        const entityType = (doc.qbo_entity_type || "bill").toLowerCase();
        const endpoint = entityType === "vendorcredit" ? "vendorcredit" : "bill";
        const url = `https://quickbooks.api.intuit.com/v3/company/${realmId}/${endpoint}/${doc.qbo_entity_id}?minorversion=65`;

        const resp = await fetch(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        });

        if (!resp.ok) {
          const errText = await resp.text();
          results.push({
            document_id: doc.id,
            doc_number: doc.doc_number,
            supplier_name: doc.supplier_name,
            issue_date: doc.issue_date,
            currency: doc.currency,
            status: "error",
            fields: [],
            error: `QBO API ${resp.status}: ${errText.substring(0, 200)}`,
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
            status: "error",
            fields: [],
            error: "Entidad no encontrada en respuesta QBO",
          });
          continue;
        }

        // Extract XML values
        const xmlTotal = doc.total_amount;
        const xmlTax = doc.total_tax ?? 0;
        const xmlData = doc.xml_data as any;
        const xmlSubtotal = xmlTotal - xmlTax;

        // Extract QBO values
        const qboTotal = entity.TotalAmt ?? 0;
        const qboTax = entity.TxnTaxDetail?.TotalTax ?? 0;
        const qboGlobalTaxCalc = entity.GlobalTaxCalculation || "NotApplicable";
        const qboDate = entity.TxnDate || "";
        const qboCurrency = entity.CurrencyRef?.value || "CRC";

        // Count QBO expense lines (exclude sub-total lines)
        const qboLines = (entity.Line || []).filter(
          (l: any) => l.DetailType === "AccountBasedExpenseLineDetail" || l.DetailType === "ItemBasedExpenseLineDetail"
        );
        const qboLineSum = round2(qboLines.reduce((s: number, l: any) => s + (l.Amount || 0), 0));

        // Count XML detail lines
        const xmlDetalle = xmlData?.detalle || xmlData?.DetalleServicio?.LineaDetalle || [];
        const xmlLineCount = Array.isArray(xmlDetalle) ? xmlDetalle.length : 0;

        // Build comparisons
        const fields: ComparisonField[] = [];

        // Total
        fields.push(compareNumeric("Total", xmlTotal, qboTotal, 1.0));

        // Tax
        fields.push(compareNumeric("Impuesto", xmlTax, qboTax, 1.0));

        // Subtotal (QBO line sum vs XML subtotal)
        if (qboGlobalTaxCalc === "TaxExcluded") {
          fields.push(compareNumeric("Subtotal (líneas)", xmlSubtotal, qboLineSum, 1.0));
        } else if (qboGlobalTaxCalc === "TaxInclusive") {
          // In TaxInclusive, line amounts include tax
          fields.push(compareNumeric("Total líneas (incl.)", xmlTotal, qboLineSum, 1.0));
        } else {
          fields.push(compareNumeric("Líneas QBO", xmlTotal, qboLineSum, 1.0));
        }

        // Tax mode check - if XML has tax > 0, mode should NOT be NotApplicable
        const taxModeOk = xmlTax <= 0 || qboGlobalTaxCalc !== "NotApplicable";
        fields.push({
          field: "Modo Impuesto",
          xml_value: xmlTax > 0 ? "Con impuesto" : "Sin impuesto",
          qbo_value: qboGlobalTaxCalc,
          match: taxModeOk,
          severity: taxModeOk ? "ok" : "critical",
        });

        // Date
        fields.push(compareString("Fecha", doc.issue_date, qboDate));

        // Currency
        const xmlCurrency = doc.currency === "CRC" ? "CRC" : doc.currency;
        fields.push(compareString("Moneda", xmlCurrency, qboCurrency));

        // Line count
        if (xmlLineCount > 0) {
          fields.push({
            field: "Líneas",
            xml_value: xmlLineCount,
            qbo_value: qboLines.length,
            match: xmlLineCount === qboLines.length,
            severity: xmlLineCount === qboLines.length ? "ok" : "minor",
          });
        }

        // Determine overall status
        const hasCritical = fields.some((f) => f.severity === "critical");
        const hasMinor = fields.some((f) => f.severity === "minor");
        const status = hasCritical ? "critical" : hasMinor ? "minor" : "match";

        results.push({
          document_id: doc.id,
          doc_number: doc.doc_number,
          supplier_name: doc.supplier_name,
          issue_date: doc.issue_date,
          currency: doc.currency,
          status,
          fields,
        });
      } catch (err) {
        results.push({
          document_id: doc.id,
          doc_number: doc.doc_number,
          supplier_name: doc.supplier_name,
          issue_date: doc.issue_date,
          currency: doc.currency,
          status: "error",
          fields: [],
          error: err.message,
        });
      }
    }

    const summary = {
      total: results.length,
      match: results.filter((r) => r.status === "match").length,
      minor: results.filter((r) => r.status === "minor").length,
      critical: results.filter((r) => r.status === "critical").length,
      error: results.filter((r) => r.status === "error").length,
    };

    return new Response(
      JSON.stringify({ success: true, summary, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
