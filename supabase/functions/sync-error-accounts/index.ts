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

    const { organization_id, dry_run = true } = await req.json();

    if (!organization_id) {
      throw new Error("organization_id is required");
    }

    console.log(`🔄 Sync error accounts started for organization: ${organization_id}`);
    console.log(`   Mode: ${dry_run ? 'DRY RUN (no changes)' : 'LIVE (will update)'}`);

    // 1. Get all error documents with account issues
    const { data: errorDocs, error: errorDocsError } = await supabase
      .from("processed_documents")
      .select("id, doc_number, supplier_name, supplier_tax_id, default_account_ref, error_message, vendor_id, retry_count")
      .eq("organization_id", organization_id)
      .eq("status", "error")
      .or("error_message.ilike.%cuenta%,error_message.ilike.%account%");

    if (errorDocsError) throw errorDocsError;

    if (!errorDocs || errorDocs.length === 0) {
      return new Response(
        JSON.stringify({ message: "No error documents with account issues found", updated: 0, toRetry: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📋 Found ${errorDocs.length} documents with account errors`);

    // 2. Get all vendors with correct accounts
    const { data: vendors, error: vendorsError } = await supabase
      .from("vendors")
      .select("id, vendor_name, vendor_tax_id, default_account_ref")
      .eq("organization_id", organization_id)
      .eq("is_active", true);

    if (vendorsError) throw vendorsError;

    console.log(`📋 Found ${vendors?.length || 0} configured vendors`);

    // Create maps for quick lookup
    const vendorByTaxId = new Map<string, any>();
    const vendorByName = new Map<string, any>();
    
    for (const v of vendors || []) {
      if (v.vendor_tax_id) {
        vendorByTaxId.set(v.vendor_tax_id.replace(/-/g, ''), v);
      }
      vendorByName.set(v.vendor_name.toLowerCase().trim(), v);
    }

    const updated: any[] = [];
    const notFound: any[] = [];
    const alreadyCorrect: any[] = [];

    for (const doc of errorDocs) {
      // Try to find matching vendor
      let matchedVendor = null;
      
      // First try by tax_id
      if (doc.supplier_tax_id) {
        const cleanTaxId = doc.supplier_tax_id.replace(/-/g, '');
        matchedVendor = vendorByTaxId.get(cleanTaxId);
      }
      
      // Then try by name
      if (!matchedVendor && doc.supplier_name) {
        matchedVendor = vendorByName.get(doc.supplier_name.toLowerCase().trim());
      }

      if (!matchedVendor) {
        console.log(`❌ No vendor found for: ${doc.supplier_name} (${doc.supplier_tax_id})`);
        notFound.push({
          doc_number: doc.doc_number,
          supplier_name: doc.supplier_name,
          supplier_tax_id: doc.supplier_tax_id,
          current_account: doc.default_account_ref
        });
        continue;
      }

      // Check if account is different
      const currentAccount = doc.default_account_ref;
      const correctAccount = matchedVendor.default_account_ref;

      if (currentAccount === correctAccount) {
        console.log(`✅ Account already correct for ${doc.doc_number}: ${correctAccount}`);
        alreadyCorrect.push({
          doc_number: doc.doc_number,
          supplier_name: doc.supplier_name,
          account: correctAccount
        });
        continue;
      }

      console.log(`🔧 ${doc.doc_number}: ${doc.supplier_name}`);
      console.log(`   Current: ${currentAccount} → Correct: ${correctAccount}`);

      if (!dry_run) {
        // Update document with correct account and vendor_id
        const { error: updateError } = await supabase
          .from("processed_documents")
          .update({
            default_account_ref: correctAccount,
            vendor_id: matchedVendor.id,
            status: "pending",
            error_message: null,
            retry_count: (doc.retry_count || 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", doc.id);

        if (updateError) {
          console.error(`Error updating ${doc.doc_number}:`, updateError);
          continue;
        }
      }

      updated.push({
        id: doc.id,
        doc_number: doc.doc_number,
        supplier_name: doc.supplier_name,
        old_account: currentAccount,
        new_account: correctAccount,
        vendor_id: matchedVendor.id
      });
    }

    // 3. If we updated documents and not dry_run, trigger republish
    if (!dry_run && updated.length > 0) {
      console.log(`\n📤 Triggering publish for ${updated.length} updated documents...`);
      
      const { error: publishError } = await supabase.functions.invoke(
        "publish-to-quickbooks",
        {
          body: {
            organization_id,
            document_ids: updated.map(d => d.id),
          },
        }
      );

      if (publishError) {
        console.error("Error triggering publish:", publishError);
      }
    }

    const summary = {
      total_errors: errorDocs.length,
      updated: updated.length,
      not_found: notFound.length,
      already_correct: alreadyCorrect.length,
      dry_run,
      details: {
        updated,
        not_found: notFound,
        already_correct: alreadyCorrect
      }
    };

    console.log("\n📊 Summary:", JSON.stringify(summary, null, 2));

    return new Response(
      JSON.stringify(summary),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("❌ Sync error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
