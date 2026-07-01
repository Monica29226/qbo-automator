import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const QBO_BASE = "https://quickbooks.api.intuit.com/v3/company";
const MV = "minorversion=65";

async function qboGet(base: string, token: string, query: string) {
  const url = `${base}/query?query=${encodeURIComponent(query)}&${MV}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`QBO query fail ${r.status}: ${await r.text()}`);
  return r.json();
}
async function qboPost(base: string, token: string, entity: string, body: any) {
  const r = await fetch(`${base}/${entity}?${MV}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`QBO ${entity} error ${r.status}: ${await r.text()}`);
  return r.json();
}

// Build tarifa (percent number) -> TaxCode Id map from QBO active tax codes.
async function loadSalesTaxCodeMap(base: string, token: string): Promise<Record<number, string>> {
  const data = await qboGet(base, token, "SELECT * FROM TaxCode WHERE Active=true MAXRESULTS 200");
  const codes: any[] = data.QueryResponse?.TaxCode || [];
  const map: Record<number, string> = {};
  for (const tc of codes) {
    const sales = tc.SalesTaxRateList?.TaxRateDetail || [];
    if (!sales.length) continue; // must have a sales rate
    // Prefer names that look like "IVA X%" with a Ventas rate
    const m = /(\d+(?:\.\d+)?)\s*%/.exec(tc.Name || "");
    if (m) {
      const rate = parseFloat(m[1]);
      // Only overwrite if the sales rate name suggests Ventas / Sale
      const salesName = (sales[0].TaxRateRef?.name || "").toLowerCase();
      const isSales = salesName.includes("venta") || salesName.includes("sale") || salesName.includes("iva");
      if (!(rate in map) || isSales) map[rate] = tc.Id;
    }
  }
  // Also detect a plain "No VAT" as exempt fallback
  if (!(0 in map)) {
    const noVat = codes.find((c) => /no\s*vat|exempt/i.test(c.Name || "") && (c.SalesTaxRateList?.TaxRateDetail?.length));
    if (noVat) map[0] = noVat.Id;
  }
  return map;
}

// Find or create a Service Item that posts to the requested income account.
async function ensureServiceItem(base: string, token: string, incomeAccountRef: string): Promise<{ id: string; name: string }> {
  const q = `SELECT Id,Name,IncomeAccountRef FROM Item WHERE Type='Service' MAXRESULTS 500`;
  const data = await qboGet(base, token, q);
  const items: any[] = data.QueryResponse?.Item || [];
  const match = items.find((i) => i.IncomeAccountRef?.value === String(incomeAccountRef));
  if (match) return { id: match.Id, name: match.Name };

  // Fetch account name to build a sensible item name
  let itemName = `Ingreso ${incomeAccountRef}`;
  try {
    const acc = await qboGet(base, token, `SELECT Id,Name FROM Account WHERE Id='${incomeAccountRef}'`);
    const a = acc.QueryResponse?.Account?.[0];
    if (a?.Name) itemName = a.Name;
  } catch (_) { /* ignore */ }

  const created = await qboPost(base, token, "item", {
    Name: itemName.slice(0, 100),
    Type: "Service",
    IncomeAccountRef: { value: String(incomeAccountRef) },
    Taxable: true,
  });
  return { id: created.Item.Id, name: created.Item.Name };
}

async function findOrCreateCustomer(base: string, token: string, name: string, email: string | null, taxId: string | null): Promise<string> {
  const safe = (name || "Cliente de Contado").replace(/'/g, "\\'").slice(0, 100);
  const search = await qboGet(base, token, `SELECT * FROM Customer WHERE DisplayName='${safe}'`);
  const existing = search.QueryResponse?.Customer?.[0];
  if (existing) return existing.Id;
  const created = await qboPost(base, token, "customer", {
    DisplayName: safe,
    CompanyName: safe,
    PrimaryEmailAddr: email ? { Address: email } : undefined,
    Notes: taxId ? `Tax ID: ${taxId}` : undefined,
  });
  return created.Customer.Id;
}

function isGenericCustomer(name: string | null): boolean {
  if (!name) return true;
  const n = name.trim().toLowerCase();
  return n === "" || n === "sin nombre" || n === "contado" || n === "cliente de contado" || n === "consumidor final";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { organization_id, invoice_ids } = await req.json();
    console.log("📤 Publish sales:", { organization_id, count: invoice_ids?.length });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: qb, error: qbErr } = await supabase
      .from("integration_accounts")
      .select("credentials")
      .eq("organization_id", organization_id)
      .eq("service_type", "quickbooks")
      .eq("is_active", true)
      .single();
    if (qbErr || !qb) throw new Error("QuickBooks not connected");
    const { access_token, realm_id } = qb.credentials as any;
    const base = `${QBO_BASE}/${realm_id}`;

    const { data: invoices, error: invErr } = await supabase
      .from("sales_invoices")
      .select("*")
      .eq("organization_id", organization_id)
      .in("id", invoice_ids || []);
    if (invErr) throw invErr;

    // Discover tax map ONCE for the batch
    const taxMap = await loadSalesTaxCodeMap(base, access_token);
    console.log("🧾 Tax map:", taxMap);

    // Item cache per default_income_account_ref
    const itemCache = new Map<string, { id: string; name: string }>();

    let published = 0;
    let failed = 0;
    const errors: any[] = [];

    for (const invoice of invoices || []) {
      try {
        const docType = (invoice.doc_type || "FE").toUpperCase();
        const xmlData = (invoice.xml_data as any) || {};
        const detalles: any[] = Array.isArray(xmlData.detalles) ? xmlData.detalles : [];
        const infoRef = xmlData.info_referencia || null;

        const incomeAccount = invoice.default_income_account_ref;
        if (!incomeAccount) throw new Error("Sin cuenta de ingreso asignada");

        // Ensure item
        let item = itemCache.get(String(incomeAccount));
        if (!item) {
          item = await ensureServiceItem(base, access_token, String(incomeAccount));
          itemCache.set(String(incomeAccount), item);
        }

        // Determine customer
        const useContado = docType === "TE" || isGenericCustomer(invoice.customer_name);
        const custName = useContado ? "Cliente de Contado" : invoice.customer_name;
        const customerId = await findOrCreateCustomer(
          base, access_token, custName,
          useContado ? null : invoice.customer_email,
          useContado ? null : invoice.customer_tax_id,
        );

        // Build lines. NC uses positive amounts (QBO handles CM sign).
        const absAmt = (v: number) => Math.abs(Number(v) || 0);
        const missingRates: number[] = [];

        const buildLine = (detalle: string, amount: number, qty: number, unitPrice: number, tarifa: number) => {
          let taxCodeRef: { value: string } | undefined = undefined;
          if (tarifa > 0) {
            const id = taxMap[tarifa];
            if (!id) {
              missingRates.push(tarifa);
              return null;
            }
            taxCodeRef = { value: id };
          } else if (taxMap[0]) {
            taxCodeRef = { value: taxMap[0] };
          }
          return {
            DetailType: "SalesItemLineDetail",
            Amount: Number(absAmt(amount).toFixed(2)),
            Description: (detalle || item!.name).slice(0, 4000),
            SalesItemLineDetail: {
              ItemRef: { value: item!.id, name: item!.name },
              Qty: qty || 1,
              UnitPrice: Number(absAmt(unitPrice).toFixed(4)),
              TaxCodeRef: taxCodeRef,
            },
          };
        };

        let lines: any[] = [];
        if (detalles.length > 0) {
          for (const d of detalles) {
            const l = buildLine(
              d.detalle,
              d.montoNeto,
              d.cantidad || 1,
              d.precioUnitario || d.montoNeto,
              Number(d.tarifa) || 0,
            );
            if (l) lines.push(l);
          }
        } else {
          // No parsed XML — synthesize one line. Infer tarifa from total_tax / subtotal.
          const sub = absAmt(invoice.subtotal || invoice.total_amount);
          const tax = absAmt(invoice.total_tax);
          let tarifa = 0;
          if (sub > 0 && tax > 0) {
            const pct = (tax / sub) * 100;
            const candidates = Object.keys(taxMap).map(Number).filter((n) => n > 0);
            tarifa = candidates.reduce((best, cur) => Math.abs(cur - pct) < Math.abs(best - pct) ? cur : best, candidates[0] || 0);
            if (Math.abs(tarifa - pct) > 0.5) tarifa = 0; // don't guess if far off
          }
          const l = buildLine("Ingreso", sub, 1, sub, tarifa);
          if (l) lines.push(l);
        }

        if (missingRates.length > 0 || lines.length === 0) {
          const msg = missingRates.length
            ? `Falta código de IVA ${[...new Set(missingRates)].join("%, ")}% en QuickBooks`
            : "No se pudieron construir líneas para publicar";
          await supabase.from("sales_invoices").update({
            status: "review",
            error_message: msg,
          }).eq("id", invoice.id);
          failed++;
          errors.push({ invoice_id: invoice.id, doc_number: invoice.doc_number, error: msg });
          continue;
        }

        const privateNoteParts = [`Clave: ${invoice.doc_key}`, `Fuente: ${xmlData.source || "manual"}`];
        if (docType === "NC" && infoRef?.numero) privateNoteParts.push(`Ref factura: ${infoRef.numero}`);
        if (infoRef?.razon) privateNoteParts.push(`Razón: ${infoRef.razon}`);

        const payload: any = {
          CustomerRef: { value: customerId },
          Line: lines,
          TxnDate: invoice.issue_date,
          DocNumber: (invoice.doc_number || "").slice(0, 21),
          PrivateNote: privateNoteParts.join(" | "),
          GlobalTaxCalculation: "TaxExcluded",
          CurrencyRef: invoice.currency && invoice.currency !== "CRC"
            ? { value: invoice.currency, name: invoice.currency }
            : undefined,
          ExchangeRate: invoice.exchange_rate && invoice.currency !== "CRC" ? invoice.exchange_rate : undefined,
          ClassRef: invoice.default_class_ref ? { value: invoice.default_class_ref } : undefined,
        };
        if (docType !== "NC" && invoice.payment_terms_ref) {
          payload.SalesTermRef = { value: invoice.payment_terms_ref };
        }

        const entity = docType === "NC" ? "creditmemo" : "invoice";
        const entityType = docType === "NC" ? "CreditMemo" : "Invoice";
        console.log(`📤 Creating ${entityType} for ${invoice.doc_number} (${lines.length} líneas)`);

        const created = await qboPost(base, access_token, entity, payload);
        const qbId = created[entityType].Id;
        console.log(`✅ ${entityType} ${qbId} creado`);

        await supabase.from("sales_invoices").update({
          qbo_entity_id: qbId,
          qbo_entity_type: entityType,
          qbo_customer_ref: customerId,
          status: "published",
          error_message: null,
          processed_at: new Date().toISOString(),
        }).eq("id", invoice.id);

        published++;

        if (docType !== "NC" && invoice.customer_email) {
          try {
            await supabase.functions.invoke("send-invoice-email", {
              body: {
                invoice_id: invoice.id,
                organization_id,
                to_email: invoice.customer_email,
                include_pdf: !!invoice.pdf_attachment_url,
                invoice_type: "sales",
              },
            });
          } catch (e: any) {
            console.warn("email fail:", e.message);
          }
        }

        await delay(1200);
      } catch (e: any) {
        console.error(`❌ ${invoice.doc_number}:`, e.message);
        failed++;
        errors.push({ invoice_id: invoice.id, doc_number: invoice.doc_number, error: e.message });
        await supabase.from("sales_invoices").update({
          status: "error",
          error_message: e.message,
          retry_count: (invoice.retry_count || 0) + 1,
        }).eq("id", invoice.id);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      published,
      failed,
      tax_map: taxMap,
      errors: errors.length ? errors : undefined,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("publish-sales error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
