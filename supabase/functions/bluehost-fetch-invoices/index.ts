import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Simple IMAP client usando conexión TCP nativa de Deno
async function fetchEmailsViaIMAP(
  host: string,
  port: number,
  email: string,
  password: string,
  sinceDateStr: string
): Promise<{ rawEmails: string[]; error?: string }> {
  const rawEmails: string[] = [];
  
  try {
    // Conectar usando TLS
    const conn = await Deno.connectTls({
      hostname: host,
      port: port,
    });

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const buffer = new Uint8Array(65536);

    // Función para leer respuesta
    const readResponse = async (): Promise<string> => {
      let response = "";
      let attempts = 0;
      
      while (attempts < 50) {
        const n = await conn.read(buffer);
        if (n === null) break;
        
        response += decoder.decode(buffer.subarray(0, n));
        
        // Verificar si la respuesta está completa
        if (response.includes("\r\n") && 
            (response.includes("OK") || response.includes("NO") || response.includes("BAD") || response.includes("* "))) {
          // Para comandos que devuelven múltiples líneas, esperar a que termine
          if (!response.endsWith("\r\n")) {
            attempts++;
            await new Promise(r => setTimeout(r, 100));
            continue;
          }
          break;
        }
        attempts++;
        await new Promise(r => setTimeout(r, 100));
      }
      
      return response;
    };

    // Función para enviar comando
    const sendCommand = async (tag: string, command: string): Promise<string> => {
      const fullCommand = `${tag} ${command}\r\n`;
      await conn.write(encoder.encode(fullCommand));
      return await readResponse();
    };

    // Leer greeting
    const greeting = await readResponse();
    console.log("[IMAP] Greeting:", greeting.substring(0, 100));

    if (!greeting.includes("OK")) {
      conn.close();
      return { rawEmails: [], error: "Server did not send OK greeting" };
    }

    // Login
    const loginResp = await sendCommand("A001", `LOGIN "${email}" "${password}"`);
    console.log("[IMAP] Login response:", loginResp.substring(0, 100));
    
    if (!loginResp.includes("OK")) {
      conn.close();
      return { rawEmails: [], error: "Login failed: " + loginResp.substring(0, 200) };
    }

    // Select INBOX
    const selectResp = await sendCommand("A002", "SELECT INBOX");
    console.log("[IMAP] SELECT response:", selectResp.substring(0, 200));

    // Extraer número de mensajes
    const existsMatch = selectResp.match(/\* (\d+) EXISTS/);
    const totalMessages = existsMatch ? parseInt(existsMatch[1]) : 0;
    console.log(`[IMAP] INBOX has ${totalMessages} messages`);

    if (totalMessages === 0) {
      await sendCommand("A999", "LOGOUT");
      conn.close();
      return { rawEmails: [] };
    }

    // Search por fecha - usar formato IMAP: DD-Mon-YYYY
    const searchResp = await sendCommand("A003", `SEARCH SINCE ${sinceDateStr}`);
    console.log("[IMAP] SEARCH response:", searchResp.substring(0, 300));

    // Extraer UIDs de la respuesta
    const searchLine = searchResp.split("\r\n").find(l => l.startsWith("* SEARCH"));
    if (!searchLine || searchLine.trim() === "* SEARCH") {
      console.log("[IMAP] No messages found");
      await sendCommand("A999", "LOGOUT");
      conn.close();
      return { rawEmails: [] };
    }

    const messageIds = searchLine.replace("* SEARCH ", "").trim().split(" ").map(Number).filter(n => n > 0);
    console.log(`[IMAP] Found ${messageIds.length} messages`);

    // Limitar a últimos 50 mensajes para evitar timeouts
    const messagesToFetch = messageIds.slice(-50);
    console.log(`[IMAP] Fetching last ${messagesToFetch.length} messages`);

    // Fetch cada mensaje
    for (let i = 0; i < messagesToFetch.length; i++) {
      const msgId = messagesToFetch[i];
      
      try {
        // Fetch solo el body structure primero para ver si tiene adjuntos XML o PDF
        const structCmd = `A1${i}0 FETCH ${msgId} BODYSTRUCTURE`;
        await conn.write(encoder.encode(structCmd + "\r\n"));
        
        let structResp = "";
        let structAttempts = 0;
        while (structAttempts < 20) {
          const n = await conn.read(buffer);
          if (n === null) break;
          structResp += decoder.decode(buffer.subarray(0, n));
          if (structResp.includes(`A1${i}0 OK`)) break;
          structAttempts++;
          await new Promise(r => setTimeout(r, 50));
        }

        // Verificar si tiene XML o PDF adjunto
        const lowerStructResp = structResp.toLowerCase();
        const hasXml = lowerStructResp.includes('"xml"') || 
                       lowerStructResp.includes('application/xml') ||
                       lowerStructResp.includes('.xml');
        const hasPdf = lowerStructResp.includes('"pdf"') ||
                       lowerStructResp.includes('application/pdf') ||
                       lowerStructResp.includes('.pdf');

        if (!hasXml && !hasPdf) {
          continue;
        }

        console.log(`[IMAP] Message ${msgId} has attachments (XML: ${hasXml}, PDF: ${hasPdf}), fetching full...`);

        // Fetch mensaje completo
        const fetchCmd = `A1${i}1 FETCH ${msgId} BODY[]`;
        await conn.write(encoder.encode(fetchCmd + "\r\n"));
        
        let emailContent = "";
        let fetchAttempts = 0;
        const maxFetchTime = Date.now() + 30000; // 30 segundos max por mensaje
        
        while (Date.now() < maxFetchTime && fetchAttempts < 500) {
          const n = await conn.read(buffer);
          if (n === null) break;
          emailContent += decoder.decode(buffer.subarray(0, n));
          
          // Verificar si terminó
          if (emailContent.includes(`A1${i}1 OK`)) break;
          if (emailContent.includes(`A1${i}1 NO`) || emailContent.includes(`A1${i}1 BAD`)) break;
          
          fetchAttempts++;
        }

        if (emailContent.length > 0) {
          rawEmails.push(emailContent);
        }
      } catch (msgErr) {
        console.error(`[IMAP] Error fetching message ${msgId}:`, msgErr);
      }
    }

    // Logout
    await sendCommand("A999", "LOGOUT");
    conn.close();

    return { rawEmails };
  } catch (error) {
    console.error("[IMAP] Connection error:", error);
    return { rawEmails: [], error: String(error) };
  }
}

// Función para verificar si un XML es una respuesta de Hacienda (no una factura)
function isHaciendaResponse(filename: string, content: string): boolean {
  const upperFilename = filename.toUpperCase();
  
  // Respuestas de Hacienda tienen prefijos específicos
  if (upperFilename.startsWith("AHC-") || 
      upperFilename.startsWith("RMH-") ||
      upperFilename.startsWith("MH-")) {
    return true;
  }
  
  // Los XMLs de respuesta tienen tags específicos de mensaje de Hacienda
  // Una factura tiene <FacturaElectronica> o similar, no <MensajeHacienda>
  if (content.includes("<MensajeHacienda") ||
      content.includes("<ConfirmacionComprobante") ||
      content.includes("<RespuestaXML") ||
      content.includes("<MensajeReceptor>") ||
      (content.includes("<Mensaje>") && content.includes("<DetalleMensaje>") && !content.includes("<FacturaElectronica"))) {
    return true;
  }
  
  // Si es un mensaje de aceptación/rechazo puro (no una factura)
  // Estos NO contienen <LineaDetalle> porque no son facturas
  if (content.includes("<Mensaje>") && 
      !content.includes("<LineaDetalle>") && 
      !content.includes("<FacturaElectronica") &&
      !content.includes("<NotaCreditoElectronica") &&
      !content.includes("<NotaDebitoElectronica") &&
      !content.includes("<TiqueteElectronico")) {
    return true;
  }
  
  return false;
}

// Función para extraer adjuntos XML de un email raw
function extractXmlAttachments(rawEmail: string): Array<{ filename: string; content: string }> {
  const attachments: Array<{ filename: string; content: string }> = [];
  
  // Buscar boundary
  const boundaryMatch = rawEmail.match(/boundary="?([^"\r\n;]+)"?/i);
  if (!boundaryMatch) {
    return attachments;
  }

  const boundary = boundaryMatch[1];
  const parts = rawEmail.split("--" + boundary);

  for (const part of parts) {
    // Verificar si es un adjunto XML
    const filenameMatch = part.match(/filename="?([^"\r\n]+\.xml)"?/i);
    if (!filenameMatch) continue;

    const filename = filenameMatch[1].trim();

    // Verificar encoding
    const encodingMatch = part.match(/Content-Transfer-Encoding:\s*(\S+)/i);
    const encoding = encodingMatch ? encodingMatch[1].toUpperCase() : "7BIT";

    // Extraer contenido (después de línea vacía)
    const contentStart = part.indexOf("\r\n\r\n");
    if (contentStart === -1) continue;

    let content = part.substring(contentStart + 4);
    
    // Limpiar el final
    const endIdx = content.indexOf("--" + boundary);
    if (endIdx !== -1) {
      content = content.substring(0, endIdx);
    }
    content = content.trim();

    // Decodificar según encoding
    let decodedContent: string;
    
    if (encoding === "BASE64") {
      try {
        // Limpiar y decodificar base64
        const cleanBase64 = content.replace(/[\r\n\s]/g, "");
        const binaryStr = atob(cleanBase64);
        // Intentar decodificar como UTF-8
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        decodedContent = new TextDecoder("utf-8").decode(bytes);
      } catch (e) {
        console.error(`[Bluehost] Error decoding base64 for ${filename}:`, e);
        continue;
      }
    } else if (encoding === "QUOTED-PRINTABLE") {
      decodedContent = content
        .replace(/=\r?\n/g, "")
        .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    } else {
      decodedContent = content;
    }

    // Verificar si es una respuesta de Hacienda (no una factura)
    if (isHaciendaResponse(filename, decodedContent)) {
      console.log(`[Bluehost] Skipping Hacienda response/message: ${filename}`);
      continue;
    }

    // Verificar que sea XML válido con Clave (facturas válidas)
    if (decodedContent.includes("<Clave>")) {
      console.log(`[Bluehost] ✓ Valid invoice XML found: ${filename}`);
      attachments.push({ filename, content: decodedContent });
    } else {
      console.log(`[Bluehost] Skipping XML without Clave: ${filename}`);
    }
  }

  return attachments;
}

// Función para extraer adjuntos PDF de un email raw
function extractPdfAttachments(rawEmail: string): Array<{ filename: string; content: Uint8Array }> {
  const attachments: Array<{ filename: string; content: Uint8Array }> = [];
  
  // Buscar boundary
  const boundaryMatch = rawEmail.match(/boundary="?([^"\r\n;]+)"?/i);
  if (!boundaryMatch) {
    return attachments;
  }

  const boundary = boundaryMatch[1];
  const parts = rawEmail.split("--" + boundary);

  for (const part of parts) {
    // Verificar si es un adjunto PDF
    const filenameMatch = part.match(/filename="?([^"\r\n]+\.pdf)"?/i);
    if (!filenameMatch) continue;

    const filename = filenameMatch[1].trim();

    // Verificar encoding
    const encodingMatch = part.match(/Content-Transfer-Encoding:\s*(\S+)/i);
    const encoding = encodingMatch ? encodingMatch[1].toUpperCase() : "7BIT";

    // Extraer contenido (después de línea vacía)
    const contentStart = part.indexOf("\r\n\r\n");
    if (contentStart === -1) continue;

    let content = part.substring(contentStart + 4);
    
    // Limpiar el final
    const endIdx = content.indexOf("--" + boundary);
    if (endIdx !== -1) {
      content = content.substring(0, endIdx);
    }
    content = content.trim();

    // Decodificar según encoding
    let decodedContent: Uint8Array;
    
    if (encoding === "BASE64") {
      try {
        const cleanBase64 = content.replace(/[\r\n\s]/g, "");
        const binaryStr = atob(cleanBase64);
        decodedContent = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          decodedContent[i] = binaryStr.charCodeAt(i);
        }
      } catch (e) {
        console.error(`[Bluehost] Error decoding PDF base64 for ${filename}:`, e);
        continue;
      }
    } else {
      // Para otros encodings, intentar convertir a bytes
      const encoder = new TextEncoder();
      decodedContent = encoder.encode(content);
    }

    // Verificar que comience con %PDF
    if (decodedContent.length > 4) {
      const header = String.fromCharCode(...decodedContent.slice(0, 4));
      if (header === "%PDF") {
        console.log(`[Bluehost] ✓ Valid PDF found: ${filename} (${decodedContent.length} bytes)`);
        attachments.push({ filename, content: decodedContent });
      } else {
        console.log(`[Bluehost] Skipping invalid PDF (wrong header): ${filename}`);
      }
    }
  }

  return attachments;
}

// Función para hacer match entre XML y PDF por nombre de archivo
function matchPdfToXml(
  xmlAttachments: Array<{ filename: string; content: string }>,
  pdfAttachments: Array<{ filename: string; content: Uint8Array }>
): Map<string, { filename: string; content: Uint8Array } | null> {
  const matches = new Map<string, { filename: string; content: Uint8Array } | null>();
  
  for (const xml of xmlAttachments) {
    // Extraer la clave del XML para buscar en PDFs
    const claveMatch = xml.content.match(/<Clave>(\d{50})<\/Clave>/);
    const clave = claveMatch ? claveMatch[1] : "";
    
    // También extraer el número consecutivo
    const numConsecMatch = xml.content.match(/<NumeroConsecutivo>(\d+)<\/NumeroConsecutivo>/);
    const numConsec = numConsecMatch ? numConsecMatch[1] : "";
    
    // Buscar PDF que coincida con el nombre base del XML, la clave o el consecutivo
    const xmlBaseName = xml.filename.replace(/\.xml$/i, "").toLowerCase();
    
    let matchedPdf: { filename: string; content: Uint8Array } | null = null;
    
    for (const pdf of pdfAttachments) {
      const pdfBaseName = pdf.filename.replace(/\.pdf$/i, "").toLowerCase();
      
      // Criterios de match:
      // 1. Mismo nombre base
      // 2. PDF contiene la clave
      // 3. PDF contiene el número consecutivo
      if (pdfBaseName === xmlBaseName ||
          (clave && pdf.filename.includes(clave)) ||
          (numConsec && pdf.filename.includes(numConsec)) ||
          (xmlBaseName.length >= 10 && pdfBaseName.includes(xmlBaseName.substring(0, 10)))) {
        matchedPdf = pdf;
        console.log(`[Bluehost] ✓ Matched PDF ${pdf.filename} to XML ${xml.filename}`);
        break;
      }
    }
    
    matches.set(xml.filename, matchedPdf);
  }
  
  return matches;
}

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
    
    console.log(`[Bluehost] Fetching invoices for organization ${organization_id}`);

    // Verificar autorización
    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === supabaseKey;
    
    if (!isServiceRole) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) throw new Error("Invalid authorization");
    }

    // Obtener cuenta de Bluehost activa
    const { data: bluehostAccount, error: accountError } = await supabase
      .from("integration_accounts")
      .select("*")
      .eq("organization_id", organization_id)
      .eq("service_type", "bluehost")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (accountError || !bluehostAccount) {
      throw new Error("No active Bluehost account found");
    }

    const credentials = bluehostAccount.credentials as any;
    if (!credentials?.email || !credentials?.password) {
      throw new Error("Bluehost credentials incomplete");
    }

    const imapHost = credentials.imap_host || "mail.bluehost.com";
    const imapPort = credentials.imap_port || 993;
    
    console.log(`[Bluehost] Connecting to ${imapHost}:${imapPort} for ${credentials.email}`);

    // Obtener settings de búsqueda
    const { data: settings } = await supabase
      .from("system_settings")
      .select("key, value")
      .eq("organization_id", organization_id)
      .in("key", ["mail_query", "start_date"]);

    const startDateSetting = settings?.find(s => s.key === "start_date")?.value;
    let startDate: Date;
    
    if (month && year) {
      startDate = new Date(year, month - 1, 1);
    } else if (startDateSetting) {
      startDate = new Date(startDateSetting);
    } else {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
    }

    // Formatear fecha para IMAP: DD-Mon-YYYY
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const sinceDateStr = `${startDate.getDate()}-${months[startDate.getMonth()]}-${startDate.getFullYear()}`;
    
    console.log(`[Bluehost] Searching for emails since ${sinceDateStr}`);

    // Fetch emails via IMAP
    const { rawEmails, error: imapError } = await fetchEmailsViaIMAP(
      imapHost,
      imapPort,
      credentials.email,
      credentials.password,
      sinceDateStr
    );

    if (imapError) {
      throw new Error(`IMAP error: ${imapError}`);
    }

    console.log(`[Bluehost] Retrieved ${rawEmails.length} raw emails`);

    const processedInvoices: any[] = [];
    const skippedInvoices: any[] = [];
    const errors: any[] = [];

    // Procesar cada email
    for (const rawEmail of rawEmails) {
      try {
        const xmlAttachments = extractXmlAttachments(rawEmail);
        const pdfAttachments = extractPdfAttachments(rawEmail);
        
        console.log(`[Bluehost] Email has ${xmlAttachments.length} XMLs and ${pdfAttachments.length} PDFs`);
        
        // Match PDFs con XMLs
        const pdfMatches = matchPdfToXml(xmlAttachments, pdfAttachments);
        
        for (const xmlAttachment of xmlAttachments) {
          // Extraer clave del XML
          const claveMatch = xmlAttachment.content.match(/<Clave>(\d{50})<\/Clave>/);
          if (!claveMatch) {
            console.log(`[Bluehost] Skipping XML without valid Clave: ${xmlAttachment.filename}`);
            continue;
          }

          const docKey = claveMatch[1];

          // Verificar si ya existe
          const { data: existing } = await supabase
            .from("processed_documents")
            .select("id, status, pdf_attachment_url")
            .eq("doc_key", docKey)
            .eq("organization_id", organization_id)
            .maybeSingle();

          if (existing && !force_resync) {
            // Si existe pero no tiene PDF, intentar agregar el PDF
            const matchedPdf = pdfMatches.get(xmlAttachment.filename);
            if (matchedPdf && !existing.pdf_attachment_url) {
              try {
                const pdfPath = `${organization_id}/${docKey}.pdf`;
                const { error: uploadError } = await supabase.storage
                  .from("company-documents")
                  .upload(pdfPath, matchedPdf.content, {
                    contentType: "application/pdf",
                    upsert: true
                  });
                
                if (!uploadError) {
                  const { data: urlData } = supabase.storage
                    .from("company-documents")
                    .getPublicUrl(pdfPath);
                  
                  await supabase
                    .from("processed_documents")
                    .update({ 
                      pdf_attachment_url: urlData.publicUrl,
                      file_path: pdfPath
                    })
                    .eq("id", existing.id);
                  
                  console.log(`[Bluehost] ✅ Added missing PDF for existing document: ${docKey}`);
                }
              } catch (pdfErr) {
                console.error(`[Bluehost] Error adding PDF to existing doc:`, pdfErr);
              }
            }
            
            skippedInvoices.push({ doc_key: docKey, reason: "Already exists" });
            continue;
          }

          // Subir PDF si existe match
          let pdfUrl: string | null = null;
          let pdfPath: string | null = null;
          const matchedPdf = pdfMatches.get(xmlAttachment.filename);
          
          if (matchedPdf) {
            try {
              pdfPath = `${organization_id}/${docKey}.pdf`;
              const { error: uploadError } = await supabase.storage
                .from("company-documents")
                .upload(pdfPath, matchedPdf.content, {
                  contentType: "application/pdf",
                  upsert: true
                });
              
              if (!uploadError) {
                const { data: urlData } = supabase.storage
                  .from("company-documents")
                  .getPublicUrl(pdfPath);
                pdfUrl = urlData.publicUrl;
                console.log(`[Bluehost] ✅ Uploaded PDF: ${pdfPath}`);
              } else {
                console.error(`[Bluehost] Error uploading PDF:`, uploadError);
              }
            } catch (pdfErr) {
              console.error(`[Bluehost] Error processing PDF:`, pdfErr);
            }
          }

          // Procesar el XML
          const { data: processResult, error: processError } = await supabase.functions.invoke(
            "process-document-xml",
            {
              body: {
                organization_id,
                xml_content: xmlAttachment.content,
                pdf_attachment_url: pdfUrl,
                file_path: pdfPath,
                source: "bluehost",
              },
            }
          );

          if (processError) {
            console.error(`[Bluehost] Error processing ${xmlAttachment.filename}:`, processError);
            errors.push({ filename: xmlAttachment.filename, error: processError.message });
          } else if (processResult?.success) {
            processedInvoices.push({
              doc_key: docKey,
              supplier_name: processResult.document?.supplier_name,
              total_amount: processResult.document?.total_amount,
              has_pdf: !!pdfUrl
            });
            console.log(`[Bluehost] ✅ Processed: ${xmlAttachment.filename} (PDF: ${!!pdfUrl})`);
          } else if (processResult?.rejected) {
            skippedInvoices.push({ 
              filename: xmlAttachment.filename, 
              reason: processResult?.message || "Rejected" 
            });
            console.log(`[Bluehost] ⚠️ Rejected: ${xmlAttachment.filename} - ${processResult?.message}`);
          } else {
            skippedInvoices.push({ 
              filename: xmlAttachment.filename, 
              reason: processResult?.message || "Unknown" 
            });
          }
        }
      } catch (emailErr) {
        console.error("[Bluehost] Error processing email:", emailErr);
        errors.push({ error: String(emailErr) });
      }
    }

    console.log(`[Bluehost] Complete: ${processedInvoices.length} processed, ${skippedInvoices.length} skipped, ${errors.length} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        messages_found: rawEmails.length,
        invoices_processed: processedInvoices.length,
        invoices_skipped: skippedInvoices.length,
        invoices_failed: errors.length,
        processed: processedInvoices,
        skipped: skippedInvoices,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("[Bluehost] Error:", error);
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
