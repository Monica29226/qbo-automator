// Test: validates the reconnect path on integration_accounts does not
// trigger the integration_accounts_org_service_unique constraint.
//
// We cannot run the full OAuth callback (no real Intuit code), so we
// replicate the post-token-exchange persistence logic — the exact code
// path that previously raised "Unknown error" on reconnect.

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

assert(SUPABASE_URL, "Missing SUPABASE_URL / VITE_SUPABASE_URL");
assert(SERVICE_ROLE_KEY, "Missing SUPABASE_SERVICE_ROLE_KEY");

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function persistQuickbooksIntegration(organization_id: string, realmId: string) {
  const payload = {
    organization_id,
    service_type: "quickbooks",
    account_name: `QuickBooks (${realmId})`,
    is_active: true,
    credentials: {
      access_token: "test-access",
      refresh_token: "test-refresh",
      expires_at: Date.now() + 3_600_000,
      realm_id: realmId,
    },
    updated_at: new Date().toISOString(),
  };

  const { data: existing, error: selectError } = await admin
    .from("integration_accounts")
    .select("id")
    .eq("organization_id", organization_id)
    .eq("service_type", "quickbooks");

  if (selectError) throw selectError;

  if (existing && existing.length > 0) {
    const { error } = await admin
      .from("integration_accounts")
      .update(payload)
      .eq("id", existing[0].id);
    if (error) throw error;
    return { operation: "update" as const, id: existing[0].id };
  }

  const { data, error } = await admin
    .from("integration_accounts")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw error;
  return { operation: "insert" as const, id: data.id };
}

Deno.test("OAuth reconnect does not raise duplicate constraint error", async () => {
  // Create a temporary org for isolation
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: `oauth-test-${Date.now()}` })
    .select("id")
    .single();
  if (orgError) throw orgError;
  const orgId = org.id as string;

  try {
    // 1st connection (insert path)
    const first = await persistQuickbooksIntegration(orgId, "9999000000000001");
    assertEquals(first.operation, "insert");

    // 2nd connection — same org, different realm (reconnect / update path)
    const second = await persistQuickbooksIntegration(orgId, "9999000000000002");
    assertEquals(second.operation, "update");
    assertEquals(second.id, first.id, "Reconnect must update the same row, not insert a new one");

    // 3rd connection — repeat to ensure idempotency
    const third = await persistQuickbooksIntegration(orgId, "9999000000000002");
    assertEquals(third.operation, "update");
    assertEquals(third.id, first.id);

    // Verify exactly one row exists for this org+service
    const { data: rows, error: countErr } = await admin
      .from("integration_accounts")
      .select("id, credentials")
      .eq("organization_id", orgId)
      .eq("service_type", "quickbooks");
    if (countErr) throw countErr;
    assertEquals(rows?.length, 1, "Must be exactly one integration row after reconnects");
    assertEquals((rows![0].credentials as any).realm_id, "9999000000000002");
  } finally {
    // Cleanup
    await admin.from("integration_accounts").delete().eq("organization_id", orgId);
    await admin.from("organizations").delete().eq("id", orgId);
  }
});
