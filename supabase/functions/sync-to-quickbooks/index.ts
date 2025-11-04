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
    const { organization_id, document_id } = await req.json();

    if (!organization_id || !document_id) {
      return new Response(
        JSON.stringify({ error: "organization_id y document_id son requeridos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Obtener cuenta de QuickBooks activa
    const { data: qbAccount, error: accountError } = await supabase
      .from("integration_accounts")
      .select("*")
      .eq("organization_id", organization_id)
      .eq("service_type", "quickbooks")
      .eq("is_active", true)
      .single();

    if (accountError || !qbAccount) {
      return new Response(
        JSON.stringify({ error: "No hay cuenta de QuickBooks conectada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const credentials = qbAccount.credentials as any;
    let accessToken = credentials.access_token;
    const realmId = credentials.realm_id;

    // Verificar si el token expiró y renovarlo
    if (credentials.expires_at && Date.now() > credentials.expires_at) {
      console.log("QuickBooks access token expired, refreshing...");
      
      const { data: oauthCreds } = await supabase
        .from("oauth_credentials")
        .select("client_id, client_secret")
        .eq("organization_id", organization_id)
        .eq("provider", "quickbooks")
        .single();

      if (oauthCreds && credentials.refresh_token) {
        const authString = btoa(`${oauthCreds.client_id}:${oauthCreds.client_secret}`);
        
        const refreshResponse = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": `Basic ${authString}`,
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: credentials.refresh_token,
          }),
        });

        if (refreshResponse.ok) {
          const tokens = await refreshResponse.json();
          accessToken = tokens.access_token;
          
          // Actualizar tokens
          await supabase
            .from("integration_accounts")
            .update({
              credentials: {
                ...credentials,
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                expires_at: Date.now() + (tokens.expires_in * 1000),
              },
            })
            .eq("id", qbAccount.id);
        }
      }
    }

    // Obtener el documento a procesar
    const { data: document, error: docError } = await supabase
      .from("processed_documents")
      .select("*")
      .eq("id", document_id)
      .single();

    if (docError || !document) {
      return new Response(
        JSON.stringify({ error: "Documento no encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Buscar o crear el vendor en QuickBooks
    let vendorId = document.qbo_entity_id;

    if (!vendorId) {
      // Buscar vendor por nombre o tax ID
      const queryResponse = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(
          `SELECT * FROM Vendor WHERE DisplayName = '${document.supplier_name}'`
        )}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        }
      );

      if (queryResponse.ok) {
        const queryData = await queryResponse.json();
        const vendors = queryData.QueryResponse?.Vendor || [];
        
        if (vendors.length > 0) {
          vendorId = vendors[0].Id;
        } else {
          // Crear nuevo vendor
          const createVendorResponse = await fetch(
            `https://quickbooks.api.intuit.com/v3/company/${realmId}/vendor`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({
                DisplayName: document.supplier_name,
                CompanyName: document.supplier_name,
                PrimaryEmailAddr: document.supplier_email ? { Address: document.supplier_email } : undefined,
              }),
            }
          );

          if (createVendorResponse.ok) {
            const vendorData = await createVendorResponse.json();
            vendorId = vendorData.Vendor.Id;
          }
        }
      }
    }

    // Crear la factura (Bill) en QuickBooks
    const billData = {
      VendorRef: {
        value: vendorId,
      },
      TxnDate: document.issue_date,
      DocNumber: document.doc_number,
      TotalAmt: document.total_amount,
      Line: [
        {
          DetailType: "AccountBasedExpenseLineDetail",
          Amount: document.total_amount,
          AccountBasedExpenseLineDetail: {
            AccountRef: {
              value: "1", // Default expense account
            },
          },
        },
      ],
    };

    const createBillResponse = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${realmId}/bill`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(billData),
      }
    );

    if (!createBillResponse.ok) {
      const errorText = await createBillResponse.text();
      console.error("QuickBooks API error:", errorText);
      
      // Actualizar estado del documento
      await supabase
        .from("processed_documents")
        .update({
          status: "error",
          error_message: `Error al crear factura en QuickBooks: ${errorText}`,
        })
        .eq("id", document_id);

      return new Response(
        JSON.stringify({ error: "Error al crear factura en QuickBooks" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const billResult = await createBillResponse.json();

    // Actualizar documento con ID de QuickBooks
    await supabase
      .from("processed_documents")
      .update({
        status: "processed",
        qbo_entity_id: billResult.Bill.Id,
        qbo_entity_type: "Bill",
        processed_at: new Date().toISOString(),
      })
      .eq("id", document_id);

    return new Response(
      JSON.stringify({
        success: true,
        bill_id: billResult.Bill.Id,
        vendor_id: vendorId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in sync-to-quickbooks:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
