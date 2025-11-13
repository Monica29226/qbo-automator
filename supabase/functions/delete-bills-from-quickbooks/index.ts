import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization")!;
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { organization_id, document_ids } = await req.json();

    if (!organization_id || !document_ids || !Array.isArray(document_ids)) {
      throw new Error("organization_id and document_ids array are required");
    }

    console.log(`🗑️ Starting deletion for ${document_ids.length} documents`);

    // Obtener credenciales de QuickBooks
    const { data: integration } = await supabase
      .from("integration_accounts")
      .select("credentials")
      .eq("organization_id", organization_id)
      .eq("service_type", "quickbooks")
      .eq("is_active", true)
      .single();

    if (!integration?.credentials) {
      throw new Error("QuickBooks integration not found");
    }

    const credentials = integration.credentials as any;
    let accessToken = credentials.access_token;
    const realmId = credentials.realmId;

    // Refrescar token si es necesario
    if (credentials.expires_at && new Date(credentials.expires_at) < new Date()) {
      console.log("🔄 Refreshing access token...");
      const tokenResponse = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${btoa(`${Deno.env.get("QBO_CLIENT_ID")}:${Deno.env.get("QBO_CLIENT_SECRET")}`)}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credentials.refresh_token,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error("Failed to refresh QuickBooks token");
      }

      const tokenData = await tokenResponse.json();
      accessToken = tokenData.access_token;

      await supabase
        .from("integration_accounts")
        .update({
          credentials: {
            ...credentials,
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
          },
        })
        .eq("organization_id", organization_id)
        .eq("service_type", "quickbooks");
    }

    const results = {
      deleted: 0,
      failed: 0,
      errors: [] as any[],
    };

    // Obtener documentos
    const { data: documents } = await supabase
      .from("processed_documents")
      .select("*")
      .eq("organization_id", organization_id)
      .in("id", document_ids);

    if (!documents || documents.length === 0) {
      throw new Error("No documents found");
    }

    for (const doc of documents) {
      try {
        if (!doc.qbo_entity_id) {
          console.log(`⏩ Skipping ${doc.doc_number} - not in QuickBooks`);
          continue;
        }

        console.log(`🗑️ Deleting bill ${doc.doc_number} (QBO ID: ${doc.qbo_entity_id})`);

        // Primero obtener el syncToken actual del bill
        const billGetResponse = await fetch(
          `https://quickbooks.api.intuit.com/v3/company/${realmId}/bill/${doc.qbo_entity_id}`,
          {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Accept": "application/json",
            },
          }
        );

        if (!billGetResponse.ok) {
          const errorMsg = `Failed to get bill: ${billGetResponse.status} ${billGetResponse.statusText}`;
          console.error(errorMsg);
          throw new Error(errorMsg);
        }

        const billData = await billGetResponse.json();
        const syncToken = billData.Bill.SyncToken;

        // Ahora eliminar el bill
        const deleteResponse = await fetch(
          `https://quickbooks.api.intuit.com/v3/company/${realmId}/bill?operation=delete`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Accept": "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              Id: doc.qbo_entity_id,
              SyncToken: syncToken,
            }),
          }
        );

        if (!deleteResponse.ok) {
          const errorMsg = `Failed to delete bill: ${deleteResponse.status} ${deleteResponse.statusText}`;
          console.error(errorMsg);
          throw new Error(errorMsg);
        }

        console.log(`✅ Deleted bill ${doc.doc_number} from QuickBooks`);

        // Limpiar campos en la base de datos
        await supabase
          .from("processed_documents")
          .update({
            qbo_entity_id: null,
            qbo_entity_type: null,
            error_message: null,
            status: 'processed',
          })
          .eq("id", doc.id);

        console.log(`✅ Cleaned database entry for ${doc.doc_number}`);

        results.deleted++;
      } catch (error) {
        console.error(`❌ Error deleting document ${doc.doc_number}:`, error);
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        
        results.failed++;
        results.errors.push({
          doc_number: doc.doc_number,
          error: errorMessage,
        });
      }
    }

    console.log(`✅ Deletion complete: ${results.deleted} deleted, ${results.failed} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        deleted: results.deleted,
        failed: results.failed,
        errors: results.errors.length > 0 ? results.errors : undefined,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in delete-bills-from-quickbooks:", error);
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
