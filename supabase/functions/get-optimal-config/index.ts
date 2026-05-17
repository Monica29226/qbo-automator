import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STANDARD_CR_RATES = [0, 1, 2, 4, 8, 13];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { organization_id } = await req.json();
    if (!organization_id) return json({ error: "organization_id required" }, 400);

    const { data: member } = await admin
      .from("organization_members")
      .select("id")
      .eq("user_id", user.id)
      .eq("organization_id", organization_id)
      .eq("is_active", true)
      .maybeSingle();
    if (!member) return json({ error: "Not a member of this organization" }, 403);

    // 1) Top vendor_defaults
    const { data: vendorDefaults } = await admin
      .from("vendor_defaults")
      .select("vendor_name, default_account_ref, default_uses_tax")
      .eq("organization_id", organization_id)
      .not("default_account_ref", "is", null)
      .limit(500);

    const { data: docs } = await admin
      .from("processed_documents")
      .select("vendor_id, default_account_ref, supplier_name")
      .eq("organization_id", organization_id)
      .not("qbo_entity_id", "is", null)
      .limit(5000);

    const vendorCounts = new Map<string, number>();
    const accountCounts = new Map<string, number>();
    for (const d of docs || []) {
      if (d.vendor_id) vendorCounts.set(d.vendor_id, (vendorCounts.get(d.vendor_id) || 0) + 1);
      if (d.default_account_ref) accountCounts.set(d.default_account_ref, (accountCounts.get(d.default_account_ref) || 0) + 1);
    }

    const topVendorDefaults = (vendorDefaults || [])
      .map((v: any) => ({ ...v, usage_count: 0 }))
      .slice(0, 10);

    const topAccounts = Array.from(accountCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([account_ref, count]) => ({ account_ref, count }));

    const suggested = topAccounts[0]?.account_ref ?? null;

    // 2) Tax rates configured vs missing
    const { data: qbo } = await admin
      .from("integration_accounts")
      .select("credentials")
      .eq("organization_id", organization_id)
      .eq("service_type", "quickbooks")
      .eq("is_active", true)
      .maybeSingle();

    const configuredRates: number[] = qbo?.credentials?.tax_rates_synced || [];
    const missingRates = STANDARD_CR_RATES.filter((r) => !configuredRates.includes(r));

    return json({
      organization_id,
      top_vendor_defaults: topVendorDefaults,
      top_accounts: topAccounts,
      suggested_default_account_ref: suggested,
      tax_rates: { configured: configuredRates, missing: missingRates, standard: STANDARD_CR_RATES },
      vendor_count: vendorDefaults?.length ?? 0,
      published_invoices: docs?.length ?? 0,
    });
  } catch (e: any) {
    console.error("get-optimal-config error:", e);
    return json({ error: e?.message || String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
