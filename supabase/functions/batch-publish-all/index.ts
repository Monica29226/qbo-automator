import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeOrganizationAccess } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_DOCUMENTS_PER_CANONICAL_CALL = 50;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Backend configuration is incomplete");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const organizationId = body.organization_id;
    const documentIds = Array.isArray(body.document_ids)
      ? body.document_ids.filter((id: unknown): id is string => typeof id === "string")
      : [];
    if (!organizationId) throw new Error("organization_id is required");

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const authorized = await authorizeOrganizationAccess(
      req,
      supabase,
      serviceRoleKey,
      organizationId,
    );
    if (authorized instanceof Response) return authorized;

    // This endpoint is kept as a compatibility dispatcher only. All QBO
    // creation, XML validation, duplicate checks, locking, tracking and
    // attachment handling live in publish-to-quickbooks.
    const chunks: Array<string[] | null> = documentIds.length > 0
      ? Array.from(
        { length: Math.ceil(documentIds.length / MAX_DOCUMENTS_PER_CANONICAL_CALL) },
        (_, index) => documentIds.slice(
          index * MAX_DOCUMENTS_PER_CANONICAL_CALL,
          (index + 1) * MAX_DOCUMENTS_PER_CANONICAL_CALL,
        ),
      )
      : [null];

    const aggregate = {
      success: true,
      published: 0,
      failed: 0,
      skipped: 0,
      review_count: 0,
      waiting_for_qbo: 0,
      results: [] as unknown[],
      errors: [] as unknown[],
    };

    for (const chunk of chunks) {
      const response = await fetch(`${supabaseUrl}/functions/v1/publish-to-quickbooks`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          organization_id: organizationId,
          ...(chunk ? { document_ids: chunk } : {}),
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        aggregate.success = false;
        aggregate.failed += chunk?.length || 1;
        aggregate.errors.push(result.error || `Canonical publisher returned HTTP ${response.status}`);
        continue;
      }

      aggregate.published += Number(result.published || 0);
      aggregate.failed += Number(result.failed || 0);
      aggregate.skipped += Number(result.skipped_duplicates || 0);
      aggregate.review_count += Number(result.review_count || 0);
      aggregate.waiting_for_qbo += Number(result.waiting_for_qbo || 0);
      if (Array.isArray(result.results)) aggregate.results.push(...result.results);
      if (Array.isArray(result.errors)) aggregate.errors.push(...result.errors);
      if (result.success === false) aggregate.success = false;
    }

    aggregate.success = aggregate.success && aggregate.failed === 0 && aggregate.review_count === 0;
    return new Response(JSON.stringify(aggregate), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        published: 0,
        failed: 0,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});