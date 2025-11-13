import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    const { organization_id } = await req.json();

    if (!organization_id) {
      throw new Error("organization_id is required");
    }

    console.log(`📋 Listing QuickBooks accounts for organization: ${organization_id}`);

    // Get QuickBooks credentials
    const { data: integration, error: intError } = await supabase
      .from("integration_accounts")
      .select("credentials")
      .eq("organization_id", organization_id)
      .eq("service_type", "quickbooks")
      .maybeSingle();

    if (intError || !integration) {
      throw new Error("QuickBooks integration not found");
    }

    const credentials = integration.credentials as any;
    let accessToken = credentials.access_token;
    const realmId = credentials.realmId;

    // Refresh token if expired
    if (credentials.expires_at && new Date(credentials.expires_at) <= new Date()) {
      console.log("🔄 Refreshing QuickBooks access token...");
      
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

      if (!tokenResponse.ok) {
        throw new Error("Failed to refresh QuickBooks token");
      }

      const newTokens = await tokenResponse.json();
      accessToken = newTokens.access_token;

      // Update tokens in database
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

    // Fetch ALL accounts from QuickBooks
    console.log("📡 Fetching all accounts from QuickBooks...");
    
    const query = `SELECT Id, Name, AcctNum, AccountType, Active FROM Account MAXRESULTS 1000`;
    const queryUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`;
    
    const response = await fetch(queryUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`QuickBooks API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.QueryResponse?.Account) {
      return new Response(
        JSON.stringify({ 
          success: true,
          accounts: [],
          total: 0,
          message: "No accounts found in QuickBooks"
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accounts = data.QueryResponse.Account.map((acc: any) => ({
      id: acc.Id,
      name: acc.Name,
      accountNumber: acc.AcctNum || null,
      type: acc.AccountType,
      active: acc.Active !== false
    }));

    // Group by type for easier analysis
    const byType: Record<string, any[]> = {};
    accounts.forEach((acc: any) => {
      if (!byType[acc.type]) {
        byType[acc.type] = [];
      }
      byType[acc.type].push(acc);
    });

    console.log(`✅ Found ${accounts.length} accounts across ${Object.keys(byType).length} types`);
    
    // Log summary by type
    Object.entries(byType).forEach(([type, accs]) => {
      console.log(`  - ${type}: ${accs.length} accounts`);
    });

    return new Response(
      JSON.stringify({
        success: true,
        accounts,
        byType,
        total: accounts.length,
        summary: Object.entries(byType).map(([type, accs]) => ({
          type,
          count: accs.length
        }))
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in list-quickbooks-accounts:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { 
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
