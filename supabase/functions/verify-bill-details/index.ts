import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    let body: any = null;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Cuerpo de solicitud inválido" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    const { organization_id, bill_id } = body ?? {};

    if (!organization_id || bill_id === undefined || bill_id === null) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "organization_id y bill_id son requeridos",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    const billId = String(bill_id).trim();
    if (!/^\d+$/.test(billId)) {
      return new Response(
        JSON.stringify({
          success: false,
          error:
            "El ID del Bill en QuickBooks debe ser numérico (ej: 38876). No uses la Clave de 50 dígitos.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Get QuickBooks credentials
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
    const accessToken = credentials.access_token;
    const realmId = credentials.realm_id;

    // Fetch bill details from QuickBooks
    const billUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/bill/${billId}`;
    const billResponse = await fetch(billUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!billResponse.ok) {
      throw new Error(`Failed to fetch bill: ${await billResponse.text()}`);
    }

    const billData = await billResponse.json();
    const bill = billData.Bill;

    // Extract line details
    const lineDetails = bill.Line?.map((line: any) => {
      const detail = line.AccountBasedExpenseLineDetail;
      return {
        amount: line.Amount,
        description: line.Description,
        accountRef: detail?.AccountRef?.value,
        accountName: detail?.AccountRef?.name,
        taxCodeRef: detail?.TaxCodeRef?.value,
      };
    });

    // Fetch account details for each line
    const accountDetails = [];
    for (const line of lineDetails || []) {
      if (line.accountRef) {
        const accountUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/account/${line.accountRef}`;
        const accountResponse = await fetch(accountUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        });

        if (accountResponse.ok) {
          const accountData = await accountResponse.json();
          accountDetails.push({
            id: accountData.Account.Id,
            name: accountData.Account.Name,
            acctNum: accountData.Account.AcctNum,
            accountType: accountData.Account.AccountType,
          });
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        bill: {
          id: bill.Id,
          docNumber: bill.DocNumber,
          txnDate: bill.TxnDate,
          totalAmt: bill.TotalAmt,
          vendorRef: bill.VendorRef,
          lineCount: bill.Line?.length || 0,
        },
        lines: lineDetails,
        accounts: accountDetails,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error("Error in verify-bill-details:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
