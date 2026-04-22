import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("🔄 Starting QBO token renewal sweep...");

    // Optional org filter (used by manual button)
    let targetOrg: string | null = null;
    try {
      const body = await req.json();
      targetOrg = body?.organization_id ?? null;
    } catch {
      // no body
    }

    let query = supabase
      .from("integration_accounts")
      .select("*")
      .eq("service_type", "quickbooks")
      .eq("is_active", true);

    if (targetOrg) query = query.eq("organization_id", targetOrg);

    const { data: qboAccounts, error: accountsError } = await query;
    if (accountsError) throw accountsError;

    if (!qboAccounts || qboAccounts.length === 0) {
      return new Response(
        JSON.stringify({ message: "No active QuickBooks integrations", checked: 0, renewed: 0, expired: 0, failed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results = { checked: 0, renewed: 0, expired: 0, failed: 0 };
    const RENEW_THRESHOLD_MIN = 30; // aggressive: renew when <30 min left

    for (const account of qboAccounts) {
      results.checked++;
      const credentials = account.credentials as any;
      const expiresAt = new Date(credentials.expires_at);
      const minutesUntilExpiry = (expiresAt.getTime() - Date.now()) / (1000 * 60);

      console.log(`📊 Org ${account.organization_id}: expires ${expiresAt.toISOString()} (${minutesUntilExpiry.toFixed(1)} min)`);

      if (minutesUntilExpiry >= RENEW_THRESHOLD_MIN) {
        console.log(`✓ Token valid (${minutesUntilExpiry.toFixed(1)} min left)`);
        continue;
      }

      if (minutesUntilExpiry < 0) {
        results.expired++;
        console.log(`⚠️ Token expired ${Math.abs(minutesUntilExpiry).toFixed(1)} min ago`);
      }

      try {
        const tokenResponse = await fetch(
          "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "Authorization": `Basic ${btoa(
                `${Deno.env.get("QBO_CLIENT_ID")}:${Deno.env.get("QBO_CLIENT_SECRET")}`
              )}`,
            },
            body: new URLSearchParams({
              grant_type: "refresh_token",
              refresh_token: credentials.refresh_token,
            }),
          }
        );

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text();
          console.error(`❌ Refresh failed for org ${account.organization_id}: ${errorText}`);
          results.failed++;

          if (errorText.includes("invalid_grant")) {
            await supabase
              .from("integration_accounts")
              .update({ is_active: false })
              .eq("id", account.id);
            console.log(`🔴 Integration marked inactive - reconnection required`);
          }

          await supabase.from("audit_log").insert({
            action: "qbo_token_renewal_failed",
            resource_type: "integration_accounts",
            resource_id: account.id,
            organization_id: account.organization_id,
            details: { error: errorText.substring(0, 500), minutes_until_expiry: minutesUntilExpiry },
          }).then(() => {}, () => {});
          continue;
        }

        const tokens = await tokenResponse.json();
        const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

        await supabase
          .from("integration_accounts")
          .update({
            credentials: {
              ...credentials,
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token,
              expires_at: newExpiresAt.toISOString(),
            },
          })
          .eq("id", account.id);

        results.renewed++;
        console.log(`✅ Renewed for org ${account.organization_id}, new expiry: ${newExpiresAt.toISOString()}`);

        await supabase.from("audit_log").insert({
          action: "qbo_token_renewed",
          resource_type: "integration_accounts",
          resource_id: account.id,
          organization_id: account.organization_id,
          details: { new_expires_at: newExpiresAt.toISOString(), expires_in_minutes: Math.round(tokens.expires_in / 60) },
        }).then(() => {}, () => {});
      } catch (error) {
        console.error(`❌ Error renewing token for org ${account.organization_id}:`, error);
        results.failed++;
      }
    }

    console.log("📈 Token renewal summary:", results);

    return new Response(
      JSON.stringify({ success: true, ...results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("❌ Auto-renew error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
