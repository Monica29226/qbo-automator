import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { document_id, organization_id } = await req.json();

    if (!document_id || !organization_id) {
      throw new Error("document_id and organization_id are required");
    }

    console.log(`🚀 Force publishing document: ${document_id}`);

    // Get the document
    const { data: doc, error: docError } = await supabase
      .from("processed_documents")
      .select("*")
      .eq("id", document_id)
      .eq("organization_id", organization_id)
      .single();

    if (docError || !doc) {
      throw new Error(`Document not found: ${docError?.message || "Not found"}`);
    }

    console.log(`📋 Document: ${doc.doc_number} - ${doc.supplier_name} - ${doc.total_amount}`);

    // Get QuickBooks credentials
    const { data: qboAccount } = await supabase
      .from("integration_accounts")
      .select("credentials")
      .eq("organization_id", organization_id)
      .eq("service_type", "quickbooks")
      .eq("is_active", true)
      .maybeSingle();

    if (!qboAccount) {
      throw new Error("QuickBooks not connected");
    }

    const credentials = qboAccount.credentials as any;
    const accessToken = credentials.access_token;
    const realmId = credentials.realm_id;

    // Get account configuration
    let accountCode = doc.default_account_ref;
    
    if (!accountCode) {
      const { data: vendorDefault } = await supabase
        .from("vendor_defaults")
        .select("default_account_ref")
        .eq("organization_id", organization_id)
        .ilike("vendor_name", doc.supplier_name)
        .maybeSingle();
      
      if (vendorDefault?.default_account_ref) {
        accountCode = vendorDefault.default_account_ref;
      }
    }
    
    if (!accountCode) {
      const { data: vendor } = await supabase
        .from("vendors")
        .select("default_account_ref")
        .eq("organization_id", organization_id)
        .ilike("vendor_name", doc.supplier_name)
        .maybeSingle();
      
      if (vendor?.default_account_ref) {
        accountCode = vendor.default_account_ref;
      }
    }

    if (!accountCode) {
      throw new Error("No account configured for vendor. Please configure account first.");
    }

    // Get Account ID from QuickBooks
    const extractedCode = accountCode.includes(' - ') 
      ? accountCode.split(' - ')[0].trim()
      : accountCode.split(' ')[0].trim();
    
    const accountQuery = `SELECT Id, Name, AcctNum FROM Account MAXRESULTS 1000`;
    const accountResponse = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(accountQuery)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }
    );

    if (!accountResponse.ok) {
      throw new Error("Failed to fetch accounts from QuickBooks");
    }

    const accountData = await accountResponse.json();
    const allAccounts = accountData.QueryResponse?.Account || [];
    
    let accountRef = allAccounts.find((acc: any) => acc.AcctNum === extractedCode)?.Id;
    if (!accountRef) {
      accountRef = allAccounts.find((acc: any) => acc.Id === extractedCode)?.Id;
    }
    if (!accountRef) {
      accountRef = allAccounts.find((acc: any) => 
        acc.Name?.toLowerCase().includes(extractedCode.toLowerCase())
      )?.Id;
    }

    if (!accountRef) {
      throw new Error(`Account ${accountCode} not found in QuickBooks`);
    }

    console.log(`✅ Account found: ${accountRef}`);

    // Find or create vendor
    const supplierName = doc.supplier_name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .substring(0, 100)
      .trim();

    const vendorQuery = `SELECT * FROM Vendor WHERE DisplayName = '${supplierName.replace(/'/g, "\\'")}'`;
    const vendorSearchResponse = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(vendorQuery)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }
    );

    let vendorId: string;
    
    if (vendorSearchResponse.ok) {
      const vendorSearchData = await vendorSearchResponse.json();
      if (vendorSearchData.QueryResponse?.Vendor?.length > 0) {
        vendorId = vendorSearchData.QueryResponse.Vendor[0].Id;
        console.log(`✅ Vendor found: ${vendorId}`);
      } else {
        // Create vendor
        console.log(`➕ Creating vendor: ${supplierName}`);
        const createVendorResponse = await fetch(
          `https://quickbooks.api.intuit.com/v3/company/${realmId}/vendor`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ DisplayName: supplierName }),
          }
        );

        if (!createVendorResponse.ok) {
          const errorText = await createVendorResponse.text();
          throw new Error(`Failed to create vendor: ${errorText}`);
        }

        const newVendorData = await createVendorResponse.json();
        vendorId = newVendorData.Vendor.Id;
        console.log(`✅ Vendor created: ${vendorId}`);
      }
    } else {
      throw new Error("Failed to search vendors in QuickBooks");
    }

    // Build bill with simple single line using document total
    const isCreditNote = doc.doc_type?.toLowerCase().includes("nota") || 
                         doc.doc_type?.toLowerCase().includes("credit") ||
                         doc.doc_type === "NC" ||
                         doc.doc_type === "03";
    
    const docNumber = doc.doc_number.length > 21 
      ? doc.doc_number.substring(doc.doc_number.length - 21)
      : doc.doc_number;

    // Use document total directly, ignoring any tax complications
    const totalAmount = Math.abs(doc.total_amount);
    
    const billPayload: any = {
      VendorRef: { value: vendorId },
      TxnDate: doc.issue_date,
      DueDate: doc.issue_date,
      DocNumber: docNumber,
      Line: [
        {
          DetailType: "AccountBasedExpenseLineDetail",
          Amount: totalAmount,
          Description: `${isCreditNote ? 'NC' : 'Factura'} ${doc.doc_number} - ${doc.supplier_name} (Publicación forzada)`,
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: accountRef },
          },
        }
      ],
      PrivateNote: `Publicación Forzada - Clave: ${doc.doc_key}\nMonto original: ${doc.total_amount} ${doc.currency}`,
      GlobalTaxCalculation: "NotApplicable", // No tax calculation - total amount already includes everything
    };

    if (doc.currency === 'USD') {
      billPayload.CurrencyRef = { value: "USD" };
    }

    console.log(`📤 Creating ${isCreditNote ? 'VendorCredit' : 'Bill'} with amount: ${totalAmount}`);

    await delay(500);

    let entityId: string;
    let entityType: string;

    if (isCreditNote) {
      const vcResponse = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${realmId}/vendorcredit`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(billPayload),
        }
      );

      if (!vcResponse.ok) {
        const errorText = await vcResponse.text();
        throw new Error(`QuickBooks VendorCredit Error: ${errorText}`);
      }

      const vcData = await vcResponse.json();
      entityId = vcData.VendorCredit.Id;
      entityType = "VendorCredit";
    } else {
      const billResponse = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${realmId}/bill`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(billPayload),
        }
      );

      if (!billResponse.ok) {
        const errorText = await billResponse.text();
        throw new Error(`QuickBooks Bill Error: ${errorText}`);
      }

      const billData = await billResponse.json();
      entityId = billData.Bill.Id;
      entityType = "Bill";
    }

    console.log(`✅ ${entityType} created: ${entityId}`);

    // Update document status
    await supabase
      .from("processed_documents")
      .update({
        status: "published",
        qbo_entity_id: entityId,
        qbo_entity_type: entityType,
        error_message: `Publicación forzada exitosa (ID: ${entityId})`,
        processed_at: new Date().toISOString(),
      })
      .eq("id", document_id);

    // Register in tracking
    await supabase
      .from("qbo_publish_tracking")
      .upsert({
        organization_id,
        clave_hacienda: doc.doc_key,
        doc_number: doc.doc_number,
        document_id: doc.id,
        emisor_identificacion: doc.supplier_tax_id,
        receptor_identificacion: null,
        qbo_entity_id: entityId,
        qbo_entity_type: entityType,
        qbo_doc_number: docNumber,
        total_amount: doc.total_amount,
        currency: doc.currency,
        supplier_name: doc.supplier_name,
        status: 'published',
        error_message: null,
        published_at: new Date().toISOString(),
      }, {
        onConflict: 'organization_id,clave_hacienda'
      });

    return new Response(
      JSON.stringify({
        success: true,
        message: `${entityType} created successfully`,
        qbo_entity_id: entityId,
        qbo_entity_type: entityType,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("❌ Force publish error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
