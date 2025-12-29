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
    
    console.log(`Force resync mode: ${force_resync ? 'ENABLED' : 'disabled'}`);

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

    // Función para renovar el token de Gmail con manejo robusto de errores
    const refreshGmailToken = async (): Promise<string> => {
      console.log("🔄 Attempting to refresh Gmail access token...");
      
      const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
      const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");

      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        console.error("❌ Missing Google OAuth credentials");
        throw new Error("Google OAuth credentials not configured");
      }

      if (!credentials.refresh_token) {
        console.error("❌ No refresh token available - account needs reconnection");
        // Marcar cuenta como desconectada
        await markAccountAsDisconnected("No refresh token available");
        throw new Error("No refresh token - please reconnect Gmail");
      }

      try {
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

        const responseText = await refreshResponse.text();
        
        if (!refreshResponse.ok) {
          console.error("❌ Token refresh failed:", refreshResponse.status, responseText);
          
          // Si el refresh token es inválido (revocado o expirado), marcar como desconectado
          if (refreshResponse.status === 400 || refreshResponse.status === 401) {
            const errorData = JSON.parse(responseText);
            if (errorData.error === "invalid_grant" || errorData.error === "invalid_token") {
              console.error("🚫 Refresh token is invalid or revoked");
              await markAccountAsDisconnected(`Token inválido: ${errorData.error_description || errorData.error}`);
              throw new Error("Gmail token revoked - please reconnect");
            }
          }
          
          throw new Error(`Token refresh failed: ${refreshResponse.status}`);
        }

        const refreshData = JSON.parse(responseText);
        const newExpiresAt = Date.now() + (refreshData.expires_in * 1000);

        // Actualizar credenciales en la base de datos
        const { error: updateError } = await supabase
          .from("integration_accounts")
          .update({
            credentials: {
              ...credentials,
              access_token: refreshData.access_token,
              expires_at: newExpiresAt,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", gmailAccount.id);

        if (updateError) {
          console.error("⚠️ Failed to save refreshed token:", updateError);
        } else {
          console.log("✅ Token refreshed and saved successfully");
        }

        return refreshData.access_token;
      } catch (error) {
        console.error("❌ Token refresh error:", error);
        throw error;
      }
    };

    // Función para marcar la cuenta como desconectada
    const markAccountAsDisconnected = async (reason: string) => {
      console.log("🔌 Marking Gmail account as disconnected:", reason);
      
      try {
        // Desactivar la cuenta de integración
        await supabase
          .from("integration_accounts")
          .update({ 
            is_active: false,
            updated_at: new Date().toISOString(),
          })
          .eq("id", gmailAccount.id);

        // Actualizar organización
        await supabase
          .from("organizations")
          .update({ 
            gmail_connected: false,
            gmail_email: null,
          })
          .eq("id", organization_id);

        // Registrar alerta crítica (solo si es un problema real que requiere acción)
        await supabase.from("alert_history").insert({
          organization_id,
          alert_type: "critical",
          issues_count: 1,
          issues_data: [{
            type: "critical",
            title: "Gmail desconectado automáticamente",
            description: reason,
            actionRequired: "Reconectar Gmail en Configuración > Integraciones",
            timestamp: new Date().toISOString()
          }]
        });

        console.log("✅ Account marked as disconnected");
      } catch (dbError) {
        console.error("⚠️ Failed to mark account as disconnected:", dbError);
      }
    };

    // Verificar si el token está expirado y renovarlo si es necesario
    let accessToken = credentials.access_token;
    const expiresAt = typeof credentials.expires_at === 'string' 
      ? new Date(credentials.expires_at).getTime() 
      : credentials.expires_at;
    
    // Verificar si el token está próximo a expirar (menos de 2 horas) o ya expiró
    const hoursUntilExpiration = expiresAt ? (expiresAt - Date.now()) / (1000 * 60 * 60) : null;
    
    if (hoursUntilExpiration !== null) {
      const minutesUntil = Math.floor(hoursUntilExpiration * 60);
      if (hoursUntilExpiration < 0) {
        console.log(`⚠️ Token EXPIRED ${Math.abs(minutesUntil)} minutes ago`);
      } else {
        console.log(`⏱️ Token expiring in ${minutesUntil} minutes`);
      }
      
      // Renovar proactivamente si expira en menos de 2 horas o ya expiró
      if (hoursUntilExpiration < 2) {
        try {
          accessToken = await refreshGmailToken();
        } catch (refreshError) {
          console.error("❌ Token refresh failed:", refreshError);
          // El error ya fue manejado (cuenta desconectada si es necesario)
          throw refreshError;
        }
      }
    } else {
      console.log("⚠️ No token expiration info available, proceeding with current token");
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

    // ============================================================
    // LÍMITE DE TIEMPO PARA EVITAR TIMEOUTS (120 segundos)
    // ============================================================
    const MAX_EXECUTION_TIME_MS = 120000; // 2 minutos (buffer de 30s antes del timeout de 150s)
    const executionStartTime = Date.now();
    let wasTimeLimitReached = false;

    // Buscar mensajes en Gmail con reintentos en caso de error de autenticación
    // Reducido a 50 para evitar timeouts
    const maxResults = force_resync ? 100 : 50;
    let searchResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(mailQuery)}&maxResults=${maxResults}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    // Si falla con 401, intentar renovar el token y reintentar
    if (!searchResponse.ok && searchResponse.status === 401) {
      console.log("⚠️ Gmail API returned 401, attempting token refresh and retry...");
      
      try {
        accessToken = await refreshGmailToken();
        
        // Reintentar la búsqueda con el nuevo token
        searchResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(mailQuery)}&maxResults=${maxResults}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );
        
        if (!searchResponse.ok) {
          const errorBody = await searchResponse.text();
          console.error("❌ Gmail API still failing after token refresh:", searchResponse.status, errorBody);
          await markAccountAsDisconnected(`Gmail API error after refresh: ${searchResponse.status}`);
          throw new Error("Gmail authentication failed after token refresh");
        }
        
        console.log("✅ Successfully recovered from 401 with token refresh");
      } catch (refreshError) {
        console.error("❌ Failed to refresh token after 401:", refreshError);
        // markAccountAsDisconnected ya fue llamado en refreshGmailToken si aplica
        throw new Error("Gmail authentication failed - please reconnect Gmail");
      }
    } else if (!searchResponse.ok) {
      const errorBody = await searchResponse.text();
      console.error("❌ Gmail API error:", searchResponse.status, errorBody);
      
      // Si es un error de autenticación diferente, también desconectar
      if (searchResponse.status === 403) {
        await markAccountAsDisconnected(`Gmail API permission denied: ${errorBody}`);
      }
      
      throw new Error(`Gmail API error: ${searchResponse.status}`);
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

    const processedInvoices: any[] = [];
    const skippedInvoices: any[] = [];
    const errors: any[] = [];

    // Helper function to recursively find all attachments (handles nested multipart)
    function findAllParts(part: any, result: any[] = []): any[] {
      if (!part) return result;
      
      // If this part has a filename, it's an attachment
      if (part.filename && part.filename.length > 0) {
        result.push(part);
      }
      
      // Recursively search nested parts
      if (part.parts && Array.isArray(part.parts)) {
        for (const subPart of part.parts) {
          findAllParts(subPart, result);
        }
      }
      
      return result;
    }

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

    // Procesar mensajes con límite de tiempo
    const messageLimit = messages.length;
    console.log(`Processing up to ${messageLimit} messages (max execution time: ${MAX_EXECUTION_TIME_MS / 1000}s)`);
    
    for (const message of messages.slice(0, messageLimit)) {
      // ============================================================
      // VERIFICAR LÍMITE DE TIEMPO ANTES DE PROCESAR CADA MENSAJE
      // ============================================================
      const elapsedTime = Date.now() - executionStartTime;
      if (elapsedTime > MAX_EXECUTION_TIME_MS) {
        console.log(`⏱️ Límite de tiempo alcanzado (${(elapsedTime / 1000).toFixed(1)}s). Procesados: ${processedInvoices.length}, Pendientes: ${messages.length - processedInvoices.length - skippedInvoices.length - errors.length}`);
        wasTimeLimitReached = true;
        break;
      }
      
      try {
        const messageResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );

        if (!messageResponse.ok) continue;

        const messageData = await messageResponse.json();
        
        // Find all attachments recursively (handles nested multipart structures)
        const allParts = findAllParts(messageData.payload);
        console.log(`📎 Message ${message.id}: Found ${allParts.length} attachments: ${allParts.map((p: any) => p.filename).join(', ')}`);

        // Find XML and PDF files
        // IMPORTANTE: Filtrar XMLs que NO son facturas (respuestas de Hacienda)
        // AHC = Acuse Hacienda Confirmación, RMH = Respuesta Mensaje Hacienda, MH = Mensaje Hacienda
        const allXmlParts = allParts.filter((p: any) => p.filename?.toLowerCase().endsWith(".xml"));
        console.log(`🔍 XMLs encontrados: ${allXmlParts.map((p: any) => p.filename).join(', ')}`);
        
        const xmlParts = allXmlParts.filter((p: any) => {
          const filename = p.filename?.toUpperCase() || '';
          // Excluir SOLO respuestas de Hacienda (confirmaciones/acuses)
          // IMPORTANTE: Los archivos que empiezan con números (ej: 50612345...) SÍ son facturas
          if (filename.startsWith('AHC-') || filename.startsWith('RMH-') || 
              filename.includes('-RESPUESTA') || filename.includes('_RESPUESTA')) {
            console.log(`⏭️ Ignorando respuesta de Hacienda: ${p.filename}`);
            return false;
          }
          // Aceptar todo lo demás (incluyendo MH que puede ser factura legítima)
          return true;
        });
        
        const pdfPart = allParts.find((p: any) => p.filename?.toLowerCase().endsWith(".pdf"));
        
        // Si no hay XMLs de factura válidos, saltar este mensaje
        if (xmlParts.length === 0) {
          console.log(`📭 No invoice XMLs found in message ${message.id} (${allXmlParts.length} response XMLs skipped)`);
          continue;
        }
        
        let pdfAttachmentId = pdfPart?.body?.attachmentId;
        let pdfFilename = pdfPart?.filename;
        
        // Procesar cada XML de FACTURA encontrado
        for (const xmlPart of xmlParts) {
            const attachmentId = xmlPart.body?.attachmentId;
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
              
              // Decodificar base64 a bytes y luego a texto UTF-8 para preservar tildes
              const base64Fixed = attachmentData.data.replace(/-/g, "+").replace(/_/g, "/");
              const binaryString = atob(base64Fixed);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              const xmlContent = new TextDecoder('utf-8').decode(bytes);

              console.log(`Processing invoice: ${xmlPart.filename}`);

              // Descargar y guardar PDF si existe (antes de procesar)
              let pdfUrl = null;
              if (pdfAttachmentId && pdfFilename) {
                try {
                  console.log(`Downloading PDF: ${pdfFilename}`);
                  
                  const pdfAttachmentResponse = await fetch(
                    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}/attachments/${pdfAttachmentId}`,
                    {
                      headers: { Authorization: `Bearer ${accessToken}` },
                    }
                  );

                  if (pdfAttachmentResponse.ok) {
                    const pdfAttachmentData = await pdfAttachmentResponse.json();
                    const pdfBase64 = pdfAttachmentData.data.replace(/-/g, "+").replace(/_/g, "/");
                    
                    // Decodificar base64 a bytes
                    const pdfBinary = atob(pdfBase64);
                    const pdfBytes = new Uint8Array(pdfBinary.length);
                    for (let i = 0; i < pdfBinary.length; i++) {
                      pdfBytes[i] = pdfBinary.charCodeAt(i);
                    }
                    
                    // Extraer número de documento del XML para el nombre del archivo
                    const docNumberMatch = xmlContent.match(/<NumeroConsecutivo>(.*?)<\/NumeroConsecutivo>/);
                    const docNumber = docNumberMatch ? docNumberMatch[1] : `invoice_${Date.now()}`;
                    
                    // Guardar en Supabase Storage
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
                    } else {
                      console.error(`Failed to upload PDF:`, uploadError);
                    }
                  }
                } catch (pdfError) {
                  console.error(`Error downloading PDF:`, pdfError);
                }
              }

              // Procesar documento con process-document-xml (sin IA)
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
                      file_path: xmlPart.filename,
                    }),
                }
              );

              if (!processResponse.ok) {
                const errorText = await processResponse.text();
                console.error(`XML processing failed for ${xmlPart.filename}:`, errorText);
                errors.push({ filename: xmlPart.filename, error: "XML processing failed" });
                continue;
              }

              const processResult = await processResponse.json();
              
              if (!processResult.success) {
                const errorMsg = processResult.error || processResult.message;
                // Distinguir entre duplicados/skipped y errores reales
                const isDuplicate = errorMsg?.includes("duplicado") || errorMsg?.includes("ya existe");
                const isResponseXml = errorMsg?.includes("FechaEmision") || errorMsg?.includes("not found");
                const isReceptorMismatch = errorMsg?.includes("rechazada") || errorMsg?.includes("receptor");
                
                if (isDuplicate || isResponseXml || isReceptorMismatch) {
                  console.log(`⏭️ Skipped ${xmlPart.filename}: ${errorMsg}`);
                  skippedInvoices.push({ filename: xmlPart.filename, reason: errorMsg });
                } else {
                  console.error(`❌ Processing error for ${xmlPart.filename}:`, errorMsg);
                  errors.push({ filename: xmlPart.filename, error: errorMsg });
                }
                continue;
              }

              console.log(`✅ Successfully processed: ${xmlPart.filename} (${processResult.status})`);
              processedInvoices.push({
                filename: xmlPart.filename,
                doc_id: processResult.doc_id,
                status: processResult.status,
                account_code: processResult.account_code,
              });

              // Upload to Google Drive if connected
              try {
                const uploadResponse = await fetch(
                  `${supabaseUrl}/functions/v1/upload-to-google-drive`,
                  {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${supabaseKey}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      document_id: processResult.doc_id,
                      organization_id,
                    }),
                  }
                );

                if (uploadResponse.ok) {
                  console.log(`Uploaded to Google Drive: ${xmlPart.filename}`);
                } else {
                  const errorText = await uploadResponse.text();
                  console.log(`Google Drive upload skipped or failed: ${errorText}`);
                }
              } catch (driveError) {
                console.log(`Google Drive upload error (non-critical): ${driveError}`);
              }

              // La función process-document-xml ya manejó todo el procesamiento
              // No necesitamos guardar nada adicional aquí
            } catch (xmlError) {
              console.error(`Error processing XML ${xmlPart.filename}:`, xmlError);
              errors.push({ 
                filename: xmlPart.filename, 
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
    
    console.log(`📊 Summary [${status}]: ${processedInvoices.length} processed, ${skippedInvoices.length} skipped, ${errors.length} errors. Time: ${(totalExecutionTime / 1000).toFixed(1)}s`);
    
    return new Response(
      JSON.stringify({
        success: true,
        status, // "success" o "partial"
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
