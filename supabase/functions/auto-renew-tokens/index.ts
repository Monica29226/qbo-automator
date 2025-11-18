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

    console.log("🔄 Starting automatic token renewal check...");

    // Obtener todas las integraciones de QuickBooks activas
    const { data: qboAccounts, error: accountsError } = await supabase
      .from("integration_accounts")
      .select("*")
      .eq("service_type", "quickbooks")
      .eq("is_active", true);

    if (accountsError) throw accountsError;

    if (!qboAccounts || qboAccounts.length === 0) {
      console.log("No active QuickBooks integrations found");
      return new Response(
        JSON.stringify({ message: "No active QuickBooks integrations" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results = {
      checked: 0,
      renewed: 0,
      expired: 0,
      failed: 0,
    };

    for (const account of qboAccounts) {
      results.checked++;
      const credentials = account.credentials as any;
      const expiresAt = new Date(credentials.expires_at);
      const now = new Date();
      const hoursUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);

      console.log(`\n📊 Checking ${account.organization_id}:`);
      console.log(`   Expires: ${expiresAt.toISOString()}`);
      console.log(`   Hours until expiry: ${hoursUntilExpiry.toFixed(2)}`);

      // Renovar si expira en menos de 72 horas (3 días) o ya expiró
      // Esto asegura renovación proactiva con suficiente margen
      if (hoursUntilExpiry < 72) {
        console.log(`🔄 Token needs renewal for org ${account.organization_id}`);
        
        if (hoursUntilExpiry < 0) {
          results.expired++;
          console.log(`⚠️ Token already expired ${Math.abs(hoursUntilExpiry).toFixed(2)} hours ago`);
        }

        try {
          // Renovar token
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
            console.error(`❌ Failed to refresh token: ${errorText}`);
            results.failed++;
            
            // Marcar integración como inactiva si el refresh token es inválido
            if (errorText.includes("invalid_grant")) {
              await supabase
                .from("integration_accounts")
                .update({ is_active: false })
                .eq("id", account.id);
              
              console.log(`🔴 Integration marked as inactive - reconnection required`);
            }
            continue;
          }

          const tokens = await tokenResponse.json();
          
          // Actualizar tokens en DB
          await supabase
            .from("integration_accounts")
            .update({
              credentials: {
                ...credentials,
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
              },
            })
            .eq("id", account.id);

          results.renewed++;
          const newExpiry = new Date(Date.now() + tokens.expires_in * 1000);
          console.log(`✅ Token renewed successfully! New expiry: ${newExpiry.toISOString()}`);

        } catch (error) {
          console.error(`❌ Error renewing token:`, error);
          results.failed++;
        }
      } else {
        console.log(`✓ Token is valid (expires in ${hoursUntilExpiry.toFixed(2)} hours)`);
      }
    }

    console.log("\n📈 Token Renewal Summary:", results);

    return new Response(
      JSON.stringify({
        success: true,
        ...results,
      }),
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
