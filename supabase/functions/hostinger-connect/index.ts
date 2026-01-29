import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing required environment variables");
    }

    const { 
      organization_id, 
      user_id, 
      email, 
      password, 
      imap_host, 
      imap_port 
    } = await req.json();
    
    if (!organization_id || !user_id || !email || !password) {
      throw new Error("Missing required parameters");
    }

    // Default IMAP settings for Hostinger
    // Hostinger uses imap.hostinger.com on port 993 with SSL
    const host = imap_host || "imap.hostinger.com";
    const port = imap_port || 993;

    console.log(`[Hostinger] Connecting for organization: ${organization_id}, email: ${email}`);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Store credentials in integration_accounts (encrypted by Supabase)
    const credentials = {
      email,
      password,
      imap_host: host,
      imap_port: port,
      imap_secure: true,
    };

    // Check if there's an existing hostinger account for this org
    const { data: existing } = await supabase
      .from("integration_accounts")
      .select("id")
      .eq("organization_id", organization_id)
      .eq("service_type", "hostinger")
      .maybeSingle();

    if (existing) {
      // Update existing
      const { error: updateError } = await supabase
        .from("integration_accounts")
        .update({
          account_email: email,
          account_name: `Hostinger - ${email}`,
          credentials,
          is_active: true,
          created_by: user_id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (updateError) {
        console.error("[Hostinger] Error updating integration account:", updateError);
        throw updateError;
      }
    } else {
      // Insert new
      const { error: insertError } = await supabase
        .from("integration_accounts")
        .insert({
          organization_id,
          service_type: "hostinger",
          account_email: email,
          account_name: `Hostinger - ${email}`,
          credentials,
          is_active: true,
          created_by: user_id,
        });

      if (insertError) {
        console.error("[Hostinger] Error inserting integration account:", insertError);
        throw insertError;
      }
    }

    // Update organization
    const { error: updateError } = await supabase
      .from("organizations")
      .update({
        hostinger_connected: true,
        hostinger_email: email,
        updated_at: new Date().toISOString(),
      })
      .eq("id", organization_id);

    if (updateError) {
      console.error("[Hostinger] Error updating organization:", updateError);
      throw updateError;
    }

    console.log(`[Hostinger] Connected successfully for ${email}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        email,
        message: "Hostinger conectado exitosamente" 
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("[Hostinger] Error in hostinger-connect:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
