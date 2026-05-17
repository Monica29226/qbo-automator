import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) throw new Error("Unauthorized");

    const { organization_id } = await req.json();
    if (!organization_id) throw new Error("organization_id is required");

    // Verify membership
    const { data: member } = await supabase
      .from("organization_members")
      .select("id")
      .eq("organization_id", organization_id)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!member) throw new Error("Not a member of this organization");

    const { data: org } = await supabase
      .from("organizations")
      .select("id,name,identification_type,identification_number,email,quickbooks_connected,gmail_connected,outlook_connected,hostinger_connected,bluehost_connected,default_account_ref")
      .eq("id", organization_id)
      .maybeSingle();
    if (!org) throw new Error("Organization not found");

    const { data: progress } = await supabase
      .from("onboarding_progress")
      .select("*")
      .eq("organization_id", organization_id)
      .maybeSingle();

    const { data: settings } = await supabase
      .from("system_settings")
      .select("key,value")
      .eq("organization_id", organization_id);

    const settingsMap = new Map((settings ?? []).map((s) => [s.key, s.value]));

    const { count: rulesCount } = await supabase
      .from("vendor_classification_rules")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization_id);

    const checks = {
      basic: !!(org.name && org.identification_type && org.identification_number && org.email),
      quickbooks: !!org.quickbooks_connected,
      email: !!(org.gmail_connected || org.outlook_connected || org.hostinger_connected || org.bluehost_connected),
      defaultAccount: !!org.default_account_ref,
      ivaMode: settingsMap.has("default_uses_tax"),
      rules: (rulesCount ?? 0) > 0,
    };

    const weights = { basic: 25, quickbooks: 25, email: 20, defaultAccount: 15, ivaMode: 10, rules: 5 };
    let score = 0;
    for (const [k, ok] of Object.entries(checks)) {
      if (ok) score += (weights as any)[k] ?? 0;
    }

    const pending: Array<{ category: string; message: string; severity: "high" | "medium" | "low" }> = [];
    if (!checks.basic) pending.push({ category: "basic", message: "Faltan datos básicos (nombre, identificación o email)", severity: "high" });
    if (!checks.quickbooks) pending.push({ category: "quickbooks", message: "Conectar QuickBooks Online", severity: "high" });
    if (!checks.email) pending.push({ category: "email", message: "Conectar al menos un correo (Gmail, Outlook o IMAP)", severity: "high" });
    if (!checks.defaultAccount) pending.push({ category: "defaultAccount", message: "Configurar cuenta contable por defecto", severity: "medium" });
    if (!checks.ivaMode) pending.push({ category: "ivaMode", message: "Definir modo de IVA (recuperable / gasto)", severity: "medium" });
    if (!checks.rules) pending.push({ category: "rules", message: "Agregar reglas de proveedores frecuentes", severity: "low" });

    return new Response(
      JSON.stringify({
        success: true,
        score,
        checks,
        pending,
        onboarding: progress ?? null,
        completed: !!progress?.completed_at,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("validate-org-setup error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
