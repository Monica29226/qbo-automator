import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { organization_id, bill_id, bill_ids } = await req.json();

    if (!organization_id) {
      throw new Error("organization_id es requerido");
    }

    // Support both single bill_id and array of bill_ids
    const billIdsToCheck = bill_ids || (bill_id ? [bill_id] : []);
    
    if (billIdsToCheck.length === 0) {
      throw new Error("bill_id o bill_ids es requerido");
    }

    console.log(`🔍 Verificando ${billIdsToCheck.length} Bills en QuickBooks para org: ${organization_id}`);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Obtener credenciales de QuickBooks
    const { data: integration, error: integrationError } = await supabase
      .from('integration_accounts')
      .select('credentials, account_email')
      .eq('organization_id', organization_id)
      .eq('service_type', 'quickbooks')
      .eq('is_active', true)
      .maybeSingle();

    if (integrationError) throw integrationError;
    if (!integration) {
      throw new Error("No se encontró integración activa de QuickBooks");
    }

    const credentials = integration.credentials as any;
    if (!credentials?.access_token) {
      throw new Error("No hay access_token disponible");
    }

    const realmId = credentials.realm_id;
    if (!realmId) {
      throw new Error("No se encontró realm_id en las credenciales");
    }

    const results: any[] = [];

    for (const billId of billIdsToCheck) {
      try {
        console.log(`📡 Consultando QuickBooks API para Bill ID ${billId}...`);
        
        const qboResponse = await fetch(
          `https://quickbooks.api.intuit.com/v3/company/${realmId}/bill/${billId}?minorversion=73`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${credentials.access_token}`,
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            }
          }
        );

        if (!qboResponse.ok) {
          const errorData = await qboResponse.json().catch(() => ({}));
          
          if (qboResponse.status === 401) {
            results.push({
              bill_id: billId,
              exists: false,
              error: "Token de QuickBooks expirado",
              needs_reconnect: true
            });
          } else {
            results.push({
              bill_id: billId,
              exists: false,
              error: errorData.Fault?.Error?.[0]?.Message || `HTTP ${qboResponse.status}`
            });
          }
          console.log(`❌ Bill ${billId} no encontrado: ${qboResponse.status}`);
          continue;
        }

        const qboData = await qboResponse.json();
        const bill = qboData.Bill;
        
        // Extract account details from lines
        const accountDetails = bill.Line?.map((line: any) => {
          const detail = line.AccountBasedExpenseLineDetail;
          return detail?.AccountRef ? {
            account_id: detail.AccountRef.value,
            account_name: detail.AccountRef.name,
            amount: line.Amount,
            description: line.Description?.substring(0, 100)
          } : null;
        }).filter(Boolean) || [];
        
        console.log(`✅ Bill ${billId} encontrado:`, {
          docNumber: bill.DocNumber,
          txnDate: bill.TxnDate,
          totalAmt: bill.TotalAmt,
          vendor: bill.VendorRef?.name,
          accounts: accountDetails.map((a: any) => `${a.account_name} (${a.account_id})`).join(', ')
        });

        results.push({
          bill_id: billId,
          exists: true,
          doc_number: bill.DocNumber,
          txn_date: bill.TxnDate,
          total_amount: bill.TotalAmt,
          currency: bill.CurrencyRef?.value || 'CRC',
          vendor_name: bill.VendorRef?.name,
          vendor_id: bill.VendorRef?.value,
          private_note: bill.PrivateNote?.substring(0, 200),
          accounts: accountDetails,
          global_tax_calculation: bill.GlobalTaxCalculation,
          total_tax: bill.TxnTaxDetail?.TotalTax
        });

      } catch (err: any) {
        console.error(`❌ Error verificando Bill ${billId}:`, err.message);
        results.push({
          bill_id: billId,
          exists: false,
          error: err.message
        });
      }
    }

    // Summary
    const existingBills = results.filter(r => r.exists);
    const missingBills = results.filter(r => !r.exists);
    
    console.log(`📊 Resultados: ${existingBills.length} encontrados, ${missingBills.length} no encontrados`);

    // If single bill requested, return flat response for backwards compatibility
    if (billIdsToCheck.length === 1) {
      const result = results[0];
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      organization_id,
      realm_id: realmId,
      summary: {
        total: billIdsToCheck.length,
        found: existingBills.length,
        missing: missingBills.length,
      },
      results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("❌ Error:", error.message);
    return new Response(JSON.stringify({
      exists: false,
      error: error.message,
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
