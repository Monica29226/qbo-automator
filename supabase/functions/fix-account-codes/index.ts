import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const { organization_id } = await req.json();

    if (!organization_id) {
      return new Response(
        JSON.stringify({ error: "organization_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`🔧 Fixing account codes for organization: ${organization_id}`);

    // 1. Get QuickBooks credentials
    const { data: integration } = await supabase
      .from("integration_accounts")
      .select("credentials")
      .eq("organization_id", organization_id)
      .eq("service_type", "quickbooks")
      .eq("is_active", true)
      .maybeSingle();

    if (!integration?.credentials) {
      return new Response(
        JSON.stringify({ error: "QuickBooks not connected" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { access_token, realm_id } = integration.credentials as any;

    // 2. Fetch all QB accounts
    console.log("📊 Fetching QuickBooks accounts...");
    const accountsUrl = `https://quickbooks.api.intuit.com/v3/company/${realm_id}/query?query=${encodeURIComponent(
      "SELECT * FROM Account WHERE Active = true MAXRESULTS 1000"
    )}`;

    const accountsResponse = await fetch(accountsUrl, {
      headers: {
        Authorization: `Bearer ${access_token}`,
        Accept: "application/json",
      },
    });

    if (!accountsResponse.ok) {
      const errorText = await accountsResponse.text();
      console.error("QuickBooks API error:", errorText);
      return new Response(
        JSON.stringify({ error: "Failed to fetch QuickBooks accounts" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accountsData = await accountsResponse.json();
    const allAccounts = accountsData.QueryResponse?.Account || [];
    console.log(`✅ Found ${allAccounts.length} QuickBooks accounts`);

    // 3. Create ID -> AcctNum mapping
    const idToAcctNum: Record<string, { acctNum: string; name: string }> = {};
    allAccounts.forEach((acc: any) => {
      if (acc.Id && acc.AcctNum) {
        idToAcctNum[acc.Id] = { acctNum: acc.AcctNum, name: acc.Name };
      }
    });

    console.log(`📋 Created mapping for ${Object.keys(idToAcctNum).length} accounts`);

    // 4. Get error documents with "Cuenta X no existe" errors
    const { data: errorDocs, error: fetchError } = await supabase
      .from("processed_documents")
      .select("id, doc_number, supplier_name, error_message, default_account_ref")
      .eq("organization_id", organization_id)
      .eq("status", "error")
      .like("error_message", "%no existe en QuickBooks%");

    if (fetchError) {
      console.error("Error fetching documents:", fetchError);
      throw fetchError;
    }

    console.log(`📄 Found ${errorDocs?.length || 0} error documents to fix`);

    const results = {
      fixed: 0,
      notFixable: 0,
      noAccountConfigured: 0,
      details: [] as any[],
    };

    // 5. Process each error document
    for (const doc of errorDocs || []) {
      const errorMsg = doc.error_message || "";
      
      // Check if it's a "no account configured" error
      if (errorMsg.includes("No account configured")) {
        results.noAccountConfigured++;
        results.details.push({
          doc_number: doc.doc_number,
          supplier: doc.supplier_name,
          status: "needs_manual_config",
          reason: "No accounting account assigned",
        });
        continue;
      }

      // Extract the incorrect account code from error message
      // Pattern: "Cuenta 158 no existe en QuickBooks"
      const cuentaMatch = errorMsg.match(/Cuenta\s+(\d+)\s+no existe/i);
      if (!cuentaMatch) {
        results.notFixable++;
        results.details.push({
          doc_number: doc.doc_number,
          supplier: doc.supplier_name,
          status: "unknown_error",
          reason: errorMsg.substring(0, 100),
        });
        continue;
      }

      const wrongCode = cuentaMatch[1];
      console.log(`🔍 Document ${doc.doc_number}: has wrong code "${wrongCode}"`);

      // Check if the wrong code is actually an ID
      if (idToAcctNum[wrongCode]) {
        const correctMapping = idToAcctNum[wrongCode];
        console.log(`✅ Found correct mapping: ID ${wrongCode} -> AcctNum ${correctMapping.acctNum} (${correctMapping.name})`);

        // Update the document with correct account code
        const { error: updateError } = await supabase
          .from("processed_documents")
          .update({
            default_account_ref: correctMapping.acctNum,
            status: "pending",
            error_message: null,
            retry_count: 0,
          })
          .eq("id", doc.id);

        if (updateError) {
          console.error(`Error updating document ${doc.doc_number}:`, updateError);
          results.notFixable++;
          results.details.push({
            doc_number: doc.doc_number,
            supplier: doc.supplier_name,
            status: "update_failed",
            reason: updateError.message,
          });
        } else {
          results.fixed++;
          results.details.push({
            doc_number: doc.doc_number,
            supplier: doc.supplier_name,
            status: "fixed",
            old_code: wrongCode,
            new_code: correctMapping.acctNum,
            account_name: correctMapping.name,
          });

          // Also update vendor_defaults if exists
          await supabase
            .from("vendor_defaults")
            .update({ default_account_ref: correctMapping.acctNum })
            .eq("organization_id", organization_id)
            .eq("default_account_ref", wrongCode);
        }
      } else {
        // The wrong code is not a valid ID, try to find similar accounts
        console.log(`⚠️ Code "${wrongCode}" is not a valid QB account ID`);
        results.notFixable++;
        results.details.push({
          doc_number: doc.doc_number,
          supplier: doc.supplier_name,
          status: "invalid_code",
          reason: `Code "${wrongCode}" doesn't match any QuickBooks account ID`,
        });
      }
    }

    console.log(`\n📊 Fix Results:`);
    console.log(`  ✅ Fixed: ${results.fixed}`);
    console.log(`  ⚠️ Needs manual config: ${results.noAccountConfigured}`);
    console.log(`  ❌ Not fixable: ${results.notFixable}`);

    // 6. If we fixed any, trigger republish
    if (results.fixed > 0) {
      console.log(`\n🚀 Triggering republish for ${results.fixed} fixed documents...`);
      
      const { data: publishResult, error: publishError } = await supabase.functions.invoke(
        "publish-to-quickbooks",
        { body: { organization_id } }
      );

      if (publishError) {
        console.error("Republish error:", publishError);
        results.details.push({
          status: "republish_error",
          reason: publishError.message,
        });
      } else {
        console.log("✅ Republish triggered:", publishResult);
        results.details.push({
          status: "republish_triggered",
          published: publishResult?.published || 0,
          failed: publishResult?.failed || 0,
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        fixed: results.fixed,
        noAccountConfigured: results.noAccountConfigured,
        notFixable: results.notFixable,
        details: results.details,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in fix-account-codes:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
