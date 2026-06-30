import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const fecha = yesterday.toISOString().slice(0, 10);

    const { data: integrations } = await supabase
      .from("integration_accounts")
      .select("organization_id, credentials")
      .eq("service_type", "siku")
      .eq("is_active", true);

    if (!integrations || integrations.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No hay organizaciones con Siku configurado", synced: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];
    let totalInserted = 0;

    for (const integ of integrations) {
      try {
        const resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/siku-fetch-invoices`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            organization_id: integ.organization_id,
            fecha_inicio: fecha,
            fecha_fin: fecha,
          }),
        });

        const result = await resp.json();
        totalInserted += result.inserted || 0;
        results.push({ organization_id: integ.organization_id, fecha, ...result });

        console.log(`✅ Org ${integ.organization_id}: ${result.inserted} insertadas, ${result.skipped} duplicadas`);

        if (result.inserted > 0) {
          const { data: readyInvoices } = await supabase
            .from("sales_invoices")
            .select("id")
            .eq("organization_id", integ.organization_id)
            .eq("status", "pending")
            .not("default_income_account_ref", "is", null)
            .gte("created_at", new Date().toISOString().slice(0, 10));

          if (readyInvoices && readyInvoices.length > 0) {
            await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/publish-sales-to-quickbooks`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                organization_id: integ.organization_id,
                invoice_ids: readyInvoices.map((i: any) => i.id),
              }),
            });
            console.log(`📤 Auto-publicando ${readyInvoices.length} facturas listas para org ${integ.organization_id}`);
          }
        }

        await new Promise(r => setTimeout(r, 2000));
      } catch (err: any) {
        console.error(`❌ Error syncing org ${integ.organization_id}:`, err.message);
        results.push({ organization_id: integ.organization_id, error: err.message });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      fecha,
      organizations_synced: integrations.length,
      total_inserted: totalInserted,
      results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    console.error("siku-daily-sync error:", e);
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
