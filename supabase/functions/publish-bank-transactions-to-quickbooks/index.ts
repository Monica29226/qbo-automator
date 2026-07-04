import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeOrganizationAccess } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Deterministic short tag so repeated publish attempts for the same row
// never create a second Deposit/Purchase in QBO, even if our own DB write
// failed right after QBO accepted the transaction.
function docTagFor(itemId: string): string {
  return `BK-${itemId.replace(/-/g, "").slice(0, 12)}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { organization_id, job_id, item_ids } = await req.json();
    console.log("📤 Publishing bank transactions to QuickBooks:", { organization_id, job_id, item_ids });

    if (!organization_id || !job_id) {
      throw new Error("organization_id and job_id are required");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authorized = await authorizeOrganizationAccess(req, supabase, supabaseKey, organization_id);
    if (authorized instanceof Response) return authorized;

    // QuickBooks credentials (kept fresh by auto-renew-tokens cron)
    const { data: qbIntegration, error: qbError } = await supabase
      .from("integration_accounts")
      .select("credentials")
      .eq("organization_id", organization_id)
      .eq("service_type", "quickbooks")
      .eq("is_active", true)
      .single();

    if (qbError || !qbIntegration) {
      throw new Error("QuickBooks not connected");
    }

    const { access_token, realm_id } = qbIntegration.credentials as any;

    // Which QBO bank account these rows post to
    const { data: job, error: jobError } = await supabase
      .from("bank_import_jobs")
      .select("*, bank_import_configs(qbo_bank_account_id, qbo_bank_account_name, bank_name)")
      .eq("id", job_id)
      .eq("organization_id", organization_id)
      .single();

    if (jobError || !job) throw new Error("Bank import job not found");

    const bankAccountId = job.bank_import_configs?.qbo_bank_account_id;
    if (!bankAccountId) {
      throw new Error(
        `El banco "${job.bank_import_configs?.bank_name || ""}" no tiene una cuenta de QuickBooks asignada. Configúrala primero en Estados de Cuenta → Configuración.`
      );
    }

    // Eligible rows: valid, categorized, not yet published (or previously failed)
    let itemsQuery = supabase
      .from("bank_import_job_items")
      .select("*")
      .eq("bank_import_job_id", job_id)
      .eq("organization_id", organization_id)
      .in("status", ["VALID", "PUBLISH_ERROR"])
      .is("qbo_entity_id", null);

    if (item_ids && item_ids.length > 0) {
      itemsQuery = itemsQuery.in("id", item_ids);
    }

    const { data: items, error: itemsError } = await itemsQuery;
    if (itemsError) throw itemsError;

    const uncategorized = (items || []).filter((i: any) => !i.category_account_id);
    const toPublish = (items || []).filter((i: any) => !!i.category_account_id);

    let published = 0;
    let failed = 0;
    const errors: any[] = [];

    for (const item of toPublish) {
      const docTag = docTagFor(item.id);
      const isDeposit = Number(item.money_in) > 0;
      const entityType = isDeposit ? "Deposit" : "Purchase";

      try {
        // Duplicate guard: a prior attempt may have reached QBO but failed
        // to write back to our DB (network blip, function timeout, etc.)
        const dupUrl = `https://quickbooks.api.intuit.com/v3/company/${realm_id}/query?query=${encodeURIComponent(
          `SELECT Id FROM ${entityType} WHERE DocNumber = '${docTag}'`
        )}&minorversion=65`;
        const dupResponse = await fetch(dupUrl, {
          headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" },
        });
        const dupData = dupResponse.ok ? await dupResponse.json() : null;
        const existingId = dupData?.QueryResponse?.[entityType]?.[0]?.Id;

        let qboId: string;

        if (existingId) {
          qboId = existingId;
          console.log(`↩️ ${docTag}: ya existía en QuickBooks (${entityType} ${qboId}), no se duplica`);
        } else {
          const description = [item.reference, item.description].filter(Boolean).join(" - ") || undefined;

          const payload = isDeposit
            ? {
                DepositToAccountRef: { value: bankAccountId },
                TxnDate: item.transaction_date,
                DocNumber: docTag,
                PrivateNote: description,
                Line: [
                  {
                    Amount: Number(item.money_in),
                    DetailType: "DepositLineDetail",
                    Description: description,
                    DepositLineDetail: { AccountRef: { value: item.category_account_id } },
                  },
                ],
              }
            : {
                PaymentType: "Cash",
                AccountRef: { value: bankAccountId },
                TxnDate: item.transaction_date,
                DocNumber: docTag,
                PrivateNote: description,
                Line: [
                  {
                    Amount: Number(item.money_out),
                    DetailType: "AccountBasedExpenseLineDetail",
                    Description: description,
                    AccountBasedExpenseLineDetail: { AccountRef: { value: item.category_account_id } },
                  },
                ],
              };

          const createUrl = `https://quickbooks.api.intuit.com/v3/company/${realm_id}/${entityType.toLowerCase()}?minorversion=65`;
          const createResponse = await fetch(createUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${access_token}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(payload),
          });

          if (!createResponse.ok) {
            const errText = await createResponse.text();
            throw new Error(`QuickBooks error: ${errText}`);
          }

          const created = await createResponse.json();
          qboId = created[entityType].Id;
          console.log(`✅ ${docTag}: ${entityType} ${qboId} creado en QuickBooks`);
        }

        await supabase
          .from("bank_import_job_items")
          .update({
            status: "PUBLISHED",
            qbo_entity_id: qboId,
            qbo_entity_type: entityType,
            qbo_realm_id: realm_id,
            published_at: new Date().toISOString(),
            publish_error: null,
          })
          .eq("id", item.id);

        published++;
        await delay(1000); // rate limiting
      } catch (error: any) {
        console.error(`❌ ${docTag}: publish failed:`, error);
        failed++;
        errors.push({ item_id: item.id, description: item.description, error: error.message });

        await supabase
          .from("bank_import_job_items")
          .update({ status: "PUBLISH_ERROR", publish_error: error.message })
          .eq("id", item.id);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        published,
        failed,
        skipped_uncategorized: uncategorized.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("❌ Publish bank transactions error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
