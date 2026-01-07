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

    // 2. Get all vendors with configured accounts
    const { data: vendors, error: vendorsError } = await supabase
      .from("vendors")
      .select("id, vendor_name, vendor_tax_id, default_account_ref")
      .eq("organization_id", organization_id)
      .eq("is_active", true);

    if (vendorsError) throw vendorsError;

    // 2b. Get vendor_defaults (many orgs use this table for account mapping)
    const { data: vendorDefaults, error: vendorDefaultsError } = await supabase
      .from("vendor_defaults")
      .select("id, vendor_name, default_account_ref")
      .eq("organization_id", organization_id);

    if (vendorDefaultsError) throw vendorDefaultsError;

    console.log(`📋 Found ${vendors?.length || 0} vendors`);
    console.log(`📋 Found ${vendorDefaults?.length || 0} vendor_defaults`);

    const normalizeName = (name: string) =>
      name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();

    const scoreAccountRef = (ref: string): number => {
      const v = ref.trim();
      if (!v) return 0;
      if (/^\d+$/.test(v)) return 3; // pure numeric
      if (/^\d+/.test(v)) return 2; // starts with digits (e.g. "608 Gastos")
      return 1;
    };

    const pickBetter = (current: string | undefined, candidate: string): string => {
      if (!current) return candidate;
      return scoreAccountRef(candidate) > scoreAccountRef(current) ? candidate : current;
    };

    // 3. Get published documents to find known-good account refs that already worked
    const { data: publishedDocs, error: publishedError } = await supabase
      .from("processed_documents")
      .select("supplier_name, supplier_tax_id, default_account_ref")
      .eq("organization_id", organization_id)
      .eq("status", "published")
      .not("default_account_ref", "is", null);

    if (publishedError) console.error("Error fetching published docs:", publishedError);

    const validAccountByTaxId = new Map<string, string>();
    const validAccountByName = new Map<string, string>();

    for (const pd of publishedDocs || []) {
      const ref = (pd.default_account_ref || "").toString().trim();
      if (!ref) continue;

      if (pd.supplier_tax_id) {
        const cleanTaxId = pd.supplier_tax_id.replace(/-/g, "");
        validAccountByTaxId.set(cleanTaxId, pickBetter(validAccountByTaxId.get(cleanTaxId), ref));
      }

      if (pd.supplier_name) {
        const key = normalizeName(pd.supplier_name);
        validAccountByName.set(key, pickBetter(validAccountByName.get(key), ref));
      }
    }

    console.log(
      `📋 Found ${validAccountByTaxId.size} suppliers with known-good accounts from published docs`
    );

    // Create maps for quick lookup
    const vendorByTaxId = new Map<string, any>();
    const vendorByName = new Map<string, any>();

    for (const v of vendors || []) {
      if (v.vendor_tax_id) {
        vendorByTaxId.set(v.vendor_tax_id.replace(/-/g, ""), v);
      }
      vendorByName.set(normalizeName(v.vendor_name), v);
    }

    const vendorDefaultByName = new Map<string, { id: string; vendor_name: string; default_account_ref: string | null }>();
    for (const vd of vendorDefaults || []) {
      vendorDefaultByName.set(normalizeName(vd.vendor_name), vd);
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

      // Determine the correct account to use
      let correctAccount = matchedVendor.default_account_ref;
      
      // If vendor account is not a valid QBO ID, try to find from published docs
      if (!isValidQboAccount(correctAccount)) {
        console.log(`⚠️ Vendor account "${correctAccount}" is not a valid QBO ID, searching published docs...`);
        
        // Try to find valid account from published docs
        if (doc.supplier_tax_id) {
          const cleanTaxId = doc.supplier_tax_id.replace(/-/g, '');
          const validFromTaxId = validAccountByTaxId.get(cleanTaxId);
          if (validFromTaxId) {
            correctAccount = validFromTaxId;
            console.log(`   Found valid account from tax_id: ${correctAccount}`);
          }
        }
        
        if (!isValidQboAccount(correctAccount) && doc.supplier_name) {
          const validFromName = validAccountByName.get(doc.supplier_name.toLowerCase().trim());
          if (validFromName) {
            correctAccount = validFromName;
            console.log(`   Found valid account from name: ${correctAccount}`);
          }
        }
        
        if (!isValidQboAccount(correctAccount)) {
          console.log(`❌ No valid QBO account found for ${doc.supplier_name}. Vendor needs correct QBO account ID.`);
          notFound.push({
            doc_number: doc.doc_number,
            supplier_name: doc.supplier_name,
            supplier_tax_id: doc.supplier_tax_id,
            current_account: doc.default_account_ref,
            vendor_account: matchedVendor.default_account_ref,
            issue: "Vendor account is not a valid QuickBooks ID (should be numeric)"
          });
          continue;
        }
      }

      const currentAccount = doc.default_account_ref;

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
