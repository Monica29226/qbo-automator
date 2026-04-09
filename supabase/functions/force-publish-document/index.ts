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

    const isCreditNote = doc.doc_type?.toLowerCase().includes("nota") || 
                         doc.doc_type?.toLowerCase().includes("credit") ||
                         doc.doc_type === "NC" ||
                         doc.doc_type === "03";
    
    const docNumber = doc.doc_number.length === 20
      ? doc.doc_number.substring(10).replace(/^0+/, '') || '0'
      : (doc.doc_number.length > 21 ? doc.doc_number.substring(doc.doc_number.length - 21) : doc.doc_number);

    // Parse XML detail lines for proper tax handling
    const xmlData = doc.xml_data as any;
    const detalleLines = xmlData?.detalle || [];
    const totalTax = Math.abs(doc.total_tax || 0);
    const hasTax = totalTax > 0.001;
    
    const billLines: any[] = [];
    const taxByRate: Record<number, { taxAmount: number; netAmount: number }> = {};
    
    if (detalleLines.length > 0) {
      for (const item of detalleLines) {
        const cantidad = parseFloat(item.cantidad) || 1;
        let subtotal = parseFloat(item.subtotal) || (cantidad * (parseFloat(item.precioUnitario) || 0));
        if (isCreditNote) subtotal = -Math.abs(subtotal);
        
        let montoImpuestoIVA = 0;
        let tasaImpuesto = 0;
        let montoImpuestoIEBLE = 0;
        
        if (item.impuestos && Array.isArray(item.impuestos)) {
          for (const imp of item.impuestos) {
            const codigo = imp.codigo || '';
            const monto = parseFloat(imp.monto) || 0;
            if (codigo === '01') {
              tasaImpuesto = parseFloat(imp.tarifa) || 0;
              montoImpuestoIVA = monto;
            } else if (codigo === '07') {
              montoImpuestoIEBLE = monto;
            }
          }
          if (isCreditNote) {
            montoImpuestoIVA = -Math.abs(montoImpuestoIVA);
            montoImpuestoIEBLE = -Math.abs(montoImpuestoIEBLE);
          }
        } else {
          tasaImpuesto = parseFloat(item.tarifa) || 0;
          montoImpuestoIVA = parseFloat(item.montoImpuesto) || 0;
          if (isCreditNote) montoImpuestoIVA = -Math.abs(montoImpuestoIVA);
        }
        
        // Line amount = subtotal (base) + IEBLE (always expense)
        let lineAmount = subtotal;
        if (Math.abs(montoImpuestoIEBLE) > 0) lineAmount += Math.abs(montoImpuestoIEBLE);
        
        const montoTotalLinea = parseFloat(item.montoTotalLinea) || (Math.abs(subtotal) + Math.abs(montoImpuestoIVA) + Math.abs(montoImpuestoIEBLE));
        
        if (Math.abs(lineAmount) > 0.001) {
          const descripcion = item.descripcion || item.detalle || 'Línea de factura';
          billLines.push({
            DetailType: "AccountBasedExpenseLineDetail",
            Amount: Math.abs(lineAmount),
            Description: `${isCreditNote ? 'NC' : 'Factura'} ${doc.doc_number} - ${descripcion}`.substring(0, 4000),
            AccountBasedExpenseLineDetail: {
              AccountRef: { value: accountRef },
            },
            _montoTotalLinea: montoTotalLinea,
          });
          
          // Accumulate IVA by rate
          if (tasaImpuesto > 0 && Math.abs(montoImpuestoIVA) > 0.001) {
            const rateKey = Math.round(tasaImpuesto);
            if (!taxByRate[rateKey]) taxByRate[rateKey] = { taxAmount: 0, netAmount: 0 };
            taxByRate[rateKey].taxAmount += Math.abs(montoImpuestoIVA);
            taxByRate[rateKey].netAmount += Math.abs(subtotal);
          }
        }
      }
    }
    
    // Fallback: single line if no detail lines parsed
    if (billLines.length === 0) {
      const lineAmount = hasTax ? Math.abs(doc.total_amount - totalTax) : Math.abs(doc.total_amount);
      billLines.push({
        DetailType: "AccountBasedExpenseLineDetail",
        Amount: lineAmount,
        Description: `${isCreditNote ? 'NC' : 'Factura'} ${doc.doc_number} - ${doc.supplier_name} (Publicación forzada)`,
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: accountRef },
        },
        _montoTotalLinea: Math.abs(doc.total_amount),
      });
    }

    const billPayload: any = {
      VendorRef: { value: vendorId },
      TxnDate: doc.issue_date,
      DueDate: doc.issue_date,
      DocNumber: docNumber,
      Line: billLines,
      PrivateNote: `Publicación Forzada - Clave: ${doc.doc_key}\nMonto original: ${doc.total_amount} ${doc.currency}`,
      GlobalTaxCalculation: hasTax ? "TaxExcluded" : "NotApplicable",
    };
    
    // Add TxnTaxDetail if there's tax
    if (hasTax) {
      const taxLines: any[] = [];
      for (const [rateStr, { taxAmount, netAmount }] of Object.entries(taxByRate)) {
        const rate = Number(rateStr);
        if (taxAmount > 0.001) {
          taxLines.push({
            Amount: parseFloat(taxAmount.toFixed(2)),
            DetailType: "TaxLineDetail",
            TaxLineDetail: {
              PercentBased: true,
              TaxPercent: rate,
              NetAmountTaxable: parseFloat(netAmount.toFixed(2)),
            },
          });
        }
      }
      if (taxLines.length > 0) {
        billPayload.TxnTaxDetail = { TotalTax: parseFloat(totalTax.toFixed(2)), TaxLine: taxLines };
      } else {
        billPayload.TxnTaxDetail = { TotalTax: parseFloat(totalTax.toFixed(2)) };
      }
    }

    if (doc.currency === 'USD') {
      billPayload.CurrencyRef = { value: "USD" };
      const exchangeRate = doc.exchange_rate || (doc.xml_data as any)?.resumen_factura?.tipoCambio || 1;
      if (exchangeRate > 1) billPayload.ExchangeRate = parseFloat(String(exchangeRate));
    }

    const lineTotal = billLines.reduce((sum: number, l: any) => sum + l.Amount, 0);
    console.log(`📤 Creating ${isCreditNote ? 'VendorCredit' : 'Bill'} - Lines: ${lineTotal.toFixed(2)}, Tax: ${hasTax ? totalTax.toFixed(2) : '0'}`);

    await delay(500);

    let entityId: string;
    let entityType: string;
    const endpoint = isCreditNote ? 'vendorcredit' : 'bill';

    let response = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${realmId}/${endpoint}`,
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

    // Tax error retry: switch to TaxInclusive
    if (!response.ok && hasTax) {
      const errorText = await response.text();
      if (errorText.includes('impuesto') || errorText.includes('tax') || errorText.includes('TaxCodeRef') || errorText.includes('impositiva')) {
        console.log(`⚠️ Tax error, retrying with TaxInclusive...`);
        delete billPayload.TxnTaxDetail;
        billPayload.GlobalTaxCalculation = "TaxInclusive";
        for (const line of billPayload.Line) {
          if (line._montoTotalLinea && line._montoTotalLinea > line.Amount) {
            line.Amount = parseFloat(line._montoTotalLinea.toFixed(2));
          }
        }
        await delay(500);
        response = await fetch(
          `https://quickbooks.api.intuit.com/v3/company/${realmId}/${endpoint}`,
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
      }
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`QuickBooks ${isCreditNote ? 'VendorCredit' : 'Bill'} Error: ${errorText}`);
    }

    const responseData = await response.json();
    const entityKey = isCreditNote ? 'VendorCredit' : 'Bill';
    entityId = responseData[entityKey].Id;
    entityType = entityKey;

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
