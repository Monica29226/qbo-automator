import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// CR standard IVA rates we look for in QBO TaxRates
const REQUIRED_RATES = [
  { key: "iva_13", label: "IVA 13%", percent: 13, required: true, regex: /\b(13)\s*%|tarifa\s*general|iva\s*(general|13)/i },
  { key: "iva_0", label: "IVA 0% / Exento", percent: 0, required: true, regex: /\b0\s*%|exento|exent[ao]|tarifa\s*0/i },
  { key: "iva_8", label: "IVA 8%", percent: 8, required: false, regex: /\b8\s*%|tarifa\s*reducida\s*8/i },
  { key: "iva_4", label: "IVA 4%", percent: 4, required: false, regex: /\b4\s*%|tarifa\s*reducida\s*4|m[eé]dic|educac/i },
  { key: "iva_2", label: "IVA 2%", percent: 2, required: false, regex: /\b2\s*%|medicamento/i },
  { key: "iva_1", label: "IVA 1%", percent: 1, required: false, regex: /\b1\s*%|canasta/i },
];

async function refreshIfNeeded(supabase: any, integration: any, organization_id: string) {
  const credentials = integration.credentials;
  let accessToken = credentials.access_token;
  const realmId = credentials.realm_id;
  if (credentials.expires_at && new Date(credentials.expires_at) <= new Date()) {
    const tokenResponse = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${Deno.env.get("QBO_CLIENT_ID")}:${Deno.env.get("QBO_CLIENT_SECRET")}`)}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: credentials.refresh_token,
      }),
    });
    if (!tokenResponse.ok) throw new Error("Failed to refresh QuickBooks token");
    const newTokens = await tokenResponse.json();
    accessToken = newTokens.access_token;
    const expiresAt = new Date(Date.now() + newTokens.expires_in * 1000).toISOString();
    await supabase
      .from("integration_accounts")
      .update({
        credentials: {
          ...credentials,
          access_token: newTokens.access_token,
          refresh_token: newTokens.refresh_token,
          expires_at: expiresAt,
        },
      })
      .eq("organization_id", organization_id)
      .eq("service_type", "quickbooks");
  }
  return { accessToken, realmId };
}

async function qboQuery(accessToken: string, realmId: string, query: string) {
  const url = `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=70`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`QBO query failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) throw new Error("Unauthorized");

    const { organization_id } = await req.json();
    if (!organization_id) throw new Error("organization_id is required");

    const { data: integration } = await supabase
      .from("integration_accounts")
      .select("credentials")
      .eq("organization_id", organization_id)
      .eq("service_type", "quickbooks")
      .eq("is_active", true)
      .maybeSingle();
    if (!integration) {
      return new Response(JSON.stringify({ success: false, connected: false, error: "QuickBooks not connected" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { accessToken, realmId } = await refreshIfNeeded(supabase, integration, organization_id);

    // CompanyInfo
    const ciRes = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${realmId}/companyinfo/${realmId}?minorversion=70`,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
    );
    const ciJson = await ciRes.json();
    const ci = ciJson?.CompanyInfo ?? {};

    // Preferences (multi-currency)
    const prefRes = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${realmId}/preferences?minorversion=70`,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
    );
    const prefJson = await prefRes.json();
    const multiCurrencyEnabled = !!prefJson?.Preferences?.CurrencyPrefs?.MultiCurrencyEnabled;
    const homeCurrency = prefJson?.Preferences?.CurrencyPrefs?.HomeCurrency || ci?.Country || "CRC";

    // Tax rates
    const taxRatesJson = await qboQuery(accessToken, realmId, "SELECT Id, Name, RateValue, Active FROM TaxRate MAXRESULTS 1000");
    const taxRates: Array<{ Id: string; Name: string; RateValue: number; Active?: boolean }> =
      taxRatesJson?.QueryResponse?.TaxRate ?? [];

    const taxChecklist = REQUIRED_RATES.map((r) => {
      const match = taxRates.find((t) => {
        if (t.Active === false) return false;
        const nameOk = r.regex.test(t.Name || "");
        const rateOk = typeof t.RateValue === "number" ? Math.abs(t.RateValue - r.percent) < 0.01 : false;
        return nameOk || rateOk;
      });
      return {
        key: r.key,
        label: r.label,
        required: r.required,
        found: !!match,
        qboId: match?.Id ?? null,
        qboName: match?.Name ?? null,
      };
    });

    // Expense accounts
    const accJson = await qboQuery(
      accessToken,
      realmId,
      "SELECT Id, Name, AccountType, Active FROM Account WHERE AccountType IN ('Expense','Cost of Goods Sold','Other Expense') MAXRESULTS 1000",
    );
    const allAccounts = (accJson?.QueryResponse?.Account ?? []).filter((a: any) => a.Active !== false);
    const expenseAccounts = allAccounts.map((a: any) => ({ id: a.Id, name: a.Name, type: a.AccountType }));

    const suggestedDefault = expenseAccounts.find((a: any) =>
      /por\s*clasificar|sin\s*clasificar|suspense|por\s*aplicar|unclassified/i.test(a.name),
    ) || expenseAccounts[0] || null;

    const missingRequired = taxChecklist.filter((t) => t.required && !t.found).map((t) => t.label);
    const canProceed = missingRequired.length === 0;

    return new Response(
      JSON.stringify({
        success: true,
        connected: true,
        companyInfo: {
          companyName: ci?.CompanyName ?? null,
          country: ci?.Country ?? null,
          legalName: ci?.LegalName ?? null,
        },
        currency: {
          homeCurrency,
          multiCurrencyEnabled,
        },
        taxChecklist,
        missingRequired,
        canProceed,
        accounts: {
          total: expenseAccounts.length,
          suggestedDefault,
          list: expenseAccounts,
          warningFew: expenseAccounts.length < 10,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("verify-qbo-readiness error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
