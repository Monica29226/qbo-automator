import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Autenticar usuario
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (authError || !user) {
      throw new Error("Authentication failed");
    }

    const { organization_id } = await req.json();

    if (!organization_id) {
      throw new Error("organization_id is required");
    }

    console.log(`Starting credit notes republish for organization: ${organization_id}`);

    // Obtener integración de QuickBooks
    const { data: qboAccount } = await supabase
      .from("integration_accounts")
      .select("credentials")
      .eq("organization_id", organization_id)
      .eq("service_type", "quickbooks")
      .eq("is_active", true)
      .maybeSingle();

    if (!qboAccount) {
      throw new Error("QuickBooks not connected");
    }

    const credentials = qboAccount.credentials as any;
    let accessToken = credentials.access_token;
    const refreshToken = credentials.refresh_token;
    const realmId = credentials.realm_id;
    const expiresAt = credentials.expires_at;

    // Refresh token si está expirado
    if (new Date(expiresAt) < new Date()) {
      console.log("Refreshing QuickBooks access token");
      const tokenResponse = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${btoa(`${Deno.env.get("QBO_CLIENT_ID")}:${Deno.env.get("QBO_CLIENT_SECRET")}`)}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error("Failed to refresh QuickBooks token");
      }

      const tokens = await tokenResponse.json();
      accessToken = tokens.access_token;

      // Actualizar tokens en DB
      await supabase
        .from("integration_accounts")
        .update({
          credentials: {
            ...credentials,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          },
        })
        .eq("organization_id", organization_id)
        .eq("service_type", "quickbooks");
    }

    // Buscar notas de crédito publicadas (con qbo_entity_id)
    // Include both old "NC" type and new "NotaCreditoElectronica" type
    const { data: creditNotes, error: docError } = await supabase
      .from("processed_documents")
      .select("*")
      .eq("organization_id", organization_id)
      .in("doc_type", ["NC", "NotaCreditoElectronica"])
      .eq("status", "published")
      .not("qbo_entity_id", "is", null)
      .limit(100);

    if (docError) throw docError;

    if (!creditNotes || creditNotes.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "No se encontraron notas de crédito para republicar", 
          processed: 0 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${creditNotes.length} credit notes to republish`);

    const results = {
      processed: 0,
      deleted: 0,
      republished: 0,
      failed: 0,
      errors: [] as any[],
    };

    // Procesar cada nota de crédito
    for (const doc of creditNotes) {
      try {
        console.log(`Processing credit note: ${doc.doc_number} with QBO ID: ${doc.qbo_entity_id} (type: ${doc.qbo_entity_type})`);
        
        // Paso 1: Eliminar el Bill o VendorCredit existente de QuickBooks
        try {
          const entityType = doc.qbo_entity_type || "Bill"; // Default to Bill for old records
          const entityEndpoint = entityType === "VendorCredit" ? "vendorcredit" : "bill";
          
          // Primero obtener la entidad actual para tener el SyncToken
          const getUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/${entityEndpoint}/${doc.qbo_entity_id}?minorversion=65`;
          const getResponse = await fetch(getUrl, {
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Accept": "application/json",
            },
          });

          if (getResponse.ok) {
            const entityData = await getResponse.json();
            const entity = entityData[entityType === "VendorCredit" ? "VendorCredit" : "Bill"];
            const syncToken = entity?.SyncToken;
            
            if (syncToken) {
              // Eliminar la entidad
              const deletePayload = {
                Id: doc.qbo_entity_id,
                SyncToken: syncToken,
              };

              const deleteUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/${entityEndpoint}?operation=delete&minorversion=65`;
              const deleteResponse = await fetch(deleteUrl, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${accessToken}`,
                  "Accept": "application/json",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(deletePayload),
              });

              if (deleteResponse.ok) {
                console.log(`✓ Deleted ${entityType} ${doc.doc_number} from QuickBooks`);
                results.deleted++;
              } else {
                const errorText = await deleteResponse.text();
                console.error(`Failed to delete ${entityType}: ${errorText}`);
                throw new Error(`Failed to delete ${entityType}: ${errorText}`);
              }
            }
          } else {
            console.warn(`${entityType} ${doc.qbo_entity_id} not found in QuickBooks, will republish anyway`);
          }
        } catch (deleteError) {
          console.error(`Error deleting entity for ${doc.doc_number}:`, deleteError);
          // Continuar de todos modos para intentar republicar
        }

        // Paso 2: Marcar como "processed" en la DB para que pueda republicarse
        await supabase
          .from("processed_documents")
          .update({
            status: "processed",
            qbo_entity_id: null,
            qbo_entity_type: null,
            error_message: null,
          })
          .eq("id", doc.id);

        results.processed++;
        
      } catch (error) {
        console.error(`Error processing credit note ${doc.doc_number}:`, error);
        results.failed++;
        results.errors.push({
          doc_number: doc.doc_number,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // Paso 3: Invocar publish-to-quickbooks para republicar con montos negativos
    console.log(`Invoking publish-to-quickbooks to republish credit notes...`);
    
    try {
      const { data: publishData, error: publishError } = await supabase.functions.invoke(
        "publish-to-quickbooks",
        {
          body: { organization_id },
          headers: {
            Authorization: authHeader,
          },
        }
      );

      if (publishError) {
        console.error("Error invoking publish-to-quickbooks:", publishError);
      } else {
        results.republished = publishData?.published || 0;
        console.log(`✓ Republished ${results.republished} credit notes`);
      }
    } catch (publishError) {
      console.error("Error calling publish-to-quickbooks:", publishError);
    }

    const summary = {
      success: true,
      processed: results.processed,
      deleted: results.deleted,
      republished: results.republished,
      failed: results.failed,
      errors: results.errors,
      message: `Procesadas ${results.processed} NC: ${results.deleted} eliminadas, ${results.republished} republicadas, ${results.failed} fallidas`,
    };

    console.log("Credit notes republish completed:", summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in republish-credit-notes:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
