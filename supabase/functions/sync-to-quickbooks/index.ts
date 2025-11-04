import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
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
    const { organization_id, realm_id, bill_preview } = await req.json();

    if (!organization_id || !realm_id || !bill_preview) {
      throw new Error("Faltan parámetros requeridos");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Syncing to QuickBooks: ${bill_preview.consecutivo}`);

    // Obtener tokens de QuickBooks
    const { data: account } = await supabase
      .from("integration_accounts")
      .select("credentials")
      .eq("organization_id", organization_id)
      .eq("service_type", "quickbooks")
      .eq("is_active", true)
      .single();

    if (!account) {
      throw new Error("No se encontró cuenta de QuickBooks activa");
    }

    const credentials = account.credentials as any;
    const accessToken = credentials.access_token;

    // 1. Verificar duplicados
    const docNumber = bill_preview.consecutivo;
    const entityType = bill_preview.tipo === "NOTA_CREDITO" ? "VendorCredit" : "Bill";
    
    console.log(`Checking for duplicates: ${entityType} ${docNumber}`);
    
    const duplicateQuery = `SELECT * FROM ${entityType} WHERE DocNumber = '${docNumber}'`;
    const duplicateCheckUrl = `https://quickbooks.api.intuit.com/v3/company/${realm_id}/query?query=${encodeURIComponent(duplicateQuery)}`;
    
    const duplicateResponse = await fetch(duplicateCheckUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!duplicateResponse.ok) {
      console.error("Error checking duplicates:", await duplicateResponse.text());
    } else {
      const duplicateData = await duplicateResponse.json();
      if (duplicateData.QueryResponse?.[entityType]?.length > 0) {
        const existing = duplicateData.QueryResponse[entityType][0];
        return new Response(
          JSON.stringify({
            error: "Duplicado encontrado",
            isDuplicate: true,
            existingId: existing.Id,
            message: `Ya existe ${entityType} con número ${docNumber}`,
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // 2. Buscar/Crear Vendor
    console.log(`Looking for vendor: ${bill_preview.cedula}`);
    
    const vendorQuery = `SELECT * FROM Vendor WHERE AcctNum = '${bill_preview.cedula}'`;
    const vendorSearchUrl = `https://quickbooks.api.intuit.com/v3/company/${realm_id}/query?query=${encodeURIComponent(vendorQuery)}`;
    
    const vendorSearchResponse = await fetch(vendorSearchUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    let vendorId;
    
    if (vendorSearchResponse.ok) {
      const vendorData = await vendorSearchResponse.json();
      const vendors = vendorData.QueryResponse?.Vendor || [];
      
      if (vendors.length > 0) {
        vendorId = vendors[0].Id;
        console.log(`Vendor found: ${vendorId}`);
      }
    }

    // Crear vendor si no existe
    if (!vendorId) {
      console.log("Creating new vendor");
      
      const vendorCreateUrl = `https://quickbooks.api.intuit.com/v3/company/${realm_id}/vendor`;
      const vendorBody = {
        DisplayName: bill_preview.proveedor,
        AcctNum: bill_preview.cedula,
        CompanyName: bill_preview.proveedor,
        PrimaryEmailAddr: {
          Address: bill_preview.mapping?.cuentaGasto || "",
        },
        CurrencyRef: {
          value: bill_preview.moneda,
        },
      };

      const vendorCreateResponse = await fetch(vendorCreateUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(vendorBody),
      });

      if (!vendorCreateResponse.ok) {
        const errorText = await vendorCreateResponse.text();
        throw new Error(`Error creating vendor: ${errorText}`);
      }

      const vendorResult = await vendorCreateResponse.json();
      vendorId = vendorResult.Vendor.Id;
      console.log(`Vendor created: ${vendorId}`);
    }

    // 3. Crear Bill o Vendor Credit
    console.log(`Creating ${entityType}`);
    
    const lines = bill_preview.lineas.map((linea: any) => ({
      DetailType: "AccountBasedExpenseLineDetail",
      Amount: linea.cantidad * linea.precioUnitario - (linea.descuentoLinea || 0),
      AccountBasedExpenseLineDetail: {
        AccountRef: {
          value: bill_preview.mapping?.cuentaGasto || "1", // Default expense account
        },
        TaxCodeRef: {
          value: linea.gravado ? `TAX_${linea.tasaIVA}` : "NON", // Simplificado
        },
      },
      Description: linea.descripcion,
    }));

    const billBody = {
      VendorRef: {
        value: vendorId,
      },
      DocNumber: docNumber,
      TxnDate: bill_preview.fecha,
      Line: lines,
      CurrencyRef: {
        value: bill_preview.moneda,
      },
      ...(bill_preview.moneda !== "CRC" && {
        ExchangeRate: 1, // TODO: Obtener tipo de cambio real
      }),
    };

    const createUrl = `https://quickbooks.api.intuit.com/v3/company/${realm_id}/${entityType.toLowerCase()}`;
    const createResponse = await fetch(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(billBody),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error("Error creating bill/credit:", errorText);
      throw new Error(`Error creating ${entityType}: ${errorText}`);
    }

    const createResult = await createResponse.json();
    const entityId = createResult[entityType].Id;

    console.log(`${entityType} created successfully: ${entityId}`);

    // TODO: 4. Adjuntar PDF (requiere upload del PDF primero)

    return new Response(
      JSON.stringify({
        success: true,
        entityType,
        entityId,
        docNumber,
        vendorId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error in sync-to-quickbooks:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
