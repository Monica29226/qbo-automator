import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ============================================================
// MIME / IMAP helpers (portados desde bluehost-fetch-invoices)
// Soportan multipart anidado (profundidad 10), base64 estricto,
// nombres en formato MIME y IMAP.
// ============================================================

function parseMimeParts(body: string): Array<{ filename: string; content: string; contentType: string; encoding: string }> {
  const parts: Array<{ filename: string; content: string; contentType: string; encoding: string }> = [];
  const MAX_DEPTH = 10;

  function extractParts(section: string, depth: number = 0) {
    if (depth > MAX_DEPTH) {
      console.warn(`[Hostinger MIME] Max recursion depth (${MAX_DEPTH}) reached, skipping nested parts`);
      return;
    }
    const boundaryMatch = section.match(/boundary="?([^\s";]+)"?/i);
    if (!boundaryMatch) {
      extractSinglePart(section);
      return;
    }
    const boundary = boundaryMatch[1];
    const segments = section.split(`--${boundary}`);
    for (const seg of segments) {
      if (seg.startsWith("--") || seg.trim() === "") continue;
      if (seg.match(/Content-Type:\s*multipart\//i)) {
        extractParts(seg, depth + 1);
      } else {
        extractSinglePart(seg);
      }
    }
  }

  function extractSinglePart(seg: string) {
    const headerBodySplit = seg.indexOf("\r\n\r\n");
    if (headerBodySplit < 0) return;
    const headers = seg.substring(0, headerBodySplit);
    const body = seg.substring(headerBodySplit + 4).trim();
    if (body.length < 20) return;

    const ctMatch = headers.match(/Content-Type:\s*([^\s;]+)/i);
    const contentType = ctMatch ? ctMatch[1].toLowerCase() : "";
    const encMatch = headers.match(/Content-Transfer-Encoding:\s*(\S+)/i);
    const encoding = encMatch ? encMatch[1].toLowerCase() : "7bit";

    let filename = "";
    const dispMatch = headers.match(/filename\*?=(?:utf-8''|UTF-8'')?\"?([^"\r\n;]+)\"?/i);
    if (dispMatch) {
      try { filename = decodeURIComponent(dispMatch[1].trim()); } catch { filename = dispMatch[1].trim(); }
    }
    if (!filename) {
      const nameMatch = headers.match(/name\*?=(?:utf-8''|UTF-8'')?\"?([^"\r\n;]+)\"?/i);
      if (nameMatch) {
        try { filename = decodeURIComponent(nameMatch[1].trim()); } catch { filename = nameMatch[1].trim(); }
      }
    }
    if (!filename) {
      const contParts: string[] = [];
      const contRegex = /filename\*(\d+)\*?=(?:utf-8''|UTF-8'')?\"?([^"\r\n;]+)\"?/gi;
      let m;
      while ((m = contRegex.exec(headers)) !== null) {
        contParts[parseInt(m[1])] = m[2];
      }
      if (contParts.length > 0) {
        try { filename = decodeURIComponent(contParts.join("")); } catch { filename = contParts.join(""); }
      }
    }

    const fnameLower = filename.toLowerCase();
    const isXml = fnameLower.endsWith(".xml") || contentType.includes("xml");
    const isPdf = fnameLower.endsWith(".pdf") || contentType === "application/pdf";

    if (isXml || isPdf || (filename && (contentType.includes("octet-stream") || contentType.includes("application/")))) {
      parts.push({ filename, content: body, contentType, encoding });
    }
  }

  extractParts(body, 0);
  return parts;
}

function decodePartContent(content: string, encoding: string): Uint8Array {
  if (encoding === "base64") {
    // Strict base64: remove any char that is not part of the base64 alphabet
    let cleanB64 = content.replace(/[^A-Za-z0-9+/=]/g, "");
    while (cleanB64.length % 4) cleanB64 += "=";
    const binaryStr = atob(cleanB64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    return bytes;
  }
  if (encoding === "quoted-printable") {
    const decoded = content
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    return new TextEncoder().encode(decoded);
  }
  return new TextEncoder().encode(content);
}

// Parse IMAP LIST response into folder names.
// Excludes Trash/Sent/Drafts and unselectable folders. INBOX first if present.
function parseFolderList(listResp: string): string[] {
  const folders: string[] = [];
  const lines = listResp.split("\r\n");
  for (const line of lines) {
    if (!line.startsWith("* LIST ")) continue;
    const flagsMatch = line.match(/^\* LIST \(([^)]*)\) /);
    if (!flagsMatch) continue;
    const flags = flagsMatch[1].toLowerCase();
    if (flags.includes("\\noselect")) continue;
    if (flags.includes("\\trash") || flags.includes("\\sent") ||
        flags.includes("\\drafts") || flags.includes("\\all") ||
        flags.includes("\\flagged") || flags.includes("\\important") ||
        flags.includes("\\archive")) continue;
    const nameMatch = line.match(/\) (?:"[^"]*"|NIL) (?:"([^"]+)"|(\S+))\s*$/);
    if (!nameMatch) continue;
    const folderName = (nameMatch[1] || nameMatch[2] || "").trim();
    if (!folderName) continue;
    const nameLower = folderName.toLowerCase();
    if (nameLower === "trash" || nameLower.includes("papelera") ||
        nameLower.includes("deleted") || nameLower.includes("eliminados") ||
        nameLower === "sent" || nameLower.includes("sent items") ||
        nameLower.includes("enviados") || nameLower === "drafts" ||
        nameLower.includes("borrador") || nameLower.includes("notes")) continue;
    folders.push(folderName);
  }
  folders.sort((a, b) => {
    if (a.toUpperCase() === "INBOX") return -1;
    if (b.toUpperCase() === "INBOX") return 1;
    return 0;
  });
  return folders;
}


// Simple IMAP client using Deno's native TCP connection
async function fetchEmailsViaIMAP(
  host: string,
  port: number,
  email: string,
  password: string,
  sinceDateStr: string,
  beforeDateStr?: string,  // Para filtrar hasta cierta fecha
  skipCount?: number,      // Para paginación - saltar los primeros N mensajes
  searchTerm?: string      // Para búsqueda inteligente por remitente/asunto
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

    // Discover all folders via LIST. Reading only INBOX would miss invoices
    // filtered to custom folders ("Facturas", "Proveedores", "Hacienda", etc.).
    const listResp = await sendCommand("A002", `LIST "" "*"`);
    let folders = parseFolderList(listResp);
    if (folders.length === 0) {
      console.log(`[Hostinger IMAP] LIST returned no folders, falling back to INBOX`);
      folders = ["INBOX"];
    }
    console.log(`[Hostinger IMAP] Will scan ${folders.length} folder(s): ${folders.join(", ")}`);

    const BATCH_SIZE = 50;
    const MAX_EXECUTION_TIME_MS = 50000;
    const functionStartTime = Date.now();
    let totalMessagesFoundGlobal = 0;
    let totalMessagesProcessedGlobal = 0;
    let globalSkipRemaining = skipCount || 0;

    folderLoop: for (let fIdx = 0; fIdx < folders.length; fIdx++) {
      const elapsedMs = Date.now() - functionStartTime;
      if (elapsedMs > MAX_EXECUTION_TIME_MS) {
        console.log(`[Hostinger IMAP] ⚠️ Time limit reached at folder ${fIdx}, stopping`);
        break;
      }
      if (totalMessagesProcessedGlobal >= BATCH_SIZE) {
        console.log(`[Hostinger IMAP] Batch size reached, stopping folder iteration`);
        break;
      }

      const folder = folders[fIdx];
      const folderQuoted = `"${folder.replace(/"/g, '\\"')}"`;
      const selectResp = await sendCommand(`AS${fIdx}`, `SELECT ${folderQuoted}`);
      if (!selectResp.includes("OK")) {
        console.log(`[Hostinger IMAP] Cannot SELECT folder "${folder}", skipping`);
        continue;
      }
      const existsMatch = selectResp.match(/\* (\d+) EXISTS/);
      const folderTotal = existsMatch ? parseInt(existsMatch[1]) : 0;
      if (folderTotal === 0) continue;

      let searchCmd = `SEARCH SINCE ${sinceDateStr}`;
      if (beforeDateStr) searchCmd = `SEARCH SINCE ${sinceDateStr} BEFORE ${beforeDateStr}`;
      if (searchTerm) {
        const safe = searchTerm.replace(/["\\]/g, "").trim();
        if (safe) searchCmd = `${searchCmd} OR FROM "${safe}" SUBJECT "${safe}"`;
      }
      const searchResp = await sendCommand(`AH${fIdx}`, searchCmd);
      const searchLine = searchResp.split("\r\n").find(l => l.startsWith("* SEARCH"));
      if (!searchLine || searchLine.trim() === "* SEARCH") continue;

      const messageIds = searchLine.replace("* SEARCH ", "").trim().split(" ").map(Number).filter(n => n > 0);
      totalMessagesFoundGlobal += messageIds.length;
      console.log(`[Hostinger IMAP] Folder "${folder}": ${messageIds.length} messages in range`);

      const skipInThisFolder = Math.min(globalSkipRemaining, messageIds.length);
      globalSkipRemaining -= skipInThisFolder;
      const messagesAfterSkip = messageIds.slice(skipInThisFolder);
      const remainingBatch = BATCH_SIZE - totalMessagesProcessedGlobal;
      const messagesToFetch = messagesAfterSkip.slice(0, remainingBatch);

      for (let i = 0; i < messagesToFetch.length; i++) {
        if (Date.now() - functionStartTime > MAX_EXECUTION_TIME_MS) {
          break folderLoop;
        }
        const msgId = messagesToFetch[i];
        try {
          const structCmd = `AT${fIdx}_${i} FETCH ${msgId} BODYSTRUCTURE`;
          await conn.write(encoder.encode(structCmd + "\r\n"));
          let structResp = "";
          let structAttempts = 0;
          while (structAttempts < 20) {
            const n = await conn.read(buffer);
            if (n === null) break;
            structResp += decoder.decode(buffer.subarray(0, n));
            if (structResp.includes(`AT${fIdx}_${i} OK`)) break;
            structAttempts++;
            await new Promise(r => setTimeout(r, 50));
          }
          const lowerStructResp = structResp.toLowerCase();
          // Lenient attachment detection — matches the proven Bluehost strategy.
          // Includes octet-stream, attachment dispositions, and multipart/mixed wrappers so
          // we don't drop emails where the XML/PDF is nested or has a generic content-type.
          const hasAttachment =
            lowerStructResp.includes('"xml"') || lowerStructResp.includes('application/xml') ||
            lowerStructResp.includes('text/xml') || lowerStructResp.includes('.xml') ||
            lowerStructResp.includes('"pdf"') || lowerStructResp.includes('application/pdf') ||
            lowerStructResp.includes('.pdf') ||
            lowerStructResp.includes('attachment') || lowerStructResp.includes('octet-stream') ||
            lowerStructResp.includes('multipart/mixed') || lowerStructResp.includes('message/rfc822');
          // Fallback: if BODYSTRUCTURE was truncated/unreadable, still try to fetch the body.
          if (!hasAttachment && lowerStructResp.length > 200 && !lowerStructResp.includes('multipart')) {
            continue;
          }

          const fetchCmd = `AB${fIdx}_${i} FETCH ${msgId} BODY[]`;
          await conn.write(encoder.encode(fetchCmd + "\r\n"));
          let emailContent = "";
          let fetchAttempts = 0;
          const maxFetchTime = Date.now() + 8000;
          while (Date.now() < maxFetchTime && fetchAttempts < 200) {
            const n = await conn.read(buffer);
            if (n === null) break;
            emailContent += decoder.decode(buffer.subarray(0, n));
            if (emailContent.includes(`AB${fIdx}_${i} OK`)) break;
            if (emailContent.includes(`AB${fIdx}_${i} NO`) || emailContent.includes(`AB${fIdx}_${i} BAD`)) break;
            fetchAttempts++;
            if (Date.now() - functionStartTime > MAX_EXECUTION_TIME_MS) break;
          }
          if (emailContent.length > 0) {
            // Extract raw email payload using the IMAP literal size marker `{N}\r\n`
            // so we trim IMAP wrappers before MIME parsing.
            const litMatch = emailContent.match(/\{(\d+)\}\r\n/);
            if (litMatch) {
              const start = emailContent.indexOf(litMatch[0]) + litMatch[0].length;
              const size = parseInt(litMatch[1]);
              emailContent = emailContent.substring(start, start + size);
            }
            rawEmails.push(emailContent);
          }

        } catch (msgErr) {
          console.error(`[Hostinger IMAP] Error fetching message ${msgId}:`, msgErr);
        }
      }
      totalMessagesProcessedGlobal += messagesToFetch.length;
    }

    await sendCommand("A999", "LOGOUT");
    conn.close();

    return {
      rawEmails,
      totalFound: totalMessagesFoundGlobal,
      processedCount: totalMessagesProcessedGlobal
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
// Extract XML attachments using the recursive MIME parser.
// Handles nested multipart/* (mixed/related/alternative) and strict base64.
function extractXmlAttachments(rawEmail: string): Array<{ filename: string; content: string }> {
  const attachments: Array<{ filename: string; content: string }> = [];
  const mimeParts = parseMimeParts(rawEmail);
  for (const part of mimeParts) {
    const fnameLower = part.filename.toLowerCase();
    const looksLikeXml = fnameLower.endsWith(".xml") || part.contentType.includes("xml");
    const looksLikeOctet = part.contentType.includes("octet-stream") && fnameLower.endsWith(".xml");
    if (!looksLikeXml && !looksLikeOctet) continue;
    try {
      const bytes = decodePartContent(part.content, part.encoding);
      const decodedContent = new TextDecoder("utf-8").decode(bytes);
      if (isHaciendaResponse(part.filename, decodedContent)) {
        console.log(`[Hostinger] Skipping Hacienda response/message: ${part.filename}`);
        continue;
      }
      if (decodedContent.includes("<Clave>")) {
        console.log(`[Hostinger] ✓ Valid invoice XML found: ${part.filename}`);
        attachments.push({ filename: part.filename, content: decodedContent });
      }
    } catch (e) {
      console.error(`[Hostinger] Error decoding XML ${part.filename}:`, e);
    }
  }
  return attachments;
}

// Extract PDF attachments using the recursive MIME parser.
function extractPdfAttachments(rawEmail: string): Array<{ filename: string; content: Uint8Array }> {
  const attachments: Array<{ filename: string; content: Uint8Array }> = [];
  const mimeParts = parseMimeParts(rawEmail);
  for (const part of mimeParts) {
    const fnameLower = part.filename.toLowerCase();
    const looksLikePdf = fnameLower.endsWith(".pdf") || part.contentType === "application/pdf";
    const looksLikeOctet = part.contentType.includes("octet-stream") && fnameLower.endsWith(".pdf");
    if (!looksLikePdf && !looksLikeOctet) continue;
    try {
      const bytes = decodePartContent(part.content, part.encoding);
      if (bytes.length > 4 && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === "%PDF") {
        console.log(`[Hostinger] ✓ Valid PDF found: ${part.filename} (${bytes.length} bytes)`);
        attachments.push({ filename: part.filename, content: bytes });
      }
    } catch (e) {
      console.error(`[Hostinger] Error decoding PDF ${part.filename}:`, e);
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

    // Fallback: if there's exactly one XML and one PDF in the email, pair them.
    if (!matchedPdf && xmlAttachments.length === 1 && pdfAttachments.length === 1) {
      matchedPdf = pdfAttachments[0];
      console.log(`[Hostinger] ✓ Paired single PDF/XML in email: ${pdfAttachments[0].filename} <-> ${xml.filename}`);
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

    const { organization_id, month, year, force_resync, skip_count, search_term, search_days } = await req.json();
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
    
    if (search_term && typeof search_term === "string" && search_term.trim()) {
      // Modo búsqueda inteligente: últimos N días, sin tope superior
      const days = Number.isFinite(Number(search_days)) ? Math.max(1, Number(search_days)) : 90;
      startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      endDate = undefined;
    } else if (month && year) {
      // Búsqueda específica de un mes - usar rango SINCE + BEFORE
      startDate = new Date(year, month - 1, 1);
      endDate = new Date(year, month, 1); // Primer día del mes siguiente
    } else if (startDateSetting) {
      startDate = new Date(startDateSetting);
    } else {
      // Default: start of PREVIOUS month to capture invoices that may have failed at month boundaries
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    }

    // Format dates for IMAP: DD-Mon-YYYY (with zero-padded day)
    const monthsArr = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const fmtDay = (d: Date) => String(d.getDate()).padStart(2, '0');
    const sinceDateStr = `${fmtDay(startDate)}-${monthsArr[startDate.getMonth()]}-${startDate.getFullYear()}`;
    const beforeDateStr = endDate 
      ? `${fmtDay(endDate)}-${monthsArr[endDate.getMonth()]}-${endDate.getFullYear()}`
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
      skip_count || 0,
      typeof search_term === "string" ? search_term : undefined
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
    let invoicesExistingSkipped = 0;
    let invoicesMissingPdf = 0;
    let stoppedEarly = false;
    const errors: string[] = [];
    const skippedInvoices: Array<{ doc_key?: string; filename?: string; reason: string }> = [];
    const processingStartTime = Date.now();
    const MAX_PROCESSING_TIME_MS = 40000; // 40s para drenar el lote bajo el límite duro de edge

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
              skippedInvoices.push({ filename: xml.filename, reason: "XML sin Clave válida" });
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
              invoicesExistingSkipped++;
              skippedInvoices.push({ doc_key: clave, filename: xml.filename, reason: "Ya existía en el sistema" });
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
              const errorMsg = processError.message || "";
              const msg = errorMsg.toLowerCase();
              const isSoftReject =
                msg.includes("duplicado") ||
                msg.includes("ya existe") ||
                msg.includes("fechaemision") ||
                msg.includes("not found") ||
                msg.includes("rechazada") ||
                msg.includes("receptor") ||
                msg.includes("no corresponde a factura") ||
                msg.includes("no procesable") ||
                msg.includes("tiquete") ||
                msg.includes("tipo 04") ||
                msg.includes("mensajehacienda") ||
                msg.includes("mensajereceptor") ||
                msg.includes("estadomensaje") ||
                msg.includes("fuera de rango") ||
                msg.includes("anterior a") ||
                msg.includes("cutoff");
              if (isSoftReject) {
                console.log(`[Hostinger] ⏭️ Skipped ${clave}: ${errorMsg}`);
                skippedInvoices.push({ doc_key: clave, filename: xml.filename, reason: errorMsg });
              } else {
                console.error(`[Hostinger] Error processing ${clave}:`, processError);
                errors.push(`${clave}: ${errorMsg}`);
                invoicesFailed++;
              }
            } else {
              console.log(`[Hostinger] ✓ Processed ${clave} - PDF saved: ${pdfUrl ? 'YES' : 'NO'}`);
              invoicesProcessed++;
              if (!pdfUrl) invoicesMissingPdf++;
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
        invoices_existing_skipped: invoicesExistingSkipped,
        invoices_missing_pdf: invoicesMissingPdf,
        invoices_skipped: skippedInvoices.length,
        partial: stoppedEarly || hasMoreMessages,
        total_messages_in_range: totalFound,
        messages_found: rawEmails.length,
        messages_processed_this_run: processedCount,
        next_skip_count: hasMoreMessages ? nextSkip : undefined,
        skipped: skippedInvoices,
        message: (stoppedEarly || hasMoreMessages)
          ? `Procesadas ${invoicesProcessed} facturas (correos ${currentSkip + 1}-${nextSkip} de ${totalFound || '?'}). Continuando…`
          : `Se procesaron ${invoicesProcessed} facturas de ${totalFound || '?'} correos encontrados.`,
        errors: errors.length > 0 ? errors.map((e) => ({ error: e })) : undefined,
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
