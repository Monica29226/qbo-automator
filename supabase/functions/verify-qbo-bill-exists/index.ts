import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { organization_id, bill_id } = await req.json();

    if (!organization_id || !bill_id) {
      throw new Error("organization_id y bill_id son requeridos");
    }

    console.log(`🔍 Verificando Bill ${bill_id} en QuickBooks para organización ${organization_id}`);

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

    const { data: org } = await supabase
      .from('organizations')
      .select('qbo_realm_id')
      .eq('id', organization_id)
      .single();

    if (!org?.qbo_realm_id) {
      throw new Error("No se encontró qbo_realm_id para la organización");
    }

    const realmId = org.qbo_realm_id;

    // Intentar obtener el Bill de QuickBooks
    console.log(`📡 Consultando QuickBooks API para Bill ID ${bill_id}...`);
    
    const qboResponse = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${realmId}/bill/${bill_id}?minorversion=73`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${credentials.access_token}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      }
    );

    const qboData = await qboResponse.json();

    if (!qboResponse.ok) {
      console.error("❌ Error de QuickBooks:", qboData);
      
      // Si el error es 401, el token expiró
      if (qboResponse.status === 401) {
        return new Response(
          JSON.stringify({ 
            exists: false, 
            error: "Token de QuickBooks expirado",
            needs_reconnect: true
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Si el error es que no se encontró el bill
      if (qboResponse.status === 404 || qboData.Fault?.Error?.[0]?.code === "610") {
        console.log(`❌ Bill ${bill_id} NO existe en QuickBooks`);
        return new Response(
          JSON.stringify({ 
            exists: false,
            message: `El Bill ${bill_id} no existe en QuickBooks`,
            error: qboData.Fault?.Error?.[0]?.Message || "No encontrado"
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      throw new Error(qboData.Fault?.Error?.[0]?.Message || 'Error al consultar QuickBooks');
    }

    // El bill existe
    console.log(`✅ Bill ${bill_id} SÍ existe en QuickBooks`);
    
    const bill = qboData.Bill;
    return new Response(
      JSON.stringify({ 
        exists: true,
        bill_number: bill.DocNumber,
        vendor_ref: bill.VendorRef?.name,
        total_amount: bill.TotalAmt,
        txn_date: bill.TxnDate,
        sync_token: bill.SyncToken
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error("❌ Error:", error);
    return new Response(
      JSON.stringify({ 
        exists: false,
        error: error.message 
      }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});