import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const AUTH_URL = "https://auth.sikuapps.com/api/token";
const API_BASE = "https://portalapi.sikumedico.com/api";
const FALLBACK_PASSWORD_CLIENT_IDS = ["web", "siku-web", "portal", "angular", "siku", "siku.portal"];

async function getSikuTokenClientCredentials(clientId: string, clientSecret: string): Promise<{ access_token: string; refresh_token?: string } | null> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  const r = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (r.ok) {
    const data = await r.json();
    console.log(`✅ Siku auth OK (client_credentials, client_id=${clientId})`);
    return { access_token: data.access_token, refresh_token: data.refresh_token };
  }
  const err = await r.text().catch(() => "");
  console.warn(`Siku client_credentials failed (client_id=${clientId}):`, err.substring(0, 300));
  return null;
}

async function getSikuTokenPassword(username: string, password: string): Promise<{ access_token: string; refresh_token: string } | null> {
  for (const clientId of FALLBACK_PASSWORD_CLIENT_IDS) {
    const body = new URLSearchParams({
      grant_type: "password",
      username,
      password,
      client_id: clientId,
    });
    const r = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (r.ok) {
      const data = await r.json();
      console.log(`✅ Siku auth OK (password, client_id=${clientId})`);
      return { access_token: data.access_token, refresh_token: data.refresh_token };
    }
    const err = await r.json().catch(() => ({}));
    if (err.error === "invalid_clientId") continue;
    console.warn(`Siku password auth failed with client_id=${clientId}:`, err);
  }
  return null;
}

async function refreshSikuToken(refreshToken: string, clientId: string, clientSecret?: string): Promise<string | null> {
  const params: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  };
  if (clientSecret) params.client_secret = clientSecret;
  const r = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  if (r.ok) {
    const data = await r.json();
    return data.access_token;
  }
  return null;
}

function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function getSikuInvoiceXML(
  guid: string,
  accessToken: string,
  ocpKey: string | null,
): Promise<{ totalImpuesto: number; totalVentaNeta: number } | null> {
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/xml, text/xml, */*",
    };
    if (ocpKey) headers["Ocp-Apim-Subscription-Key"] = ocpKey;
    const r = await fetch(`${API_BASE}/fact/DOC/xml?guid=${guid}`, { headers });
    if (!r.ok) return null;
    const xml = await r.text();
    if (!xml || !xml.includes("<")) return null;
    const extractTag = (tag: string): number => {
      const m = xml.match(new RegExp(`<${tag}[^>]*>([\\d.]+)<\\/${tag}>`, "i"));
      return m ? parseFloat(m[1]) : 0;
    };
    const totalImpuesto = extractTag("TotalImpuesto") || extractTag("TotalImpuestoNeto");
    const totalVentaNeta = extractTag("TotalVentaNeta") || extractTag("TotalVenta");
    return { totalImpuesto, totalVentaNeta };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const { organization_id, fecha_inicio, fecha_fin } = body;
    const fi = fecha_inicio || todayISO(-30);
    const ff = fecha_fin || todayISO(0);

    if (!organization_id) {
      return new Response(JSON.stringify({ success: false, error: "organization_id requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: integ } = await supabase
      .from("integration_accounts")
      .select("id, credentials")
      .eq("organization_id", organization_id)
      .eq("service_type", "siku")
      .eq("is_active", true)
      .maybeSingle();

    if (!integ?.credentials) {
      return new Response(JSON.stringify({ success: false, error: "API key no configurada", code: "no_credentials" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const creds = integ.credentials as any;
    const companyGuid = creds.company_guid;
    if (!companyGuid) {
      return new Response(JSON.stringify({ success: false, error: "company_guid no configurado", code: "no_company_guid" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let accessToken: string | null = null;
    const ccClientId = creds.client_id || "sikumed-public-api";
    const ccClientSecret = creds.client_secret;
    const ocpKey = creds.ocp_apim_key;

    if (creds.refresh_token) {
      accessToken = await refreshSikuToken(creds.refresh_token, ccClientId, ccClientSecret);
    }
    if (!accessToken && ccClientSecret) {
      const tokens = await getSikuTokenClientCredentials(ccClientId, ccClientSecret);
      if (tokens) {
        accessToken = tokens.access_token;
        await supabase.from("integration_accounts").update({
          credentials: { ...creds, access_token: tokens.access_token, ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}) }
        }).eq("id", integ.id);
      }
    }
    if (!accessToken && creds.username && creds.password) {
      const tokens = await getSikuTokenPassword(creds.username, creds.password);
      if (tokens) {
        accessToken = tokens.access_token;
        await supabase.from("integration_accounts").update({
          credentials: { ...creds, refresh_token: tokens.refresh_token, access_token: tokens.access_token }
        }).eq("id", integ.id);
      }
    }

    if (!accessToken) {
      return new Response(JSON.stringify({ success: false, error: "No se pudo autenticar con Siku. Verifique credenciales (client_id/client_secret o usuario/contraseña).", code: "auth_failed" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let fetched = 0, inserted = 0, skipped = 0, errors = 0;

    const url = `${API_BASE}/fact/DOC/buscar?id=-1&idc=${companyGuid}&ids=-1&es=-1&fi=${fi}&ff=${ff}&u=&esce=-1`;
    console.log(`Fetching: ${url}`);

    const apiHeaders: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    };
    if (ocpKey) apiHeaders["Ocp-Apim-Subscription-Key"] = ocpKey;

    const apiResp = await fetch(url, { headers: apiHeaders });

    if (!apiResp.ok) {
      const errBody = await apiResp.text();
      if (apiResp.status === 401) {
        return new Response(JSON.stringify({ success: false, error: "Token inválido o vencido. Reconecte Siku.", code: "unauthorized" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`Siku API error ${apiResp.status}: ${errBody.substring(0, 200)}`);
    }

    const apiData = await apiResp.json();
    const lista: any[] = Array.isArray(apiData)
      ? apiData
      : (apiData?.Lista ?? apiData?.ListaDocumentos ?? apiData?.documentos ?? []);
    fetched = lista.length;
    console.log(`Got ${fetched} documents (total in period: ${apiData.TotalCantidadDocumentos})`);

    const docKeys = lista.map((d: any) => d.DocumentoGuid).filter(Boolean);
    const { data: existing } = await supabase
      .from("sales_invoices")
      .select("doc_key")
      .eq("organization_id", organization_id)
      .in("doc_key", docKeys);
    const existingSet = new Set((existing || []).map((e: any) => e.doc_key));

    const customerNames = [...new Set(lista.map((d: any) => d.Nombre).filter(Boolean))];
    const { data: defs } = await supabase
      .from("customer_defaults")
      .select("customer_name, default_income_account_ref, default_class_ref, payment_terms_ref")
      .eq("organization_id", organization_id)
      .in("customer_name", customerNames);
    const defMap = new Map((defs || []).map((d: any) => [d.customer_name, d]));

    const orgDefaultAccount = creds.default_income_account_ref || null;

    const currencyMap: Record<string, string> = { "¢": "CRC", "$": "USD", "€": "EUR" };

    const toInsert = lista
      .filter((d: any) => d.DocumentoGuid && !existingSet.has(d.DocumentoGuid))
      .map((d: any) => {
        const def = defMap.get(d.Nombre);
        const currency = currencyMap[d.MonedaSimbolo] || "CRC";
        const incomeAccount = def?.default_income_account_ref || orgDefaultAccount;
        return {
          organization_id,
          doc_key: d.DocumentoGuid,
          doc_number: d.NumeroConsecutivo || String(d.IDDocumento),
          doc_type: d.TipoDocumento === "Nota de crédito electrónica" ? "NC" : "FE",
          issue_date: d.FechaDocumento?.split("T")[0] || todayISO(0),
          customer_name: d.Nombre || "Sin nombre",
          customer_tax_id: null,
          customer_email: null,
          currency,
          exchange_rate: 1,
          subtotal: d.MontoTotal || 0,
          total_tax: 0,
          total_discount: 0,
          total_amount: d.MontoTotal || 0,
          xml_attachment_url: null,
          pdf_attachment_url: null,
          xml_data: {
            siku_id: d.IDDocumento,
            siku_guid: d.DocumentoGuid,
            estado_pago: d.EstadoPago,
            tipo_documento: d.TipoDocumento,
            source: "siku",
          },
          status: incomeAccount ? "pending" : "pending_config",
          default_income_account_ref: incomeAccount,
          default_class_ref: def?.default_class_ref || null,
          payment_terms_ref: def?.payment_terms_ref || null,
        };
      });


    if (toInsert.length > 0) {
      const { error: insErr } = await supabase.from("sales_invoices").insert(toInsert);
      if (insErr) {
        console.error("Insert error:", insErr);
        errors = toInsert.length;
      } else {
        inserted = toInsert.length;
      }
    }

    skipped = fetched - toInsert.length - errors;
    if (skipped < 0) skipped = 0;

    return new Response(JSON.stringify({
      success: true,
      fetched,
      inserted,
      skipped,
      errors,
      total_period: apiData.TotalCantidadDocumentos,
      monto_total: apiData.MontoTotal,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    console.error("siku-fetch-invoices error:", e);
    return new Response(JSON.stringify({ success: false, error: "Error interno", detail: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
