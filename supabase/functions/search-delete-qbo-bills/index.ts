import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

// Skip auth for service role operations
    // Updated: 2025-12-05
    const { organization_id, doc_numbers, action = "search" } = await req.json();

    if (!organization_id || !doc_numbers || !Array.isArray(doc_numbers)) {
      throw new Error("organization_id and doc_numbers array are required");
    }

    console.log(`🔍 ${action === "delete" ? "Searching and deleting" : "Searching"} for ${doc_numbers.length} bills in QuickBooks`);

    // Get QuickBooks credentials
    const { data: integration } = await supabase
      .from("integration_accounts")
      .select("credentials")
      .eq("organization_id", organization_id)
      .eq("service_type", "quickbooks")
      .eq("is_active", true)
      .single();

    if (!integration?.credentials) {
      throw new Error("QuickBooks integration not found");
    }

    const credentials = integration.credentials as any;
    let accessToken = credentials.access_token;
    const realmId = credentials.realm_id;

    // Refresh token if needed
    if (credentials.expires_at && new Date(credentials.expires_at) < new Date()) {
      console.log("🔄 Refreshing access token...");
      const tokenResponse = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${btoa(`${Deno.env.get("QBO_CLIENT_ID")}:${Deno.env.get("QBO_CLIENT_SECRET")}`)}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credentials.refresh_token,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error("Failed to refresh QuickBooks token");
      }

      const tokenData = await tokenResponse.json();
      accessToken = tokenData.access_token;

      await supabase
        .from("integration_accounts")
        .update({
          credentials: {
            ...credentials,
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
          },
        })
        .eq("organization_id", organization_id)
        .eq("service_type", "quickbooks");
    }

    const results = {
      found: [] as any[],
      not_found: [] as string[],
      deleted: [] as string[],
      delete_errors: [] as any[],
    };

    for (const docNumber of doc_numbers) {
      try {
        console.log(`🔍 Searching for bill: ${docNumber}`);

        // Search for bill by DocNumber
        const query = `SELECT * FROM Bill WHERE DocNumber = '${docNumber}'`;
        const searchUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`;
        
        const searchResponse = await fetch(searchUrl, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/json",
          },
        });

        if (!searchResponse.ok) {
          console.error(`❌ Search failed for ${docNumber}: ${searchResponse.status}`);
          continue;
        }

        const searchData = await searchResponse.json();
        const bills = searchData.QueryResponse?.Bill || [];

        if (bills.length === 0) {
          console.log(`⚪ Not found in QuickBooks: ${docNumber}`);
          results.not_found.push(docNumber);
          continue;
        }

        const bill = bills[0];
        console.log(`✅ Found bill: ${docNumber} (QBO ID: ${bill.Id}, TxnDate: ${bill.TxnDate}, Total: ${bill.TotalAmt})`);
        
        results.found.push({
          doc_number: docNumber,
          qbo_id: bill.Id,
          txn_date: bill.TxnDate,
          total: bill.TotalAmt,
          vendor: bill.VendorRef?.name || "Unknown",
        });

        // Delete if action is "delete"
        if (action === "delete") {
          console.log(`🗑️ Deleting bill: ${docNumber} (QBO ID: ${bill.Id})`);
          
          const deleteResponse = await fetch(
            `https://quickbooks.api.intuit.com/v3/company/${realmId}/bill?operation=delete`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Accept": "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                Id: bill.Id,
                SyncToken: bill.SyncToken,
              }),
            }
          );

          if (deleteResponse.ok) {
            console.log(`✅ Deleted bill: ${docNumber}`);
            results.deleted.push(docNumber);
          } else {
            const errorText = await deleteResponse.text();
            console.error(`❌ Failed to delete ${docNumber}: ${errorText}`);
            results.delete_errors.push({
              doc_number: docNumber,
              error: errorText,
            });
          }
        }

        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error) {
        console.error(`❌ Error processing ${docNumber}:`, error);
        results.delete_errors.push({
          doc_number: docNumber,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    console.log(`✅ Complete. Found: ${results.found.length}, Not found: ${results.not_found.length}, Deleted: ${results.deleted.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        action,
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in search-delete-qbo-bills:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
