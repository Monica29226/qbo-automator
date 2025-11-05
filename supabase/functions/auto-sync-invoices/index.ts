import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("Starting automatic invoice sync...");

    // Obtener todas las organizaciones activas con Gmail y QuickBooks conectados
    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, name")
      .eq("gmail_connected", true)
      .eq("quickbooks_connected", true)
      .eq("is_active", true);

    if (!orgs || orgs.length === 0) {
      console.log("No organizations with both Gmail and QuickBooks connected");
      return new Response(
        JSON.stringify({ message: "No organizations to sync" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results = [];

    for (const org of orgs) {
      console.log(`Processing organization: ${org.name} (${org.id})`);

      try {
        // 1. Fetch invoices from Gmail
        console.log(`Fetching Gmail invoices for ${org.name}...`);
        const gmailResponse = await fetch(
          `${supabaseUrl}/functions/v1/gmail-fetch-invoices`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ organization_id: org.id }),
          }
        );

        if (!gmailResponse.ok) {
          throw new Error(`Gmail fetch failed: ${await gmailResponse.text()}`);
        }

        const gmailData = await gmailResponse.json();
        console.log(`Gmail sync for ${org.name}: ${gmailData.invoices_processed} processed, ${gmailData.invoices_failed} failed`);

        // 2. Publish to QuickBooks (si hay facturas procesadas)
        if (gmailData.invoices_processed > 0) {
          console.log(`Publishing to QuickBooks for ${org.name}...`);
          
          // Esperar un poco para asegurar que las facturas están en la BD
          await new Promise(resolve => setTimeout(resolve, 2000));

          const qboResponse = await fetch(
            `${supabaseUrl}/functions/v1/publish-to-quickbooks`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${supabaseKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ organization_id: org.id }),
            }
          );

          if (!qboResponse.ok) {
            throw new Error(`QuickBooks publish failed: ${await qboResponse.text()}`);
          }

          const qboData = await qboResponse.json();
          console.log(`QuickBooks sync for ${org.name}: ${qboData.published} published, ${qboData.failed} failed`);

          results.push({
            organization_id: org.id,
            organization_name: org.name,
            gmail_processed: gmailData.invoices_processed,
            gmail_failed: gmailData.invoices_failed,
            qbo_published: qboData.published,
            qbo_failed: qboData.failed,
            status: "success",
          });
        } else {
          results.push({
            organization_id: org.id,
            organization_name: org.name,
            gmail_processed: 0,
            status: "no_new_invoices",
          });
        }
      } catch (error) {
        console.error(`Error processing organization ${org.name}:`, error);
        results.push({
          organization_id: org.id,
          organization_name: org.name,
          status: "error",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    console.log("Auto-sync completed:", results);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Auto-sync completed",
        organizations_processed: orgs.length,
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in auto-sync-invoices:", error);
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
