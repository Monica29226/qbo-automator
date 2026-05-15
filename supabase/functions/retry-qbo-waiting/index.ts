import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Probe QBO with a lightweight CompanyInfo query
async function qboHealthy(realmId: string, accessToken: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${realmId}/companyinfo/${realmId}?minorversion=65`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }
    );
    if (res.ok) return { ok: true };
    const text = await res.text();
    return { ok: false, error: `${res.status}: ${text.substring(0, 200)}` };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // Optional: scope to a single org (for manual UI trigger)
  let targetOrg: string | null = null;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body?.organization_id) targetOrg = String(body.organization_id);
    }
  } catch (_) {}

  console.log(`🔄 retry-qbo-waiting started${targetOrg ? ` (org: ${targetOrg})` : " (all orgs)"}`);

  // Get all (org_id, count) pairs with waiting_for_qbo
  let waitQuery = supabase
    .from("processed_documents")
    .select("organization_id, id, total_amount, created_at, updated_at")
    .eq("status", "waiting_for_qbo");
  if (targetOrg) waitQuery = waitQuery.eq("organization_id", targetOrg);

  const { data: waitingDocs, error: waitErr } = await waitQuery;
  if (waitErr) {
    console.error("❌ Failed to fetch waiting docs:", waitErr);
    return new Response(JSON.stringify({ error: waitErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Group by org
  const byOrg = new Map<string, any[]>();
  for (const d of waitingDocs || []) {
    if (!d.organization_id) continue;
    const arr = byOrg.get(d.organization_id) || [];
    arr.push(d);
    byOrg.set(d.organization_id, arr);
  }

  const summary: any[] = [];
  const FORTY_EIGHT_H = 48 * 60 * 60 * 1000;
  const now = Date.now();

  for (const [orgId, docs] of byOrg.entries()) {
    console.log(`\n🏢 Org ${orgId}: ${docs.length} waiting docs`);

    // Check QBO connection
    const { data: integ } = await supabase
      .from("integration_accounts")
      .select("credentials")
      .eq("organization_id", orgId)
      .eq("service_type", "quickbooks")
      .eq("is_active", true)
      .maybeSingle();

    if (!integ?.credentials) {
      console.log(`  ⏭️  No QBO integration, skipping`);
      summary.push({ org_id: orgId, waiting: docs.length, qbo_ok: false, retried: 0, reason: "no_integration" });
      continue;
    }

    const creds = integ.credentials as any;
    const probe = await qboHealthy(creds.realm_id, creds.access_token);

    // Compute >48h critical bucket regardless of probe result
    const oldDocs = docs.filter((d) => now - new Date(d.updated_at || d.created_at).getTime() > FORTY_EIGHT_H);

    if (oldDocs.length > 5) {
      // Avoid duplicate critical alert in last 6h
      const sixHoursAgo = new Date(now - 6 * 60 * 60 * 1000).toISOString();
      const { data: existingAlert } = await supabase
        .from("alert_history")
        .select("id")
        .eq("organization_id", orgId)
        .eq("alert_type", "qbo_blocked")
        .eq("resolved", false)
        .gte("sent_at", sixHoursAgo)
        .maybeSingle();

      if (!existingAlert) {
        const totalAmount = oldDocs.reduce((s, d) => s + Number(d.total_amount || 0), 0);
        await supabase.from("alert_history").insert({
          organization_id: orgId,
          alert_type: "qbo_blocked",
          issues_count: oldDocs.length,
          issues_data: {
            severity: "critical",
            code: "qbo_blocked",
            title: `QBO bloqueado - ${oldDocs.length} facturas en espera`,
            description:
              `Hay ${oldDocs.length} facturas con más de 48h en estado "waiting_for_qbo" ` +
              `(monto total: ₡${totalAmount.toFixed(2)}). Última prueba a QBO: ${probe.ok ? "OK" : probe.error || "fallida"}. ` +
              `El sistema reintentará automáticamente cada 6 horas. Verificá la suscripción/período en QuickBooks.`,
            probe_ok: probe.ok,
            probe_error: probe.error || null,
          },
        });
        console.log(`  🚨 Alerta crítica creada (${oldDocs.length} docs >48h)`);
      }
    }

    if (!probe.ok) {
      console.log(`  ❌ QBO probe failed: ${probe.error} - skipping retry`);
      summary.push({ org_id: orgId, waiting: docs.length, qbo_ok: false, retried: 0, probe_error: probe.error });
      continue;
    }

    // Reset waiting docs back to processed and invoke publish
    const docIds = docs.map((d) => d.id);
    const { error: resetErr } = await supabase
      .from("processed_documents")
      .update({ status: "processed", error_message: null, updated_at: new Date().toISOString() })
      .in("id", docIds);

    if (resetErr) {
      console.error(`  ❌ Reset failed:`, resetErr);
      summary.push({ org_id: orgId, waiting: docs.length, qbo_ok: true, retried: 0, error: resetErr.message });
      continue;
    }

    // Fire-and-forget invocation (publish-to-quickbooks may take long)
    try {
      supabase.functions
        .invoke("publish-to-quickbooks", {
          body: { organization_id: orgId, document_ids: docIds },
        })
        .then((r) => console.log(`  ✅ publish-to-quickbooks invoked: ${JSON.stringify(r.data || r.error)}`))
        .catch((e) => console.error(`  ⚠️  invoke error:`, e));
    } catch (e) {
      console.error(`  ⚠️  invoke threw:`, e);
    }

    summary.push({ org_id: orgId, waiting: docs.length, qbo_ok: true, retried: docIds.length });
  }

  return new Response(
    JSON.stringify({ success: true, orgs_processed: summary.length, summary }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
