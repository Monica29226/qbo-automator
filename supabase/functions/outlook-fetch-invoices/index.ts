import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
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

    const { organization_id, month, year, force_resync } = await req.json();
    if (!organization_id) throw new Error("organization_id required");
    
    console.log(`📧 Outlook Fetch: org=${organization_id}, force_resync=${force_resync}`);

    // Verificar autorización
    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === supabaseKey;
    
    if (!isServiceRole) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) throw new Error("Invalid authorization");
    }

    // Obtener cuenta de Outlook activa
    const { data: outlookAccount, error: accountError } = await supabase
      .from("integration_accounts")
      .select("*")
      .eq("organization_id", organization_id)
      .eq("service_type", "outlook")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (accountError || !outlookAccount) {
      throw new Error("No active Outlook account found");
    }

    const credentials = outlookAccount.credentials as any;
    if (!credentials?.access_token) {
      throw new Error("No access token found");
    }

    // Función para renovar el token de Outlook
    const refreshOutlookToken = async (): Promise<string> => {
      console.log("🔄 Attempting to refresh Outlook access token...");
      
      const MICROSOFT_CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID");
      const MICROSOFT_CLIENT_SECRET = Deno.env.get("MICROSOFT_CLIENT_SECRET");

      if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET) {
        throw new Error("Microsoft OAuth credentials not configured");
      }

      if (!credentials.refresh_token) {
        await markAccountAsDisconnected("No refresh token available");
        throw new Error("No refresh token - please reconnect Outlook");
      }

      try {
        const refreshResponse = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: MICROSOFT_CLIENT_ID,
            client_secret: MICROSOFT_CLIENT_SECRET,
            refresh_token: credentials.refresh_token,
            grant_type: "refresh_token",
          }),
        });

        if (!refreshResponse.ok) {
          const errorText = await refreshResponse.text();
          console.error("❌ Token refresh failed:", refreshResponse.status, errorText);
          
          if (refreshResponse.status === 400 || refreshResponse.status === 401) {
            await markAccountAsDisconnected("Token inválido o revocado");
            throw new Error("Outlook token revoked - please reconnect");
          }
          
          throw new Error(`Token refresh failed: ${refreshResponse.status}`);
        }

        const refreshData = await refreshResponse.json();
        const newExpiresAt = Date.now() + (refreshData.expires_in * 1000);

        await supabase
          .from("integration_accounts")
          .update({
            credentials: {
              ...credentials,
              access_token: refreshData.access_token,
              refresh_token: refreshData.refresh_token || credentials.refresh_token,
              expires_at: newExpiresAt,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", outlookAccount.id);

        console.log("✅ Outlook token refreshed successfully");
        return refreshData.access_token;
      } catch (error) {
        console.error("❌ Token refresh error:", error);
        throw error;
      }
    };

    // Función para marcar la cuenta como desconectada
    const markAccountAsDisconnected = async (reason: string) => {
      console.log("🔌 Marking Outlook account as disconnected:", reason);
      
      try {
        await supabase
          .from("integration_accounts")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq("id", outlookAccount.id);

        await supabase
          .from("organizations")
          .update({ outlook_connected: false, outlook_email: null })
          .eq("id", organization_id);

        await supabase.from("alert_history").insert({
          organization_id,
          alert_type: "critical",
          issues_count: 1,
          issues_data: [{
            type: "critical",
            title: "Outlook desconectado automáticamente",
            description: reason,
            actionRequired: "Reconectar Outlook en Configuración > Integraciones",
            timestamp: new Date().toISOString()
          }]
        });
      } catch (dbError) {
        console.error("⚠️ Failed to mark account as disconnected:", dbError);
      }
    };

    // Verificar si el token está expirado y renovarlo
    let accessToken = credentials.access_token;
    const expiresAt = typeof credentials.expires_at === 'string' 
      ? new Date(credentials.expires_at).getTime() 
      : credentials.expires_at;
    
    const hoursUntilExpiration = expiresAt ? (expiresAt - Date.now()) / (1000 * 60 * 60) : null;
    
    if (hoursUntilExpiration !== null && hoursUntilExpiration < 2) {
      try {
        accessToken = await refreshOutlookToken();
      } catch (refreshError) {
        console.error("❌ Token refresh failed:", refreshError);
        throw refreshError;
      }
    }

    // Construir filtro de fecha para Microsoft Graph
    let dateFilter = "";
    if (month && year) {
      const startDate = new Date(year, month - 1, 1).toISOString();
      const endDate = new Date(year, month, 0, 23, 59, 59).toISOString();
      dateFilter = ` and receivedDateTime ge ${startDate} and receivedDateTime le ${endDate}`;
    } else {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      dateFilter = ` and receivedDateTime ge ${threeDaysAgo}`;
    }

    // Límite de tiempo para evitar timeouts
    const MAX_EXECUTION_TIME_MS = 120000;
    const executionStartTime = Date.now();
    let wasTimeLimitReached = false;

    // Buscar mensajes con adjuntos en Outlook usando Microsoft Graph
    const searchUrl = `https://graph.microsoft.com/v1.0/me/messages?$filter=hasAttachments eq true${dateFilter}&$select=id,subject,receivedDateTime,from&$top=50&$orderby=receivedDateTime desc`;
    
    console.log(`📡 Searching Outlook: ${searchUrl}`);
    
    let searchResponse = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    // Si falla con 401, intentar renovar y reintentar
    if (!searchResponse.ok && searchResponse.status === 401) {
      console.log("⚠️ Outlook API returned 401, attempting token refresh...");
      accessToken = await refreshOutlookToken();
      searchResponse = await fetch(searchUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    }

    if (!searchResponse.ok) {
      const errorBody = await searchResponse.text();
      console.error("❌ Outlook API error:", searchResponse.status, errorBody);
      throw new Error(`Outlook API error: ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();
    const messages = searchData.value || [];
    
    console.log(`Found ${messages.length} messages with attachments`);

    const processedInvoices: any[] = [];
    const skippedInvoices: any[] = [];
    const errors: any[] = [];

    // Helper para validar fechas
    const parseIssueDate = (dateString: string): string | null => {
      if (!dateString || dateString.trim() === "") return null;
      try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return null;
        return date.toISOString().split("T")[0];
      } catch {
        return null;
      }
    };

    // Procesar cada mensaje
    for (const message of messages) {
      const elapsedTime = Date.now() - executionStartTime;
      if (elapsedTime > MAX_EXECUTION_TIME_MS) {
        console.log(`⏱️ Time limit reached. Processed: ${processedInvoices.length}`);
        wasTimeLimitReached = true;
        break;
      }

      try {
        // Obtener adjuntos del mensaje
        const attachmentsUrl = `https://graph.microsoft.com/v1.0/me/messages/${message.id}/attachments`;
        const attachmentsResponse = await fetch(attachmentsUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!attachmentsResponse.ok) continue;

        const attachmentsData = await attachmentsResponse.json();
        const attachments = attachmentsData.value || [];

        // Filtrar XMLs de factura (excluir respuestas de Hacienda)
        const xmlAttachments = attachments.filter((att: any) => {
          const filename = att.name?.toUpperCase() || '';
          if (!filename.endsWith('.XML')) return false;
          if (filename.startsWith('AHC-') || filename.startsWith('RMH-') || 
              filename.startsWith('MH-') || filename.includes('RESPUESTA') || 
              filename.includes('HACIENDA')) {
            console.log(`⏭️ Ignorando respuesta de Hacienda: ${att.name}`);
            return false;
          }
          return true;
        });

        const pdfAttachment = attachments.find((att: any) => 
          att.name?.toLowerCase().endsWith('.pdf')
        );

        if (xmlAttachments.length === 0) {
          console.log(`📭 No invoice XMLs in message ${message.id}`);
          continue;
        }

        // Procesar cada XML de factura
        for (const xmlAtt of xmlAttachments) {
          try {
            // Microsoft Graph devuelve contentBytes en base64, decodificar a UTF-8 para tildes
            const binaryString = atob(xmlAtt.contentBytes);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const xmlContent = new TextDecoder('utf-8').decode(bytes);
            console.log(`Processing invoice: ${xmlAtt.name}`);

            // Descargar y guardar PDF si existe
            let pdfUrl = null;
            if (pdfAttachment?.contentBytes) {
              try {
                const pdfBase64 = pdfAttachment.contentBytes;
                const pdfBinary = atob(pdfBase64);
                const pdfBytes = new Uint8Array(pdfBinary.length);
                for (let i = 0; i < pdfBinary.length; i++) {
                  pdfBytes[i] = pdfBinary.charCodeAt(i);
                }

                const docNumberMatch = xmlContent.match(/<NumeroConsecutivo>(.*?)<\/NumeroConsecutivo>/);
                const docNumber = docNumberMatch ? docNumberMatch[1] : `invoice_${Date.now()}`;
                
                const pdfPath = `${organization_id}/${docNumber}.pdf`;
                const { error: uploadError } = await supabase.storage
                  .from("company-documents")
                  .upload(pdfPath, pdfBytes, {
                    contentType: "application/pdf",
                    upsert: true
                  });

                if (!uploadError) {
                  const { data: urlData } = supabase.storage
                    .from("company-documents")
                    .getPublicUrl(pdfPath);
                  pdfUrl = urlData.publicUrl;
                  console.log(`✓ PDF saved: ${pdfPath}`);
                }
              } catch (pdfError) {
                console.error(`Error saving PDF:`, pdfError);
              }
            }

            // Procesar documento con process-document-xml
            const processResponse = await fetch(
              `${supabaseUrl}/functions/v1/process-document-xml`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${supabaseKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  organization_id,
                  xml_content: xmlContent,
                  pdf_attachment_url: pdfUrl,
                  file_path: xmlAtt.name,
                }),
              }
            );

            if (!processResponse.ok) {
              const errorText = await processResponse.text();
              console.error(`XML processing failed for ${xmlAtt.name}:`, errorText);
              errors.push({ filename: xmlAtt.name, error: "XML processing failed" });
              continue;
            }

            const processResult = await processResponse.json();
            
            if (!processResult.success) {
              const errorMsg = processResult.error || processResult.message;
              const isDuplicate = errorMsg?.includes("duplicado") || errorMsg?.includes("ya existe");
              
              if (isDuplicate) {
                console.log(`⏭️ Skipped ${xmlAtt.name}: ${errorMsg}`);
                skippedInvoices.push({ filename: xmlAtt.name, reason: errorMsg });
              } else {
                console.error(`❌ Processing error for ${xmlAtt.name}:`, errorMsg);
                errors.push({ filename: xmlAtt.name, error: errorMsg });
              }
              continue;
            }

            console.log(`✅ Successfully processed: ${xmlAtt.name}`);
            processedInvoices.push({
              filename: xmlAtt.name,
              doc_id: processResult.doc_id,
              status: processResult.status,
              account_code: processResult.account_code,
            });

            // Upload to Google Drive if connected
            try {
              await fetch(`${supabaseUrl}/functions/v1/upload-to-google-drive`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${supabaseKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  document_id: processResult.doc_id,
                  organization_id,
                }),
              });
            } catch (driveError) {
              console.log(`Google Drive upload skipped: ${driveError}`);
            }
          } catch (xmlError) {
            console.error(`Error processing XML ${xmlAtt.name}:`, xmlError);
            errors.push({ 
              filename: xmlAtt.name, 
              error: xmlError instanceof Error ? xmlError.message : "Unknown error" 
            });
          }
        }
      } catch (error) {
        console.error(`Error processing message ${message.id}:`, error);
      }
    }

    const totalExecutionTime = Date.now() - executionStartTime;
    const status = wasTimeLimitReached ? "partial" : "success";
    
    console.log(`📊 Outlook Summary [${status}]: ${processedInvoices.length} processed, ${skippedInvoices.length} skipped, ${errors.length} errors. Time: ${(totalExecutionTime / 1000).toFixed(1)}s`);
    
    return new Response(
      JSON.stringify({
        success: true,
        status,
        messages_found: messages.length,
        invoices_processed: processedInvoices.length,
        invoices_skipped: skippedInvoices.length,
        invoices_failed: errors.length,
        invoices: processedInvoices,
        skipped: skippedInvoices.length > 0 ? skippedInvoices : undefined,
        errors: errors.length > 0 ? errors : undefined,
        time_limit_reached: wasTimeLimitReached,
        execution_time_ms: totalExecutionTime,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in outlook-fetch-invoices:", error);
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
