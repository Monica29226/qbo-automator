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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { organization_id, month, year } = await req.json();
    if (!organization_id) throw new Error("organization_id required");

    // Verificar autorización: o service role key o usuario autenticado
    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === supabaseKey;
    
    if (!isServiceRole) {
      // Si no es service role, validar que sea un usuario autenticado
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) throw new Error("Invalid authorization");
    }

    console.log(`Fetching Gmail invoices for organization ${organization_id}${month && year ? ` (${year}-${month.toString().padStart(2, '0')})` : ''}`);

    // Obtener cuenta de Gmail activa
    const { data: gmailAccount, error: accountError } = await supabase
      .from("integration_accounts")
      .select("*")
      .eq("organization_id", organization_id)
      .eq("service_type", "gmail")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (accountError || !gmailAccount) {
      throw new Error("No active Gmail account found");
    }

    const credentials = gmailAccount.credentials as any;
    if (!credentials?.access_token) {
      throw new Error("No access token found");
    }

    // Verificar si el token está expirado y renovarlo si es necesario
    let accessToken = credentials.access_token;
    if (credentials.expires_at && Date.now() > credentials.expires_at) {
      console.log("Access token expired, refreshing...");
      
      const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
      const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

      const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: credentials.refresh_token,
          grant_type: "refresh_token",
        }),
      });

      if (!refreshResponse.ok) {
        throw new Error("Failed to refresh token");
      }

      const newTokens = await refreshResponse.json();
      accessToken = newTokens.access_token;

      // Actualizar tokens en DB
      await supabase
        .from("integration_accounts")
        .update({
          credentials: {
            ...credentials,
            access_token: newTokens.access_token,
            expires_at: Date.now() + (newTokens.expires_in * 1000),
          },
        })
        .eq("id", gmailAccount.id);
    }

    // Obtener settings de búsqueda
    const { data: settings } = await supabase
      .from("system_settings")
      .select("key, value")
      .eq("organization_id", organization_id)
      .in("key", ["mail_query"]);

    // Construir query de Gmail con filtro de fecha personalizado si se proporciona
    let mailQuery: string;
    
    if (month && year) {
      // Calcular el primer y último día del mes
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0); // Último día del mes
      
      const formatDate = (date: Date) => {
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return `${yyyy}/${mm}/${dd}`;
      };
      
      mailQuery = `has:attachment (filename:xml OR filename:pdf) after:${formatDate(startDate)} before:${formatDate(endDate)}`;
      console.log(`Using custom date range query for ${year}-${month}: ${mailQuery}`);
    } else {
      mailQuery = settings?.find(s => s.key === "mail_query")?.value || 
        "has:attachment (filename:xml OR filename:pdf) newer_than:3d";
      console.log(`Using default Gmail query: ${mailQuery}`);
    }

    // Buscar mensajes en Gmail
    const searchResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(mailQuery)}&maxResults=50`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!searchResponse.ok) {
      throw new Error("Failed to search Gmail messages");
    }

    const searchData = await searchResponse.json();
    const messages = searchData.messages || [];
    
    console.log(`Found ${messages.length} messages matching query`);

    // Obtener reglas de clasificación
    const { data: rules } = await supabase
      .from("vendor_classification_rules")
      .select("vendor_name, account_code, account_description")
      .eq("organization_id", organization_id)
      .eq("is_active", true);

    const categories = rules?.map(r => 
      `${r.vendor_name}: ${r.account_code} - ${r.account_description}`
    ).join(", ") || "";

    const processedInvoices = [];
    const errors = [];

    // Helper para validar y limpiar fechas
    const parseIssueDate = (dateString: string): string | null => {
      if (!dateString || dateString.trim() === "") return null;
      
      const invalidDates = ["no procede", "n/a", "no aplica", "na", "null", "undefined"];
      if (invalidDates.includes(dateString.toLowerCase().trim())) return null;
      
      try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return null;
        return date.toISOString().split("T")[0];
      } catch {
        return null;
      }
    };

    // Procesar cada mensaje - Reducir a 10 para evitar timeout
    for (const message of messages.slice(0, 10)) {
      try {
        const messageResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );

        if (!messageResponse.ok) continue;

        const messageData = await messageResponse.json();
        const parts = messageData.payload?.parts || [];

        // Buscar archivos adjuntos XML
        for (const part of parts) {
          if (part.filename?.toLowerCase().endsWith(".xml")) {
            const attachmentId = part.body?.attachmentId;
            if (!attachmentId) continue;

            try {
              // Descargar archivo adjunto
              const attachmentResponse = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}/attachments/${attachmentId}`,
                {
                  headers: { Authorization: `Bearer ${accessToken}` },
                }
              );

              if (!attachmentResponse.ok) continue;

              const attachmentData = await attachmentResponse.json();
              const xmlContent = atob(attachmentData.data.replace(/-/g, "+").replace(/_/g, "/"));

              console.log(`Processing invoice: ${part.filename}`);

              // Extraer datos con IA
              const extractResponse = await fetch(
                `${supabaseUrl}/functions/v1/extract-invoice-data`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${supabaseKey}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    xmlContent,
                    categories,
                  }),
                }
              );

              if (!extractResponse.ok) {
                const errorText = await extractResponse.text();
                console.error(`AI extraction failed for ${part.filename}:`, errorText);
                errors.push({ filename: part.filename, error: "AI extraction failed" });
                continue;
              }

              const extractResult = await extractResponse.json();
              
              if (!extractResult.success || !extractResult.data) {
                console.error(`Invalid AI response for ${part.filename}`);
                errors.push({ filename: part.filename, error: "Invalid AI response" });
                continue;
              }

              const invoiceData = extractResult.data;

              // Verificar duplicados
              const docKey = invoiceData.numeroConsecutivo;
              const { data: existingDoc } = await supabase
                .from("processed_documents")
                .select("id")
                .eq("doc_key", docKey)
                .eq("organization_id", organization_id)
                .maybeSingle();

              if (existingDoc) {
                console.log(`Duplicate invoice: ${part.filename}`);
                errors.push({ filename: part.filename, error: "Duplicate" });
                continue;
              }

              // Validar y limpiar fecha
              const issueDate = parseIssueDate(invoiceData.fechaEmision);
              if (!issueDate) {
                console.error(`Invalid date for ${part.filename}: ${invoiceData.fechaEmision}`);
                errors.push({ filename: part.filename, error: `Invalid date: ${invoiceData.fechaEmision}` });
                continue;
              }

              // Guardar en base de datos
              const { data: savedDoc, error: saveError } = await supabase
                .from("processed_documents")
                .insert({
                  doc_key: docKey,
                  doc_type: invoiceData.esNotaCredito ? "NotaCreditoElectronica" : "FacturaElectronica",
                  doc_number: invoiceData.numeroConsecutivo,
                  issue_date: issueDate,
                  supplier_name: invoiceData.emisor.nombre,
                  supplier_tax_id: invoiceData.emisor.identificacion,
                  supplier_email: invoiceData.emisor.correo || null,
                  currency: invoiceData.moneda,
                  total_amount: invoiceData.totalComprobante,
                  total_tax: invoiceData.detalle.reduce((sum: number, d: any) => 
                    sum + (d.montoTotalLinea * d.tarifa / 100), 0),
                  total_discount: invoiceData.detalle.reduce((sum: number, d: any) => 
                    sum + d.montoDescuento, 0),
                  status: invoiceData.aceptada ? "processed" : "rejected",
                  xml_data: invoiceData,
                  organization_id,
                })
                .select()
                .single();

              if (saveError) {
                console.error(`Error saving ${part.filename}:`, saveError);
                errors.push({ filename: part.filename, error: saveError.message });
              } else {
                console.log(`Successfully processed: ${part.filename}`);
                processedInvoices.push({
                  filename: part.filename,
                  doc_id: savedDoc.id,
                  supplier: invoiceData.emisor.nombre,
                  amount: invoiceData.totalComprobante,
                });
              }
            } catch (xmlError) {
              console.error(`Error processing XML ${part.filename}:`, xmlError);
              errors.push({ 
                filename: part.filename, 
                error: xmlError instanceof Error ? xmlError.message : "Unknown error" 
              });
            }
          }
        }
      } catch (error) {
        console.error(`Error processing message ${message.id}:`, error);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        messages_found: messages.length,
        invoices_processed: processedInvoices.length,
        invoices_failed: errors.length,
        invoices: processedInvoices,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in gmail-fetch-invoices:", error);
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
