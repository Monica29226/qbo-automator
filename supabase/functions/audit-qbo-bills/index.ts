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
    const { organization_id, limit = 100 } = await req.json();

    if (!organization_id) {
      throw new Error("organization_id es requerido");
    }

    console.log(`🔍 Auditando Bills en QuickBooks para org: ${organization_id}`);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Obtener documentos published con qbo_entity_id
    const { data: publishedDocs, error: docsError } = await supabase
      .from('processed_documents')
      .select('id, doc_number, supplier_name, qbo_entity_id, qbo_entity_type, total_amount, currency, issue_date')
      .eq('organization_id', organization_id)
      .eq('status', 'published')
      .not('qbo_entity_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (docsError) throw docsError;

    if (!publishedDocs || publishedDocs.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "No hay documentos publicados para auditar",
        summary: { total: 0, found: 0, missing: 0 },
        results: []
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`📊 Auditando ${publishedDocs.length} documentos...`);

    // Obtener credenciales de QuickBooks
    const { data: integration, error: integrationError } = await supabase
      .from('integration_accounts')
      .select('credentials')
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
    let found = 0;
    let missing = 0;

    // Verificar cada documento
    for (const doc of publishedDocs) {
      try {
        const qboResponse = await fetch(
          `https://quickbooks.api.intuit.com/v3/company/${realmId}/bill/${doc.qbo_entity_id}?minorversion=73`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${credentials.access_token}`,
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            }
          }
        );

        if (qboResponse.ok) {
          found++;
          results.push({
            ...doc,
            exists_in_qbo: true
          });
        } else {
          missing++;
          const errorData = await qboResponse.json().catch(() => ({}));
          results.push({
            ...doc,
            exists_in_qbo: false,
            qbo_error: errorData.Fault?.Error?.[0]?.Message || `HTTP ${qboResponse.status}`
          });
          console.log(`❌ Bill ${doc.qbo_entity_id} (${doc.doc_number}) NO existe en QBO`);
        }

        // Pequeña pausa para no saturar API
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (err: any) {
        missing++;
        results.push({
          ...doc,
          exists_in_qbo: false,
          qbo_error: err.message
        });
      }
    }

    console.log(`📊 Resultado: ${found} encontrados, ${missing} faltantes`);

    return new Response(JSON.stringify({
      success: true,
      organization_id,
      realm_id: realmId,
      summary: {
        total: publishedDocs.length,
        found,
        missing
      },
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error("❌ Error:", error.message);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
