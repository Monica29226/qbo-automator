import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";
import { attachPdfToQuickBooks, attachXmlToQuickBooks } from "../_shared/qbo-attachments.ts";

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
    
    // Use full document number as-is from XML
    const docNumber = doc.doc_number;

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

    // Sanitize payload: strip internal underscore-prefixed props that QBO rejects
    const sanitizePayload = (p: any) => {
      const clone = JSON.parse(JSON.stringify(p));
      if (Array.isArray(clone.Line)) {
        for (const line of clone.Line) {
          for (const key of Object.keys(line)) {
            if (key.startsWith('_')) delete line[key];
          }
        }
      }
      return clone;
    };

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
        body: JSON.stringify(sanitizePayload(billPayload)),
      }
    );

    // Tax error retry: switch to TaxInclusive
    let initialErrorText: string | null = null;
    if (!response.ok && hasTax) {
      initialErrorText = await response.text();
      if (initialErrorText.includes('impuesto') || initialErrorText.includes('tax') || initialErrorText.includes('TaxCodeRef') || initialErrorText.includes('impositiva')) {
        console.log(`⚠️ Tax error, retrying with NotApplicable (no tax)...`);
        delete billPayload.TxnTaxDetail;
        billPayload.GlobalTaxCalculation = "NotApplicable";
        for (const line of billPayload.Line) {
          // Remove TaxCodeRef to prevent QBO from calculating tax
          if (line.AccountBasedExpenseLineDetail?.TaxCodeRef) {
            delete line.AccountBasedExpenseLineDetail.TaxCodeRef;
          }
          // Use montoTotalLinea as full amount (includes tax as expense)
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
            body: JSON.stringify(sanitizePayload(billPayload)),
          }
        );
        initialErrorText = null; // body of new response not consumed yet
      }
    }

    if (!response.ok) {
      const errorText = initialErrorText ?? await response.text();
      throw new Error(`QuickBooks ${isCreditNote ? 'VendorCredit' : 'Bill'} Error: ${errorText}`);
    }

    const responseData = await response.json();
    const entityKey = isCreditNote ? 'VendorCredit' : 'Bill';
    const createdEntity = responseData[entityKey];
    entityId = createdEntity.Id;
    entityType = entityKey;

    console.log(`✅ ${entityType} created: ${entityId}`);

    // =============================================================
    // VERIFICACIÓN POST-CREACIÓN: total e IVA de QBO vs XML
    // Los montos del XML son la fuente de verdad; no se recalculan.
    // =============================================================
    const qboTotalAmt = parseFloat(createdEntity.TotalAmt || '0');
    const qboTotalTax = parseFloat(createdEntity?.TxnTaxDetail?.TotalTax || '0');
    const expectedTotal = Math.abs(doc.total_amount || 0);
    const expectedTax = Math.abs(doc.total_tax || 0);
    const totalDiscrepancy = Math.abs(qboTotalAmt - expectedTotal);
    const taxDiscrepancy = Math.abs(qboTotalTax - expectedTax);
    let discrepancyMsg: string | null = null;

    if (totalDiscrepancy > 1.0 || taxDiscrepancy > 1.0) {
      const issue = {
        code: 'qbo_total_mismatch',
        type: totalDiscrepancy > 1.0 ? 'critical' : 'warning',
        title: `Total QBO no coincide con XML — ${doc.doc_number} (publicación forzada)`,
        description: `QBO total=${qboTotalAmt.toFixed(2)} vs XML total=${expectedTotal.toFixed(2)} (diff ${totalDiscrepancy.toFixed(2)}). QBO IVA=${qboTotalTax.toFixed(2)} vs XML IVA=${expectedTax.toFixed(2)} (diff ${taxDiscrepancy.toFixed(2)}).`,
        doc_number: doc.doc_number,
        doc_key: doc.doc_key,
        qbo_entity_id: entityId,
        supplier: doc.supplier_name,
        qbo_total: qboTotalAmt,
        xml_total: expectedTotal,
        total_diff: Number(totalDiscrepancy.toFixed(2)),
        qbo_tax: qboTotalTax,
        xml_tax: expectedTax,
        tax_diff: Number(taxDiscrepancy.toFixed(2)),
        detected_at: new Date().toISOString(),
      };
      console.error(`⚠️ ${doc.doc_number}: DISCREPANCIA FORZADA ${JSON.stringify(issue)}`);
      try {
        await supabase.from('alert_history').insert({
          organization_id,
          alert_type: issue.type,
          issues_count: 1,
          issues_data: [issue],
        });
      } catch (alertErr: any) {
        console.error(`No se pudo registrar la alerta: ${alertErr?.message || alertErr}`);
      }
      // Solo el total fuera de rango bloquea (queda en revisión). IVA solo = warning.
      if (totalDiscrepancy > 1.0) {
        discrepancyMsg = `Discrepancia QBO vs XML: total QBO=${qboTotalAmt.toFixed(2)}, XML=${expectedTotal.toFixed(2)} (diff ${totalDiscrepancy.toFixed(2)}). IVA QBO=${qboTotalTax.toFixed(2)}, XML=${expectedTax.toFixed(2)} (diff ${taxDiscrepancy.toFixed(2)}). ${entityType} creado (ID ${entityId}) — revisar y republicar.`;
      }
    }

    // =============================================================
    // ADJUNTOS: XML y PDF al documento creado en QuickBooks
    // =============================================================
    let xmlAttached = false;
    let pdfAttached = false;

    if (doc.xml_attachment_url) {
      xmlAttached = await attachXmlToQuickBooks(
        doc.xml_attachment_url, entityId, entityType, doc.doc_number, realmId, accessToken, supabase
      );
    } else {
      console.log(`⚠️ ${doc.doc_number}: sin xml_attachment_url, no se adjunta XML`);
    }

    if (doc.pdf_attachment_url) {
      pdfAttached = await attachPdfToQuickBooks(
        doc.pdf_attachment_url, entityId, entityType, doc.doc_number, realmId, accessToken, supabase
      );
    } else {
      console.log(`⚠️ ${doc.doc_number}: sin pdf_attachment_url, PDF no disponible`);
    }

    // Update document status
    const { error: docUpdateError } = await supabase
      .from("processed_documents")
      .update({
        status: discrepancyMsg ? "review" : "published",
        qbo_entity_id: entityId,
        qbo_entity_type: entityType,
        qbo_realm_id: realmId,
        error_message: discrepancyMsg ?? `Publicación forzada exitosa (ID: ${entityId})`,
        processed_at: new Date().toISOString(),
      })
      .eq("id", document_id);

    if (docUpdateError) {
      console.error(`❌ ${doc.doc_number}: ${entityType} ${entityId} existe en QBO pero no se pudo actualizar el documento: ${docUpdateError.message}`);
    }

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
        error_message: discrepancyMsg,
        published_at: new Date().toISOString(),
      }, {
        onConflict: 'organization_id,clave_hacienda'
      });

    return new Response(
      JSON.stringify({
        success: !discrepancyMsg,
        message: discrepancyMsg ?? `${entityType} creado correctamente`,
        qbo_entity_id: entityId,
        qbo_entity_type: entityType,
        qbo_realm_id: realmId,
        verification: {
          qbo_total: qboTotalAmt,
          xml_total: expectedTotal,
          total_diff: Number(totalDiscrepancy.toFixed(2)),
          qbo_tax: qboTotalTax,
          xml_tax: expectedTax,
          tax_diff: Number(taxDiscrepancy.toFixed(2)),
          totals_match: totalDiscrepancy <= 1.0,
          tax_match: taxDiscrepancy <= 1.0,
        },
        attachments: {
          xml_attached: xmlAttached,
          pdf_attached: pdfAttached,
          pdf_available: !!doc.pdf_attachment_url,
          xml_available: !!doc.xml_attachment_url,
        },
        status: discrepancyMsg ? "review" : "published",
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
