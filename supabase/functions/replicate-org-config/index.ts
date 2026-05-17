import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const IVA_KEYS = ["default_uses_tax", "tax_handling_mode", "iva_recoverable_default"];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { source_org_id, target_org_id, confirm } = await req.json();
    if (!source_org_id || !target_org_id) return json({ error: "source_org_id and target_org_id required" }, 400);
    if (source_org_id === target_org_id) return json({ error: "source and target must differ" }, 400);
    if (!confirm) return json({ error: "confirm: true required" }, 400);

    // Caller must be admin of both
    const { data: memberships } = await admin
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .in("organization_id", [source_org_id, target_org_id]);

    const isAdmin = (oid: string) =>
      (memberships || []).some(
        (m: any) => m.organization_id === oid && ["owner", "admin"].includes(m.role)
      );
    if (!isAdmin(source_org_id) || !isAdmin(target_org_id)) {
      return json({ error: "Admin role required in both organizations" }, 403);
    }

    const report: Record<string, number> = {
      vendor_defaults_copied: 0,
      legacy_mappings_copied: 0,
      iva_settings_copied: 0,
    };

    // 1) vendor_defaults — skip if target already has same vendor_name
    const { data: srcVendors } = await admin
      .from("vendor_defaults")
      .select("vendor_name, default_account_ref, default_uses_tax")
      .eq("organization_id", source_org_id);

    const { data: existingTargetVendors } = await admin
      .from("vendor_defaults")
      .select("vendor_name")
      .eq("organization_id", target_org_id);

    const existing = new Set((existingTargetVendors || []).map((v: any) => v.vendor_name.toLowerCase()));
    const toInsert = (srcVendors || []).filter((v: any) => !existing.has(v.vendor_name.toLowerCase()));
    if (toInsert.length) {
      const { error } = await admin.from("vendor_defaults").insert(
        toInsert.map((v: any) => ({ ...v, organization_id: target_org_id }))
      );
      if (!error) report.vendor_defaults_copied = toInsert.length;
    }

    // 2) legacy_account_mapping
    const { data: srcLegacy } = await admin
      .from("legacy_account_mapping")
      .select("legacy_account_code, qbo_account_id, qbo_account_name")
      .eq("organization_id", source_org_id);

    const { data: existingTargetLegacy } = await admin
      .from("legacy_account_mapping")
      .select("legacy_account_code")
      .eq("organization_id", target_org_id);

    const existingCodes = new Set((existingTargetLegacy || []).map((l: any) => l.legacy_account_code));
    const legacyToInsert = (srcLegacy || []).filter((l: any) => !existingCodes.has(l.legacy_account_code));
    if (legacyToInsert.length) {
      const { error } = await admin.from("legacy_account_mapping").insert(
        legacyToInsert.map((l: any) => ({ ...l, organization_id: target_org_id }))
      );
      if (!error) report.legacy_mappings_copied = legacyToInsert.length;
    }

    // 3) system_settings — only IVA keys
    const { data: srcSettings } = await admin
      .from("system_settings")
      .select("key, value, description")
      .eq("organization_id", source_org_id)
      .in("key", IVA_KEYS);

    for (const s of srcSettings || []) {
      const { error } = await admin
        .from("system_settings")
        .upsert(
          { organization_id: target_org_id, key: s.key, value: s.value, description: s.description },
          { onConflict: "organization_id,key" }
        );
      if (!error) report.iva_settings_copied++;
    }

    return json({ success: true, report });
  } catch (e: any) {
    console.error("replicate-org-config error:", e);
    return json({ error: e?.message || String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
