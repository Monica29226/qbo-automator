import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface VendorRule {
  vendor_name: string;
  account_code: string;
  account_description: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user auth
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      throw new Error("Invalid authorization");
    }

    const { organization_id, rules } = await req.json() as {
      organization_id: string;
      rules: VendorRule[];
    };

    if (!organization_id || !rules || !Array.isArray(rules)) {
      throw new Error("Missing required parameters");
    }

    console.log(`Importing ${rules.length} vendor rules for organization ${organization_id}`);

    // Verificar que el usuario sea admin de la organización
    const { data: membership, error: memberError } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", organization_id)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();

    if (memberError || !membership || !["owner", "admin"].includes(membership.role)) {
      throw new Error("User is not an admin of this organization");
    }

    // Preparar reglas para inserción
    const rulesToInsert = rules
      .filter(r => r.vendor_name && r.account_code) // Solo reglas válidas
      .map(rule => ({
        organization_id,
        vendor_name: rule.vendor_name.trim(),
        account_code: rule.account_code.split(":")[0].trim(), // Solo el código
        account_description: rule.account_code,
        created_by: user.id,
      }));

    console.log(`Prepared ${rulesToInsert.length} valid rules for insertion`);

    // Desactivar reglas existentes para esta organización
    await supabase
      .from("vendor_classification_rules")
      .update({ is_active: false })
      .eq("organization_id", organization_id);

    // Insertar nuevas reglas en batches de 100
    const batchSize = 100;
    let insertedCount = 0;

    for (let i = 0; i < rulesToInsert.length; i += batchSize) {
      const batch = rulesToInsert.slice(i, i + batchSize);
      
      const { error: insertError } = await supabase
        .from("vendor_classification_rules")
        .upsert(batch, {
          onConflict: "organization_id,vendor_name",
        });

      if (insertError) {
        console.error("Error inserting batch:", insertError);
        throw insertError;
      }

      insertedCount += batch.length;
      console.log(`Inserted batch ${Math.floor(i / batchSize) + 1}, total: ${insertedCount}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        inserted: insertedCount,
        message: `Successfully imported ${insertedCount} vendor classification rules`,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in import-vendor-rules:", error);
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
