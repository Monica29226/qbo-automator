import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Simple IMAP client using Deno's native TCP connection
async function fetchEmailsViaIMAP(
  host: string,
  port: number,
  email: string,
  password: string,
  sinceDateStr: string,
  beforeDateStr?: string,  // Para filtrar hasta cierta fecha
  skipCount?: number       // Para paginación - saltar los primeros N mensajes
): Promise<{ rawEmails: string[]; error?: string; totalFound?: number; processedCount?: number }> {
  const rawEmails: string[] = [];
  
  try {
    console.log(`[Hostinger IMAP] Connecting to ${host}:${port}...`);
    
    // Connect using TLS
    const conn = await Deno.connectTls({
      hostname: host,
      port: port,
    });

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const buffer = new Uint8Array(65536);

    // Function to read response
    const readResponse = async (): Promise<string> => {
      let response = "";
      let attempts = 0;
      
      while (attempts < 50) {
        const n = await conn.read(buffer);
        if (n === null) break;
        
        response += decoder.decode(buffer.subarray(0, n));
        
        if (response.includes("\r\n") && 
            (response.includes("OK") || response.includes("NO") || response.includes("BAD") || response.includes("* "))) {
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

    // Function to send command
    const sendCommand = async (tag: string, command: string): Promise<string> => {
      const fullCommand = `${tag} ${command}\r\n`;
      await conn.write(encoder.encode(fullCommand));
      return await readResponse();
    };

    // Read greeting
    const greeting = await readResponse();
    console.log("[Hostinger IMAP] Greeting:", greeting.substring(0, 100));

    if (!greeting.includes("OK")) {
      conn.close();
      return { rawEmails: [], error: "Server did not send OK greeting" };
    }

    // Login
    const loginResp = await sendCommand("A001", `LOGIN "${email}" "${password}"`);
    console.log("[Hostinger IMAP] Login response:", loginResp.substring(0, 100));
    
    if (!loginResp.includes("OK")) {
      conn.close();
      return { rawEmails: [], error: "Login failed: " + loginResp.substring(0, 200) };
    }

    // Select INBOX
    const selectResp = await sendCommand("A002", "SELECT INBOX");
    console.log("[Hostinger IMAP] SELECT response:", selectResp.substring(0, 200));

    // Extract message count
    const existsMatch = selectResp.match(/\* (\d+) EXISTS/);
    const totalMessages = existsMatch ? parseInt(existsMatch[1]) : 0;
    console.log(`[Hostinger IMAP] INBOX has ${totalMessages} messages`);

    if (totalMessages === 0) {
      await sendCommand("A999", "LOGOUT");
      conn.close();
      return { rawEmails: [] };
    }

    // Search by date - IMAP format: DD-Mon-YYYY
    // Use SINCE and optionally BEFORE for month-specific searches
    let searchCmd = `SEARCH SINCE ${sinceDateStr}`;
    if (beforeDateStr) {
      searchCmd = `SEARCH SINCE ${sinceDateStr} BEFORE ${beforeDateStr}`;
    }
    const searchResp = await sendCommand("A003", searchCmd);
    console.log("[Hostinger IMAP] SEARCH response:", searchResp.substring(0, 300));

    // Extract UIDs from response
    const searchLine = searchResp.split("\r\n").find(l => l.startsWith("* SEARCH"));
    if (!searchLine || searchLine.trim() === "* SEARCH") {
      console.log("[Hostinger IMAP] No messages found");
      await sendCommand("A999", "LOGOUT");
      conn.close();
      return { rawEmails: [], totalFound: 0, processedCount: 0 };
    }

    const messageIds = searchLine.replace("* SEARCH ", "").trim().split(" ").map(Number).filter(n => n > 0);
    console.log(`[Hostinger IMAP] Found ${messageIds.length} messages in date range`);

    // Si hay skipCount, saltar esos mensajes (para paginación)
    const startIdx = skipCount || 0;
    const availableMessages = messageIds.slice(startIdx);
    
    // Procesar hasta 25 mensajes por ejecución
    const messagesToFetch = availableMessages.slice(0, 25);
    console.log(`[Hostinger IMAP] Processing messages ${startIdx + 1} to ${startIdx + messagesToFetch.length} of ${messageIds.length} total`);

    // Track execution time to exit early if approaching limit
    const functionStartTime = Date.now();
    const MAX_EXECUTION_TIME_MS = 28000; // 28 seconds max (leave 2s buffer)
    // Fetch each message with early exit on timeout
    for (let i = 0; i < messagesToFetch.length; i++) {
      // Check if approaching timeout
      if (Date.now() - functionStartTime > MAX_EXECUTION_TIME_MS) {
        console.log(`[Hostinger IMAP] ⚠️ Approaching timeout, stopping after ${i} messages`);
        break;
      }
      
      const msgId = messagesToFetch[i];
      
      try {
        // Fetch body structure first to check for XML or PDF attachments
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

        // Check for XML or PDF attachments
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

        console.log(`[Hostinger IMAP] Message ${msgId} has attachments (XML: ${hasXml}, PDF: ${hasPdf}), fetching full...`);

        // Fetch full message
        const fetchCmd = `A1${i}1 FETCH ${msgId} BODY[]`;
        await conn.write(encoder.encode(fetchCmd + "\r\n"));
        
        let emailContent = "";
        let fetchAttempts = 0;
        const maxFetchTime = Date.now() + 30000; // 30 seconds max per message
        
        while (Date.now() < maxFetchTime && fetchAttempts < 500) {
          const n = await conn.read(buffer);
          if (n === null) break;
          emailContent += decoder.decode(buffer.subarray(0, n));
          
          if (emailContent.includes(`A1${i}1 OK`)) break;
          if (emailContent.includes(`A1${i}1 NO`) || emailContent.includes(`A1${i}1 BAD`)) break;
          
          fetchAttempts++;
        }

        if (emailContent.length > 0) {
          rawEmails.push(emailContent);
        }
      } catch (msgErr) {
        console.error(`[Hostinger IMAP] Error fetching message ${msgId}:`, msgErr);
      }
    }

    // Logout
    await sendCommand("A999", "LOGOUT");
    conn.close();

    return { 
      rawEmails, 
      totalFound: messageIds.length,
      processedCount: messagesToFetch.length
    };
  } catch (error) {
    console.error("[Hostinger IMAP] Connection error:", error);
    return { rawEmails: [], error: String(error), totalFound: 0, processedCount: 0 };
  }
}

// Function to check if XML is a Hacienda response (not an invoice)
function isHaciendaResponse(filename: string, content: string): boolean {
  const upperFilename = filename.toUpperCase();
  
  if (upperFilename.startsWith("AHC-") || 
      upperFilename.startsWith("RMH-") ||
      upperFilename.startsWith("MH-")) {
    return true;
  }
  
  if (content.includes("<MensajeHacienda") ||
      content.includes("<ConfirmacionComprobante") ||
      content.includes("<RespuestaXML") ||
      content.includes("<MensajeReceptor>") ||
      (content.includes("<Mensaje>") && content.includes("<DetalleMensaje>") && !content.includes("<FacturaElectronica"))) {
    return true;
  }
  
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

// Function to extract XML attachments from raw email
function extractXmlAttachments(rawEmail: string): Array<{ filename: string; content: string }> {
  const attachments: Array<{ filename: string; content: string }> = [];
  
  const boundaryMatch = rawEmail.match(/boundary="?([^"\r\n;]+)"?/i);
  if (!boundaryMatch) {
    return attachments;
  }

  const boundary = boundaryMatch[1];
  const parts = rawEmail.split("--" + boundary);

  for (const part of parts) {
    const filenameMatch = part.match(/filename="?([^"\r\n]+\.xml)"?/i);
    if (!filenameMatch) continue;

    const filename = filenameMatch[1].trim();

    const encodingMatch = part.match(/Content-Transfer-Encoding:\s*(\S+)/i);
    const encoding = encodingMatch ? encodingMatch[1].toUpperCase() : "7BIT";

    const contentStart = part.indexOf("\r\n\r\n");
    if (contentStart === -1) continue;

    let content = part.substring(contentStart + 4);
    
    const endIdx = content.indexOf("--" + boundary);
    if (endIdx !== -1) {
      content = content.substring(0, endIdx);
    }
    content = content.trim();

    let decodedContent: string;
    
    if (encoding === "BASE64") {
      try {
        const cleanBase64 = content.replace(/[\r\n\s]/g, "");
        // Decodificar base64 correctamente para UTF-8
        const binaryData = Uint8Array.from(atob(cleanBase64), c => c.charCodeAt(0));
        // Usar TextDecoder con UTF-8 para manejar tildes correctamente
        decodedContent = new TextDecoder("utf-8").decode(binaryData);
      } catch (e) {
        console.error(`[Hostinger] Error decoding base64 for ${filename}:`, e);
        continue;
      }
    } else if (encoding === "QUOTED-PRINTABLE") {
      decodedContent = content
        .replace(/=\r?\n/g, "")
        .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    } else {
      decodedContent = content;
    }

    if (isHaciendaResponse(filename, decodedContent)) {
      console.log(`[Hostinger] Skipping Hacienda response/message: ${filename}`);
      continue;
    }

    if (decodedContent.includes("<Clave>")) {
      console.log(`[Hostinger] ✓ Valid invoice XML found: ${filename}`);
      attachments.push({ filename, content: decodedContent });
    } else {
      console.log(`[Hostinger] Skipping XML without Clave: ${filename}`);
    }
  }

  return attachments;
}

// Function to extract PDF attachments from raw email
function extractPdfAttachments(rawEmail: string): Array<{ filename: string; content: Uint8Array }> {
  const attachments: Array<{ filename: string; content: Uint8Array }> = [];
  
  const boundaryMatch = rawEmail.match(/boundary="?([^"\r\n;]+)"?/i);
  if (!boundaryMatch) {
    return attachments;
  }

  const boundary = boundaryMatch[1];
  const parts = rawEmail.split("--" + boundary);

  for (const part of parts) {
    const filenameMatch = part.match(/filename="?([^"\r\n]+\.pdf)"?/i);
    if (!filenameMatch) continue;

    const filename = filenameMatch[1].trim();

    const encodingMatch = part.match(/Content-Transfer-Encoding:\s*(\S+)/i);
    const encoding = encodingMatch ? encodingMatch[1].toUpperCase() : "7BIT";

    const contentStart = part.indexOf("\r\n\r\n");
    if (contentStart === -1) continue;

    let content = part.substring(contentStart + 4);
    
    const endIdx = content.indexOf("--" + boundary);
    if (endIdx !== -1) {
      content = content.substring(0, endIdx);
    }
    content = content.trim();

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
        console.error(`[Hostinger] Error decoding PDF base64 for ${filename}:`, e);
        continue;
      }
    } else {
      const encoder = new TextEncoder();
      decodedContent = encoder.encode(content);
    }

    if (decodedContent.length > 4) {
      const header = String.fromCharCode(...decodedContent.slice(0, 4));
      if (header === "%PDF") {
        console.log(`[Hostinger] ✓ Valid PDF found: ${filename} (${decodedContent.length} bytes)`);
        attachments.push({ filename, content: decodedContent });
      } else {
        console.log(`[Hostinger] Skipping invalid PDF (wrong header): ${filename}`);
      }
    }
  }

  return attachments;
}

// Function to match PDF to XML by filename
function matchPdfToXml(
  xmlAttachments: Array<{ filename: string; content: string }>,
  pdfAttachments: Array<{ filename: string; content: Uint8Array }>
): Map<string, { filename: string; content: Uint8Array } | null> {
  const matches = new Map<string, { filename: string; content: Uint8Array } | null>();
  
  for (const xml of xmlAttachments) {
    const claveMatch = xml.content.match(/<Clave>(\d{50})<\/Clave>/);
    const clave = claveMatch ? claveMatch[1] : "";
    
    const numConsecMatch = xml.content.match(/<NumeroConsecutivo>(\d+)<\/NumeroConsecutivo>/);
    const numConsec = numConsecMatch ? numConsecMatch[1] : "";
    
    const xmlBaseName = xml.filename.replace(/\.xml$/i, "").toLowerCase();
    
    let matchedPdf: { filename: string; content: Uint8Array } | null = null;
    
    for (const pdf of pdfAttachments) {
      const pdfBaseName = pdf.filename.replace(/\.pdf$/i, "").toLowerCase();
      
      if (pdfBaseName === xmlBaseName ||
          (clave && pdf.filename.includes(clave)) ||
          (numConsec && pdf.filename.includes(numConsec)) ||
          (xmlBaseName.length >= 10 && pdfBaseName.includes(xmlBaseName.substring(0, 10)))) {
        matchedPdf = pdf;
        console.log(`[Hostinger] ✓ Matched PDF ${pdf.filename} to XML ${xml.filename}`);
        break;
      }
    }
    
    matches.set(xml.filename, matchedPdf);
  }
  
  return matches;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { organization_id, month, year, force_resync, skip_count } = await req.json();
    if (!organization_id) throw new Error("organization_id required");
    
    console.log(`[Hostinger] Fetching invoices for organization ${organization_id}${skip_count ? ` (skipping first ${skip_count} messages)` : ''}`);

    // Verify authorization
    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === supabaseKey;
    
    if (!isServiceRole) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) throw new Error("Invalid authorization");
    }

    // Get active Hostinger account
    const { data: hostingerAccount, error: accountError } = await supabase
      .from("integration_accounts")
      .select("*")
      .eq("organization_id", organization_id)
      .eq("service_type", "hostinger")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (accountError || !hostingerAccount) {
      return new Response(
        JSON.stringify({
          success: false,
          error_code: "NO_ACTIVE_ACCOUNT",
          message: "Hostinger no está conectado. Ve a Integraciones y conecta/reconecta tu cuenta.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    const credentials = hostingerAccount.credentials as any;
    if (!credentials?.email || !credentials?.password) {
      return new Response(
        JSON.stringify({
          success: false,
          error_code: "CREDENTIALS_INCOMPLETE",
          message: "La conexión de Hostinger está incompleta. Por favor reconecta la cuenta.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    const imapHost = credentials.imap_host || "imap.hostinger.com";
    const imapPort = credentials.imap_port || 993;
    
    console.log(`[Hostinger] Connecting to ${imapHost}:${imapPort} for ${credentials.email}`);

    // Get search settings
    const { data: settings } = await supabase
      .from("system_settings")
      .select("key, value")
      .eq("organization_id", organization_id)
      .in("key", ["mail_query", "start_date"]);

    const startDateSetting = settings?.find(s => s.key === "start_date")?.value;
    let startDate: Date;
    let endDate: Date | undefined;
    
    if (month && year) {
      // Búsqueda específica de un mes - usar rango SINCE + BEFORE
      startDate = new Date(year, month - 1, 1);
      endDate = new Date(year, month, 1); // Primer día del mes siguiente
    } else if (startDateSetting) {
      startDate = new Date(startDateSetting);
    } else {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
    }

    // Format dates for IMAP: DD-Mon-YYYY
    const monthsArr = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const sinceDateStr = `${startDate.getDate()}-${monthsArr[startDate.getMonth()]}-${startDate.getFullYear()}`;
    const beforeDateStr = endDate 
      ? `${endDate.getDate()}-${monthsArr[endDate.getMonth()]}-${endDate.getFullYear()}`
      : undefined;
    
    console.log(`[Hostinger] Searching emails since ${sinceDateStr}${beforeDateStr ? ` before ${beforeDateStr}` : ''}`);

    // Fetch emails via IMAP
    const { rawEmails, error: imapError, totalFound, processedCount } = await fetchEmailsViaIMAP(
      imapHost,
      imapPort,
      credentials.email,
      credentials.password,
      sinceDateStr,
      beforeDateStr,
      skip_count || 0
    );

    if (imapError) {
      console.error("[Hostinger] IMAP error:", imapError);

      const isAuthFailed =
        /AUTHENTICATIONFAILED/i.test(imapError) ||
        /Login failed/i.test(imapError) ||
        /Invalid credentials/i.test(imapError);

      if (isAuthFailed) {
        // Mark connection as inactive so the UI can guide the user to reconnect
        const now = new Date().toISOString();
        try {
          const { error: deactivateError } = await supabase
            .from("integration_accounts")
            .update({ is_active: false, updated_at: now })
            .eq("id", hostingerAccount.id);
          if (deactivateError) console.error("[Hostinger] Failed to deactivate integration account:", deactivateError);
        } catch (e) {
          console.error("[Hostinger] Failed to deactivate integration account (exception):", e);
        }

        try {
          const { error: orgUpdateError } = await supabase
            .from("organizations")
            .update({ hostinger_connected: false, updated_at: now })
            .eq("id", organization_id);
          if (orgUpdateError) console.error("[Hostinger] Failed to update organization hostinger_connected:", orgUpdateError);
        } catch (e) {
          console.error("[Hostinger] Failed to update organization hostinger_connected (exception):", e);
        }

        return new Response(
          JSON.stringify({
            success: false,
            error_code: "IMAP_AUTH_FAILED",
            message:
              "No se pudo autenticar en el correo Hostinger. Verifica la contraseña del buzón (no la del panel) y, si tienes 2FA, usa una contraseña de aplicación. Luego reconecta Hostinger.",
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }

      throw new Error(`IMAP error: ${imapError}`);
    }

    console.log(`[Hostinger] Fetched ${rawEmails.length} raw emails with potential attachments`);

    let invoicesProcessed = 0;
    let invoicesFailed = 0;
    let stoppedEarly = false;
    const errors: string[] = [];
    const processingStartTime = Date.now();
    const MAX_PROCESSING_TIME_MS = 25000; // 25 seconds for processing phase

    // Process each email with timeout protection
    for (const rawEmail of rawEmails) {
      // Check for timeout
      if (Date.now() - processingStartTime > MAX_PROCESSING_TIME_MS) {
        console.log(`[Hostinger] ⚠️ Approaching timeout during processing, stopping early`);
        stoppedEarly = true;
        break;
      }
      
      try {
        const xmlAttachments = extractXmlAttachments(rawEmail);
        const pdfAttachments = extractPdfAttachments(rawEmail);
        
        if (xmlAttachments.length === 0) {
          continue;
        }

        const pdfMatches = matchPdfToXml(xmlAttachments, pdfAttachments);

        for (const xml of xmlAttachments) {
          try {
            // Extract Clave from XML
            const claveMatch = xml.content.match(/<Clave>(\d{50})<\/Clave>/);
            if (!claveMatch) {
              console.log(`[Hostinger] No Clave found in ${xml.filename}, skipping`);
              continue;
            }
            const clave = claveMatch[1];

            // Check if already processed
            const { data: existingDoc } = await supabase
              .from("processed_documents")
              .select("id")
              .eq("doc_key", clave)
              .eq("organization_id", organization_id)
              .maybeSingle();

            if (existingDoc && !force_resync) {
              console.log(`[Hostinger] Document ${clave} already exists, skipping`);
              continue;
            }

            // Store XML in storage
            const xmlPath = `${organization_id}/xml/${clave}.xml`;
            const xmlBlob = new Blob([xml.content], { type: "application/xml" });
            
            const { error: xmlUploadError } = await supabase.storage
              .from("company-documents")
              .upload(xmlPath, xmlBlob, { upsert: true });

            if (xmlUploadError) {
              console.error(`[Hostinger] Error uploading XML ${clave}:`, xmlUploadError);
            }

            // Store matched PDF if exists
            const matchedPdf = pdfMatches.get(xml.filename);
            let pdfUrl: string | null = null;
            
            if (matchedPdf) {
              const pdfPath = `${organization_id}/pdf/${clave}.pdf`;
              
              const { error: pdfUploadError } = await supabase.storage
                .from("company-documents")
                .upload(pdfPath, matchedPdf.content, { 
                  upsert: true,
                  contentType: "application/pdf"
                });

              if (pdfUploadError) {
                console.error(`[Hostinger] Error uploading PDF ${clave}:`, pdfUploadError);
              } else {
                pdfUrl = pdfPath;
              }
            }

            // Call process-document-xml to parse and store
            console.log(`[Hostinger] 📤 Sending to process-document-xml: clave=${clave}, pdf_attachment_url=${pdfUrl || 'NONE'}`);
            
            const { data: processResult, error: processError } = await supabase.functions.invoke("process-document-xml", {
              body: {
                organization_id,
                xml_content: xml.content,
                clave,
                source: "hostinger",
                pdf_attachment_url: pdfUrl,
              },
            });

            if (processError) {
              console.error(`[Hostinger] Error processing ${clave}:`, processError);
              errors.push(`${clave}: ${processError.message}`);
              invoicesFailed++;
            } else {
              console.log(`[Hostinger] ✓ Processed ${clave} - PDF saved: ${pdfUrl ? 'YES' : 'NO'}`);
              invoicesProcessed++;
            }
          } catch (xmlErr) {
            console.error(`[Hostinger] Error processing XML ${xml.filename}:`, xmlErr);
            errors.push(`${xml.filename}: ${xmlErr}`);
            invoicesFailed++;
          }
        }
      } catch (emailErr) {
        console.error("[Hostinger] Error processing email:", emailErr);
        invoicesFailed++;
      }
    }

    const currentSkip = skip_count || 0;
    const nextSkip = currentSkip + (processedCount || 0);
    const hasMoreMessages = totalFound ? (nextSkip < totalFound) : false;
    console.log(`[Hostinger] Completed: ${invoicesProcessed} processed, ${invoicesFailed} failed. Total messages: ${totalFound || 'unknown'}, processed this run: ${processedCount || 'unknown'}, next_skip: ${nextSkip}${stoppedEarly ? ' (stopped early due to timeout)' : ''}`);

    return new Response(
      JSON.stringify({
        success: true,
        invoices_processed: invoicesProcessed,
        invoices_failed: invoicesFailed,
        partial: stoppedEarly || hasMoreMessages,
        total_messages_in_range: totalFound,
        messages_processed_this_run: processedCount,
        next_skip_count: hasMoreMessages ? nextSkip : undefined,
        message: (stoppedEarly || hasMoreMessages)
          ? `Procesadas ${invoicesProcessed} facturas (correos ${currentSkip + 1}-${nextSkip} de ${totalFound || '?'}). Ejecute de nuevo para continuar.`
          : `Se procesaron ${invoicesProcessed} facturas de ${totalFound || '?'} correos encontrados.`,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("[Hostinger] Error:", error);
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
