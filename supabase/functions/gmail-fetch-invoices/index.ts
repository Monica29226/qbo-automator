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

    // Función para renovar el token de Gmail
    const refreshGmailToken = async () => {
      console.log("Refreshing Gmail access token...");
      
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
        const errorText = await refreshResponse.text();
        console.error("Token refresh failed:", errorText);
        throw new Error(`Failed to refresh token: ${errorText}`);
      }

      const refreshData = await refreshResponse.json();
      const newExpiresAt = Date.now() + (refreshData.expires_in * 1000);

      // Actualizar credenciales en la base de datos
      await supabase
        .from("integration_accounts")
        .update({
          credentials: {
            ...credentials,
            access_token: refreshData.access_token,
            expires_at: newExpiresAt,
          },
        })
        .eq("id", gmailAccount.id);

      console.log("Token refreshed successfully");
      return refreshData.access_token;
    };

    // Verificar si el token está expirado y renovarlo si es necesario
    let accessToken = credentials.access_token;
    const expiresAt = typeof credentials.expires_at === 'string' 
      ? new Date(credentials.expires_at).getTime() 
      : credentials.expires_at;
    
    // Verificar si el token está próximo a expirar (menos de 2 horas) o ya expiró
    const hoursUntilExpiration = expiresAt ? (expiresAt - Date.now()) / (1000 * 60 * 60) : null;
    
    if (hoursUntilExpiration !== null) {
      console.log(`⚠️ Token expiring in ${Math.floor(hoursUntilExpiration * 60)} minutes`);
      
      // Renovar proactivamente si expira en menos de 2 horas o ya expiró
      if (hoursUntilExpiration < 2) {
        try {
          accessToken = await refreshGmailToken();
        } catch (refreshError) {
          console.error("Failed to refresh token:", refreshError);
          
          // Registrar alerta crítica
          await supabase.from("alert_history").insert({
            organization_id,
            alert_type: "critical",
            issues_count: 1,
            issues_data: [{
              type: "critical",
              title: "Error crítico al renovar token de Gmail",
              description: "Falló la renovación automática del token. Reconecte su cuenta de Gmail inmediatamente.",
              actionRequired: "Reconectar Gmail en Configuración > Integraciones",
              data: {
                error: refreshError instanceof Error ? refreshError.message : "Unknown error",
                failedAt: new Date().toISOString()
              }
            }]
          });
          
          throw refreshError;
        }
      }
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

    // Buscar mensajes en Gmail con reintentos en caso de error de autenticación
    // Aumentado a 200 para procesar más facturas
    let searchResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(mailQuery)}&maxResults=200`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    // Si falla con 401, intentar renovar el token y reintentar
    if (!searchResponse.ok && searchResponse.status === 401) {
      console.log("Gmail API returned 401, attempting to refresh token and retry...");
      
      try {
        accessToken = await refreshGmailToken();
        
        // Reintentar la búsqueda con el nuevo token
        searchResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(mailQuery)}&maxResults=200`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );
      } catch (refreshError) {
        console.error("Failed to refresh token after 401:", refreshError);
        throw new Error("Gmail authentication failed and token refresh failed");
      }
    }

    if (!searchResponse.ok) {
      const errorBody = await searchResponse.text();
      console.error("Gmail API error:", searchResponse.status, errorBody);
      throw new Error(`Failed to search Gmail messages: ${searchResponse.status} - ${errorBody}`);
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

    // Procesar mensajes - límite aumentado para procesamiento completo
    const messageLimit = force_resync ? 200 : 200;
    console.log(`Processing up to ${messageLimit} messages`);
    
    for (const message of messages.slice(0, messageLimit)) {
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

        // Buscar archivos adjuntos XML y PDF
        let xmlFilename = null;
        let pdfAttachmentId = null;
        let pdfFilename = null;
        
        for (const part of parts) {
          if (part.filename?.toLowerCase().endsWith(".xml")) {
            xmlFilename = part.filename;
          }
          if (part.filename?.toLowerCase().endsWith(".pdf")) {
            pdfAttachmentId = part.body?.attachmentId;
            pdfFilename = part.filename;
          }
        }
        
        // Procesar XML
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
                    file_path: part.filename,
                  }),
                }
              );

              if (!processResponse.ok) {
                const errorText = await processResponse.text();
                console.error(`XML processing failed for ${part.filename}:`, errorText);
                errors.push({ filename: part.filename, error: "XML processing failed" });
                continue;
              }

              const processResult = await processResponse.json();
              
              if (!processResult.success) {
                const errorMsg = processResult.error || processResult.message;
                // Distinguir entre duplicados/skipped y errores reales
                const isDuplicate = errorMsg?.includes("duplicado") || errorMsg?.includes("ya existe");
                const isResponseXml = errorMsg?.includes("FechaEmision") || errorMsg?.includes("not found");
                
                if (isDuplicate || isResponseXml) {
                  console.log(`⏭️ Skipped ${part.filename}: ${errorMsg}`);
                  skippedInvoices.push({ filename: part.filename, reason: errorMsg });
                } else {
                  console.error(`❌ Processing error for ${part.filename}:`, errorMsg);
                  errors.push({ filename: part.filename, error: errorMsg });
                }
                continue;
              }

              console.log(`✅ Successfully processed: ${part.filename} (${processResult.status})`);
              processedInvoices.push({
                filename: part.filename,
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
                  console.log(`Uploaded to Google Drive: ${part.filename}`);
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

    console.log(`📊 Summary: ${processedInvoices.length} processed, ${skippedInvoices.length} skipped (duplicates/response XMLs), ${errors.length} real errors`);
    
    return new Response(
      JSON.stringify({
        success: true,
        messages_found: messages.length,
        invoices_processed: processedInvoices.length,
        invoices_skipped: skippedInvoices.length,
        invoices_failed: errors.length, // Solo errores reales
        invoices: processedInvoices,
        skipped: skippedInvoices.length > 0 ? skippedInvoices : undefined,
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
