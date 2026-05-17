import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMAIL_SERVICE_TYPES = ["gmail", "outlook", "outlook_imap", "hostinger", "bluehost"];

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
      .select("id,name,identification_type,identification_number,email,default_account_ref")
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

    // Source of truth for connections: integration_accounts (NOT the flags on organizations)
    const { data: integrations } = await supabase
      .from("integration_accounts")
      .select("service_type, account_email, credentials, updated_at")
      .eq("organization_id", organization_id)
      .eq("is_active", true);

    const integrationsList = integrations ?? [];
    const qboAccount = integrationsList.find((i) => i.service_type === "quickbooks");
    const emailAccounts = integrationsList.filter((i) => EMAIL_SERVICE_TYPES.includes(i.service_type));

    // Build a normalized email accounts payload incl. last_test_success_at
    const emailAccountsPayload = emailAccounts.map((a) => {
      const creds = (a.credentials || {}) as Record<string, unknown>;
      const lastTest = (creds.last_test_success_at as string | undefined) || a.updated_at;
      return {
        service_type: a.service_type,
        account_email: a.account_email,
        last_test_success_at: lastTest,
      };
    });

    // Determine freshness across all email accounts (info only, no score penalty)
    const now = Date.now();
    const freshestMs = emailAccountsPayload.reduce<number | null>((max, a) => {
      if (!a.last_test_success_at) return max;
      const t = new Date(a.last_test_success_at).getTime();
      return max === null || t > max ? t : max;
    }, null);
    const lastTestAgeHours = freshestMs ? (now - freshestMs) / 3_600_000 : null;
    const emailFresh = lastTestAgeHours !== null && lastTestAgeHours < 48;
    const emailStaleWarning = emailAccounts.length > 0 && lastTestAgeHours !== null && lastTestAgeHours > 48
      ? `Última sincronización exitosa hace ${Math.round(lastTestAgeHours / 24)} días`
      : null;

    const checks = {
      basic: !!(org.name && org.identification_type && org.identification_number && org.email),
      quickbooks: !!qboAccount,
      email: emailAccounts.length > 0, // presence wins
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
    if (!checks.email) pending.push({ category: "email", message: "Conectar al menos un correo (Gmail, Outlook, Microsoft 365 IMAP, Hostinger o Bluehost)", severity: "high" });
    if (!checks.defaultAccount) pending.push({ category: "defaultAccount", message: "Configurar cuenta contable por defecto", severity: "medium" });
    if (!checks.ivaMode) pending.push({ category: "ivaMode", message: "Definir modo de IVA (recuperable / gasto)", severity: "medium" });
    if (!checks.rules) pending.push({ category: "rules", message: "Agregar reglas de proveedores frecuentes", severity: "low" });
    if (emailStaleWarning) pending.push({ category: "emailFresh", message: emailStaleWarning, severity: "low" });

    return new Response(
      JSON.stringify({
        success: true,
        score,
        checks,
        pending,
        onboarding: progress ?? null,
        completed: !!progress?.completed_at,
        email_accounts: emailAccountsPayload,
        email_fresh: emailFresh,
        last_email_test_hours: lastTestAgeHours,
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
