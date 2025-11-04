import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateOrgRequest {
  name: string;
  email?: string;
  user_id: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { name, email, user_id }: CreateOrgRequest = await req.json();

    if (!name || !user_id) {
      return new Response(
        JSON.stringify({ error: "name and user_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Crear organización usando service role (bypasa RLS)
    const { data: newOrg, error: orgError } = await supabase
      .from("organizations")
      .insert([{
        name,
        email: email || null,
      }])
      .select()
      .single();

    if (orgError) {
      console.error("Error creating organization:", orgError);
      return new Response(
        JSON.stringify({ error: "Failed to create organization", details: orgError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Agregar usuario como owner
    const { error: memberError } = await supabase
      .from("organization_members")
      .insert([{
        organization_id: newOrg.id,
        user_id: user_id,
        role: 'owner'
      }]);

    if (memberError) {
      console.error("Error adding member:", memberError);
      return new Response(
        JSON.stringify({ error: "Failed to add member", details: memberError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Establecer como organización activa
    const { error: activeError } = await supabase
      .from("user_active_organization")
      .upsert({
        user_id: user_id,
        organization_id: newOrg.id
      }, {
        onConflict: 'user_id'
      });

    if (activeError) {
      console.error("Error setting active org:", activeError);
    }

    // Crear settings por defecto para la organización
    const defaultSettings = [
      { key: 'qbo_company_id', value: '', description: 'QuickBooks Company ID (realmId)', organization_id: newOrg.id },
      { key: 'mail_provider', value: 'gmail', description: 'Proveedor de correo: gmail u outlook', organization_id: newOrg.id },
      { key: 'mail_query', value: 'has:attachment (filename:xml OR filename:pdf) newer_than:30d', description: 'Filtro de búsqueda de correos', organization_id: newOrg.id },
      { key: 'process_credit_notes', value: 'true', description: 'Procesar notas de crédito automáticamente', organization_id: newOrg.id },
      { key: 'currency_fallback', value: 'CRC', description: 'Moneda por defecto si falta en XML', organization_id: newOrg.id },
      { key: 'duplicate_window_days', value: '120', description: 'Ventana anti-duplicados en días', organization_id: newOrg.id },
      { key: 'dry_run', value: 'true', description: 'Modo prueba (no publica en QBO)', organization_id: newOrg.id }
    ];

    await supabase
      .from("system_settings")
      .insert(defaultSettings);

    console.log("Organization created successfully:", newOrg.id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        organization: newOrg 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in create-organization:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
