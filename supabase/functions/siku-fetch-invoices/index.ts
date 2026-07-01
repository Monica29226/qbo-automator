import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const AUTH_URL = "https://auth.sikuapps.com/api/token";
const API_BASE = "https://portalapi.sikumedico.com/api";

async function getSikuToken(creds: any): Promise<string | null> {
  // Si hay un access_token guardado (capturado del portal), usarlo directamente
  if (creds.access_token) {
    return creds.access_token;
  }
  // Try client_credentials first
  if (creds.client_id && creds.client_secret) {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: creds.client_id,
      client_secret: creds.client_secret,
    });
    const r = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (r.ok) {
      const data = await r.json();
      console.log("Siku auth OK (client_credentials)");
      return data.access_token;
    }
    const err = await r.text().catch(() => "");
    console.warn("client_credentials failed:", err.substring(0, 200));
  }
  // Fallback: password grant
  if (creds.username && creds.password) {
    const clientIds = [creds.client_id, "sikumed-public-api", "web", "siku-web", "portal", "angular", "siku", "siku.portal"].filter(Boolean);
    const seen = new Set<string>();
    for (const clientId of clientIds) {
      if (seen.has(clientId)) continue;
      seen.add(clientId);
      const params: Record<string, string> = {
        grant_type: "password",
        username: creds.username,
        password: creds.password,
        client_id: clientId,
        scope: "openid profile offline_access",
      };
      if (creds.client_secret) params.client_secret = creds.client_secret;
      const r = await fetch(AUTH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params).toString(),
      });
      if (r.ok) {
        const data = await r.json();
        console.log("Siku auth OK (password, client_id=" + clientId + ")");
        return data.access_token;
      }
      const err = await r.text().catch(() => "");
      console.warn("password grant failed (client_id=" + clientId + "): " + err.substring(0, 200));
    }
  }
  return null;
}

async function getXmlTax(guid: string, token: string, extraHeaders: Record<string, string>): Promise<{ tax: number; net: number } | null> {
  try {
    const headers: Record<string, string> = {
      Authorization: "Bearer " + token,
      Accept: "application/xml, text/xml, */*",
      ...extraHeaders,
    };
    const r = await fetch(API_BASE + "/fact/DOC/xml?guid=" + guid, { headers });
    if (!r.ok) return null;
    const xml = await r.text();
    if (!xml || xml.indexOf("<") === -1) return null;
    const getTag = (tag: string): number => {
      const idx = xml.indexOf("<" + tag);
      if (idx === -1) return 0;
      const start = xml.indexOf(">", idx) + 1;
      const end = xml.indexOf("</" + tag, start);
      if (start <= 0 || end <= start) return 0;
      return parseFloat(xml.substring(start, end)) || 0;
    };
    const tax = getTag("TotalImpuesto") || getTag("TotalImpuestoNeto");
    const net = getTag("TotalVentaNeta") || getTag("TotalVenta");
    return { tax, net };
  } catch (_) {
    return null;
  }
}

function todayISO(offset = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const { organization_id, fecha_inicio, fecha_fin } = body;

    if (!organization_id) {
      return new Response(
        JSON.stringify({ success: false, error: "organization_id requerido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const fi = fecha_inicio || todayISO(-30);
    const ff = fecha_fin || todayISO(0);

    const { data: integ } = await supabase
      .from("integration_accounts")
      .select("id, credentials")
      .eq("organization_id", organization_id)
      .eq("service_type", "siku")
      .eq("is_active", true)
      .maybeSingle();

    if (!integ?.credentials) {
      return new Response(
        JSON.stringify({ success: false, error: "Integración Siku no configurada", code: "no_credentials" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const creds = integ.credentials as any;
    const companyGuid = creds.company_guid;
    if (!companyGuid) {
      return new Response(
        JSON.stringify({ success: false, error: "company_guid no configurado", code: "no_company_guid" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const accessToken = await getSikuToken(creds);
    if (!accessToken) {
      return new Response(
        JSON.stringify({ success: false, error: "No se pudo autenticar con Siku. Verifique credenciales.", code: "auth_failed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const ocpKey: string | null = creds.ocp_apim_key || null;
    const orgDefaultAccount = creds.default_income_account_ref || null;
    const currencyMap: Record<string, string> = { "¢": "CRC", "$": "USD", "€": "EUR" };

    const extraHeaders: Record<string, string> = {};
    if (creds.x_sid) extraHeaders["x-SID"] = creds.x_sid;
    if (creds.x_idsesion) extraHeaders["x-IDSesion"] = creds.x_idsesion;
    if (ocpKey) extraHeaders["Ocp-Apim-Subscription-Key"] = ocpKey;

    const url = API_BASE + "/fact/DOC/buscar?id=-1&idc=" + companyGuid + "&ids=-1&es=-1&fi=" + fi + "&ff=" + ff + "&u=&esce=-1";
    console.log("Fetching:", url);

    const apiHeaders: Record<string, string> = {
      Authorization: "Bearer " + accessToken,
      Accept: "application/json",
      ...extraHeaders,
    };

    const apiResp = await fetch(url, { headers: apiHeaders });
    if (!apiResp.ok) {
      const errBody = await apiResp.text();
      if (apiResp.status === 401) {
        return new Response(
          JSON.stringify({ success: false, error: "Token inválido o vencido. Recapture el token desde el portal Siku.", code: "token_expired" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw new Error("Siku API error " + apiResp.status + ": " + errBody.substring(0, 200));
    }

    const apiData = await apiResp.json();
    const lista: any[] = Array.isArray(apiData)
      ? apiData
      : (apiData?.Lista ?? apiData?.ListaDocumentos ?? apiData?.documentos ?? []);
    const fetched = lista.length;
    console.log("Got " + fetched + " documents");

    const docKeys = lista.map((d: any) => d.DocumentoGuid).filter(Boolean);
    const { data: existing } = await supabase
      .from("sales_invoices")
      .select("doc_key")
      .eq("organization_id", organization_id)
      .in("doc_key", docKeys.length > 0 ? docKeys : ["__none__"]);
    const existingSet = new Set((existing || []).map((e: any) => e.doc_key));

    const customerNames = [...new Set(lista.map((d: any) => d.Nombre).filter(Boolean))] as string[];
    const { data: defs } = await supabase
      .from("customer_defaults")
      .select("customer_name, default_income_account_ref, default_class_ref, payment_terms_ref")
      .eq("organization_id", organization_id)
      .in("customer_name", customerNames.length > 0 ? customerNames : ["__none__"]);
    const defMap = new Map((defs || []).map((d: any) => [d.customer_name, d]));

    const newDocs = lista.filter((d: any) => d.DocumentoGuid && !existingSet.has(d.DocumentoGuid));
    const toInsert: any[] = [];

    for (const d of newDocs) {
      const def = defMap.get(d.Nombre);
      const currency = currencyMap[d.MonedaSimbolo] || "CRC";
      const incomeAccount = (def?.default_income_account_ref) || orgDefaultAccount;
      const montoTotal = Number(d.MontoTotal) || 0;

      const xmlData = d.DocumentoGuid
        ? await getXmlTax(d.DocumentoGuid, accessToken, ocpKey)
        : null;

      const totalTax = xmlData ? xmlData.tax : 0;
      const subtotal = xmlData
        ? (xmlData.net || montoTotal - totalTax)
        : montoTotal;

      toInsert.push({
        organization_id,
        doc_key: d.DocumentoGuid,
        doc_number: d.NumeroConsecutivo || String(d.IDDocumento),
        doc_type: d.TipoDocumento === "Nota de crédito electrónica" ? "NC" : "FE",
        issue_date: d.FechaDocumento ? d.FechaDocumento.split("T")[0] : todayISO(0),
        customer_name: d.Nombre || "Sin nombre",
        customer_tax_id: null,
        customer_email: null,
        currency,
        exchange_rate: 1,
        subtotal,
        total_tax: totalTax,
        total_discount: 0,
        total_amount: montoTotal,
        xml_attachment_url: null,
        pdf_attachment_url: null,
        xml_data: {
          siku_id: d.IDDocumento,
          siku_guid: d.DocumentoGuid,
          estado_pago: d.EstadoPago,
          tipo_documento: d.TipoDocumento,
          source: "siku",
          xml_parsed: xmlData !== null,
        },
        status: incomeAccount ? "pending" : "pending_config",
        default_income_account_ref: incomeAccount,
        default_class_ref: def?.default_class_ref || null,
        payment_terms_ref: def?.payment_terms_ref || null,
      });
    }

    let inserted = 0;
    let errors = 0;
    if (toInsert.length > 0) {
      const { error: insErr } = await supabase.from("sales_invoices").insert(toInsert);
      if (insErr) {
        console.error("Insert error:", insErr);
        errors = toInsert.length;
      } else {
        inserted = toInsert.length;
      }
    }

    const skipped = Math.max(0, fetched - toInsert.length - errors);

    return new Response(
      JSON.stringify({
        success: true,
        fetched,
        inserted,
        skipped,
        errors,
        total_period: apiData.TotalCantidadDocumentos,
        monto_total: apiData.MontoTotal,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("siku-fetch-invoices error:", e);
    return new Response(
      JSON.stringify({ success: false, error: "Error interno: " + e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
