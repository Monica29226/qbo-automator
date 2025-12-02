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

    // Default IMAP settings for Bluehost
    const host = imap_host || "mail.bluehost.com";
    const port = imap_port || 993;

    console.log(`Connecting Bluehost for organization: ${organization_id}, email: ${email}`);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Store credentials in integration_accounts (encrypted by Supabase)
    const credentials = {
      email,
      password, // In production, consider additional encryption
      imap_host: host,
      imap_port: port,
      imap_secure: true,
    };

    // Upsert integration account
    const { error: upsertError } = await supabase
      .from("integration_accounts")
      .upsert({
        organization_id,
        service_type: "bluehost",
        account_email: email,
        account_name: `Bluehost - ${email}`,
        credentials,
        is_active: true,
        created_by: user_id,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "organization_id,service_type",
      });

    if (upsertError) {
      console.error("Error upserting integration account:", upsertError);
      throw upsertError;
    }

    // Update organization
    const { error: updateError } = await supabase
      .from("organizations")
      .update({
        bluehost_connected: true,
        bluehost_email: email,
        updated_at: new Date().toISOString(),
      })
      .eq("id", organization_id);

    if (updateError) {
      console.error("Error updating organization:", updateError);
      throw updateError;
    }

    console.log(`Bluehost connected successfully for ${email}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        email,
        message: "Bluehost conectado exitosamente" 
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in bluehost-connect:", error);
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
