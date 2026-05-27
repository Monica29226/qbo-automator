import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateOrganizationRequest {
  name: string;
  identification_type?: string;
  identification_number?: string;
  trade_name?: string;
  legal_name?: string;
  tax_regime?: string;
  main_economic_activity?: string;
  economic_activity_code?: string;
  hacienda_notification_email?: string;
  email?: string;
  phone?: string;
  province?: string;
  canton?: string;
  district?: string;
  exact_address?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client with user's token
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error("Auth error:", authError);
      return new Response(
        JSON.stringify({ error: "No autorizado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const body: CreateOrganizationRequest = await req.json();
    
    // Validate required fields
    if (!body.name || body.name.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "El nombre de la empresa es requerido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📝 Creating organization "${body.name}" for user ${user.id}`);

    // Use service role for creating organization (to bypass RLS during creation)
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Check for duplicate organization name (case-insensitive)
    const { data: existingOrg, error: checkError } = await supabaseAdmin
      .from("organizations")
      .select("id, name")
      .ilike("name", body.name.trim())
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (checkError) {
      console.error("Error checking for duplicates:", checkError);
    }

    if (existingOrg) {
      console.log(`⚠️ Organization "${body.name}" already exists with id: ${existingOrg.id}`);
      return new Response(
        JSON.stringify({ error: `Ya existe una empresa con el nombre "${existingOrg.name}"` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate a UUID for the new organization
    const orgId = crypto.randomUUID();

    // 1. Create the organization
    const { error: orgError } = await supabaseAdmin
      .from("organizations")
      .insert({
        id: orgId,
        name: body.name.trim(),
        identification_type: body.identification_type || null,
        identification_number: body.identification_number || null,
        trade_name: body.trade_name || null,
        legal_name: body.legal_name || null,
        tax_regime: body.tax_regime || null,
        main_economic_activity: body.main_economic_activity || null,
        economic_activity_code: body.economic_activity_code || null,
        hacienda_notification_email: body.hacienda_notification_email || null,
        email: body.email || null,
        phone: body.phone || null,
        province: body.province || null,
        canton: body.canton || null,
        district: body.district || null,
        exact_address: body.exact_address || null,
      });

    if (orgError) {
      console.error("❌ Error creating organization:", orgError);
      return new Response(
        JSON.stringify({ error: "Error al crear la organización", details: orgError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`✅ Organization created with ID: ${orgId}`);

    // 2. Add user as owner
    const { error: memberError } = await supabaseAdmin
      .from("organization_members")
      .insert({
        organization_id: orgId,
        user_id: user.id,
        role: "owner",
      });

    if (memberError) {
      console.error("❌ Error adding member:", memberError);
      // Rollback: delete the organization
      await supabaseAdmin.from("organizations").delete().eq("id", orgId);
      return new Response(
        JSON.stringify({ error: "Error al agregar membresía", details: memberError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`✅ User ${user.id} added as owner`);

    // 3. Set as active organization
    const { error: activeError } = await supabaseAdmin
      .from("user_active_organization")
      .upsert({
        user_id: user.id,
        organization_id: orgId,
      });

    if (activeError) {
      console.warn("⚠️ Warning: Could not set active organization:", activeError);
      // Non-critical, continue
    }

    // 4. Create default system settings
    const defaultSettings = [
      { key: "qbo_company_id", value: "", description: "QuickBooks Company ID (realmId)", organization_id: orgId },
      { key: "mail_provider", value: "gmail", description: "Proveedor de correo: gmail u outlook", organization_id: orgId },
      { key: "mail_query", value: "has:attachment (filename:xml OR filename:pdf) newer_than:30d", description: "Filtro de búsqueda de correos", organization_id: orgId },
      { key: "process_credit_notes", value: "true", description: "Procesar notas de crédito automáticamente", organization_id: orgId },
      { key: "currency_fallback", value: "CRC", description: "Moneda por defecto si falta en XML", organization_id: orgId },
      { key: "duplicate_window_days", value: "120", description: "Ventana anti-duplicados en días", organization_id: orgId },
      { key: "dry_run", value: "true", description: "Modo prueba (no publica en QBO)", organization_id: orgId },
      { key: "email_sender_address", value: "ACL Invoice <onboarding@resend.dev>", description: "Dirección del remitente para emails de invitación", organization_id: orgId },
    ];

    const { error: settingsError } = await supabaseAdmin
      .from("system_settings")
      .insert(defaultSettings);

    if (settingsError) {
      console.warn("⚠️ Warning: Could not create default settings:", settingsError);
      // Non-critical, continue
    }

    // 5. Create default billing sequences
    const defaultSequences = [
      { organization_id: orgId, doc_type: "FE", branch_code: "001", terminal_code: "00001", next_number: 1 },
      { organization_id: orgId, doc_type: "NC", branch_code: "001", terminal_code: "00001", next_number: 1 },
      { organization_id: orgId, doc_type: "ND", branch_code: "001", terminal_code: "00001", next_number: 1 },
      { organization_id: orgId, doc_type: "TE", branch_code: "001", terminal_code: "00001", next_number: 1 },
    ];

    const { error: seqError } = await supabaseAdmin
      .from("billing_sequences")
      .insert(defaultSequences);

    if (seqError) {
      console.warn("⚠️ Warning: Could not create billing sequences:", seqError);
      // Non-critical, continue
    }

    console.log(`✅ Organization ${orgId} fully created with defaults`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        organization_id: orgId,
        message: "Empresa creada exitosamente"
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("❌ Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Error del servidor", details: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
