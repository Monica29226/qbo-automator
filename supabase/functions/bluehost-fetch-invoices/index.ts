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
    const conn = await Deno.connectTls({
      hostname: host,
      port: port,
    });

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const buffer = new Uint8Array(65536);

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

    const sendCommand = async (tag: string, command: string): Promise<string> => {
      const fullCommand = `${tag} ${command}\r\n`;
      await conn.write(encoder.encode(fullCommand));
      return await readResponse();
    };

    const greeting = await readResponse();
    console.log("[IMAP] Greeting:", greeting.substring(0, 100));

    if (!greeting.includes("OK")) {
      conn.close();
      return { rawEmails: [], error: "Server did not send OK greeting" };
    }

    const loginResp = await sendCommand("A001", `LOGIN "${email}" "${password}"`);
    console.log("[IMAP] Login response:", loginResp.substring(0, 100));
    
    if (!loginResp.includes("OK")) {
      conn.close();
      return { rawEmails: [], error: "Login failed: " + loginResp.substring(0, 200) };
    }

    // Only search INBOX - other folders are rarely needed and waste CPU
    const folders = ["INBOX"];
    
    let allMessageIds: number[] = [];
    let tagCounter = 2;

    for (const folder of folders) {
      const selectResp = await sendCommand(`A00${tagCounter}`, `SELECT "${folder}"`);
      
      const existsMatch = selectResp.match(/\* (\d+) EXISTS/);
      const totalMessages = existsMatch ? parseInt(existsMatch[1]) : 0;
      console.log(`[IMAP] ${folder} has ${totalMessages} messages`);
      tagCounter++;

      if (totalMessages === 0) continue;

      const searchResp = await sendCommand(`A00${tagCounter}`, `SEARCH SINCE ${sinceDateStr}`);
      tagCounter++;

      const searchLine = searchResp.split("\r\n").find(l => l.startsWith("* SEARCH"));
      if (!searchLine || searchLine.trim() === "* SEARCH") continue;

      const messageIds = searchLine.replace("* SEARCH ", "").trim().split(" ").map(Number).filter(n => n > 0);
      console.log(`[IMAP] ${folder}: Found ${messageIds.length} messages since ${sinceDateStr}`);

      allMessageIds = allMessageIds.concat(messageIds);
    }

    console.log(`[IMAP] Total messages to check: ${allMessageIds.length}`);

    // STEP 1: Pre-filter with BODYSTRUCTURE to find only emails with XML/PDF attachments
    // This is much faster than downloading full BODY[] for every email
    const candidateIds: number[] = [];
    
    for (let i = 0; i < allMessageIds.length; i++) {
      const msgId = allMessageIds[i];
      try {
        const structResp = await sendCommand(`S${i}`, `FETCH ${msgId} BODYSTRUCTURE`);
        const structLower = structResp.toLowerCase();
        
        // Check if this email has XML or PDF attachments
        const hasXml = structLower.includes('.xml') || structLower.includes('application/xml') || 
                       structLower.includes('text/xml') || structLower.includes('application/octet-stream');
        const hasPdf = structLower.includes('.pdf') || structLower.includes('application/pdf');
        
        if (hasXml || hasPdf) {
          candidateIds.push(msgId);
        }
      } catch (e) {
        // If BODYSTRUCTURE fails, include the message as candidate
        candidateIds.push(msgId);
      }
    }

    console.log(`[IMAP] ${candidateIds.length} emails have XML/PDF attachments (filtered from ${allMessageIds.length})`);

    // STEP 2: Only download full BODY[] for candidates (limit to last 100 to prevent timeout)
    const messagesToFetch = candidateIds.slice(-100);

    for (let i = 0; i < messagesToFetch.length; i++) {
      const msgId = messagesToFetch[i];
      
      try {
        const fetchCmd = `F${i} FETCH ${msgId} BODY[]`;
        await conn.write(encoder.encode(fetchCmd + "\r\n"));
        
        let emailContent = "";
        let fetchAttempts = 0;
        const maxFetchTime = Date.now() + 15000; // 15s per email max
        
        while (Date.now() < maxFetchTime && fetchAttempts < 300) {
          const n = await conn.read(buffer);
          if (n === null) break;
          emailContent += decoder.decode(buffer.subarray(0, n));
          
          if (emailContent.includes(`F${i} OK`)) break;
          if (emailContent.includes(`F${i} NO`) || emailContent.includes(`F${i} BAD`)) break;
          
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

// Función para extraer TODOS los boundaries de un email (incluyendo anidados)
function findAllBoundaries(content: string): string[] {
  const boundaries: string[] = [];
  const regex = /boundary="?([^"\r\n;]+)"?/gi;
  let match;
  while ((match = regex.exec(content)) !== null) {
    boundaries.push(match[1]);
  }
  return boundaries;
}

// Función para extraer adjuntos XML de un email raw (soporta MIME anidado)
function extractXmlAttachments(rawEmail: string): Array<{ filename: string; content: string }> {
  const attachments: Array<{ filename: string; content: string }> = [];
  
  const boundaries = findAllBoundaries(rawEmail);
  if (boundaries.length === 0) {
    return attachments;
  }

  for (const boundary of boundaries) {
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
      
      for (const b of boundaries) {
        const endIdx = content.indexOf("--" + b);
        if (endIdx !== -1) {
          content = content.substring(0, endIdx);
        }
      }
      content = content.trim();

      let decodedContent: string;
      
      if (encoding === "BASE64") {
        try {
          const cleanBase64 = content.replace(/[\r\n\s]/g, "");
          const binaryStr = atob(cleanBase64);
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

      if (isHaciendaResponse(filename, decodedContent)) {
        console.log(`[Bluehost] Skipping Hacienda response/message: ${filename}`);
        continue;
      }

      if (decodedContent.includes("<Clave>")) {
        const alreadyAdded = attachments.some(a => a.filename === filename);
        if (!alreadyAdded) {
          console.log(`[Bluehost] ✓ Valid invoice XML found: ${filename}`);
          attachments.push({ filename, content: decodedContent });
        }
      } else {
        console.log(`[Bluehost] Skipping XML without Clave: ${filename}`);
      }
    }
  }

  return attachments;
}

// Función para extraer adjuntos PDF de un email raw (soporta MIME anidado)
function extractPdfAttachments(rawEmail: string): Array<{ filename: string; content: Uint8Array }> {
  const attachments: Array<{ filename: string; content: Uint8Array }> = [];
  
  const boundaries = findAllBoundaries(rawEmail);
  if (boundaries.length === 0) {
    return attachments;
  }

  for (const boundary of boundaries) {
    const parts = rawEmail.split("--" + boundary);

    for (const part of parts) {
      const filenameMatch = part.match(/filename="?([^"\r\n]+\.pdf)"?/i);
      if (!filenameMatch) continue;

      const filename = filenameMatch[1].trim();
      
      if (attachments.some(a => a.filename === filename)) continue;

      const encodingMatch = part.match(/Content-Transfer-Encoding:\s*(\S+)/i);
      const encoding = encodingMatch ? encodingMatch[1].toUpperCase() : "7BIT";

      const contentStart = part.indexOf("\r\n\r\n");
      if (contentStart === -1) continue;

      let content = part.substring(contentStart + 4);
      
      for (const b of boundaries) {
        const endIdx = content.indexOf("--" + b);
        if (endIdx !== -1) {
          content = content.substring(0, endIdx);
        }
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
          console.error(`[Bluehost] Error decoding PDF base64 for ${filename}:`, e);
          continue;
        }
      } else {
        const enc = new TextEncoder();
        decodedContent = enc.encode(content);
      }

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
  }

  return attachments;
}

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
        console.log(`[Bluehost] ✓ Matched PDF ${pdf.filename} to XML ${xml.filename}`);
        break;
      }
    }
    
    // If no match by name, try matching any unmatched PDF in same email
    if (!matchedPdf && pdfAttachments.length === 1 && xmlAttachments.length === 1) {
      matchedPdf = pdfAttachments[0];
      console.log(`[Bluehost] ✓ Auto-matched single PDF ${matchedPdf.filename} to single XML ${xml.filename}`);
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

    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === supabaseKey;
    
    if (!isServiceRole) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) throw new Error("Invalid authorization");
    }

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

    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const sinceDateStr = `${startDate.getDate()}-${months[startDate.getMonth()]}-${startDate.getFullYear()}`;
    
    console.log(`[Bluehost] Searching for emails since ${sinceDateStr}`);

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

    for (const rawEmail of rawEmails) {
      try {
        const subjectMatch = rawEmail.match(/Subject:\s*([^\r\n]+)/i);
        const fromMatch = rawEmail.match(/From:\s*([^\r\n]+)/i);
        const emailSubject = subjectMatch ? subjectMatch[1].substring(0, 80) : "(no subject)";
        const emailFrom = fromMatch ? fromMatch[1].substring(0, 60) : "(unknown)";
        
        const xmlAttachments = extractXmlAttachments(rawEmail);
        const pdfAttachments = extractPdfAttachments(rawEmail);
        
        if (xmlAttachments.length > 0 || pdfAttachments.length > 0) {
          console.log(`[Bluehost] Email from: ${emailFrom} | Subject: ${emailSubject} | XMLs: ${xmlAttachments.length} PDFs: ${pdfAttachments.length}`);
        }
        
        const pdfMatches = matchPdfToXml(xmlAttachments, pdfAttachments);
        
        for (const xmlAttachment of xmlAttachments) {
          const claveMatch = xmlAttachment.content.match(/<Clave>(\d{50})<\/Clave>/);
          if (!claveMatch) {
            console.log(`[Bluehost] Skipping XML without valid Clave: ${xmlAttachment.filename}`);
            continue;
          }

          const docKey = claveMatch[1];
          
          // Log if this is the invoice being searched for
          if (docKey.includes("68900209010000000713") || xmlAttachment.filename.includes("68900209010000000713")) {
            console.log(`[Bluehost] 🎯 FOUND TARGET INVOICE: ${docKey} in file ${xmlAttachment.filename}`);
          }

          const { data: existing } = await supabase
            .from("processed_documents")
            .select("id, status, pdf_attachment_url")
            .eq("doc_key", docKey)
            .eq("organization_id", organization_id)
            .maybeSingle();

          if (existing && !force_resync) {
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
                  await supabase
                    .from("processed_documents")
                    .update({ 
                      pdf_attachment_url: pdfPath,
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
                pdfUrl = pdfPath;
                console.log(`[Bluehost] ✅ Uploaded PDF: ${pdfPath}`);
              } else {
                console.error(`[Bluehost] Error uploading PDF:`, uploadError);
              }
            } catch (pdfErr) {
              console.error(`[Bluehost] Error processing PDF:`, pdfErr);
            }
          }

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
