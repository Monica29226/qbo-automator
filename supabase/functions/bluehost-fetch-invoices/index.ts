import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FetchedEmail {
  subject: string;
  from: string;
  xmlAttachments: Array<{ filename: string; content: string }>;
  pdfAttachments: Array<{ filename: string; content: Uint8Array }>;
}

// ─── Escape IMAP quoted string ───
function escapeImapQuotedString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"").replace(/[\r\n]/g, "");
}

// ─── Recursive MIME parser ───
function parseMimeParts(body: string): Array<{ filename: string; content: string; contentType: string; encoding: string }> {
  const parts: Array<{ filename: string; content: string; contentType: string; encoding: string }> = [];
  const MAX_DEPTH = 10;

  function extractParts(section: string, depth: number = 0) {
    if (depth > MAX_DEPTH) {
      console.warn(`[MIME] Max recursion depth (${MAX_DEPTH}) reached, skipping nested parts`);
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
      filename = decodeURIComponent(dispMatch[1].trim());
    }
    if (!filename) {
      const nameMatch = headers.match(/name\*?=(?:utf-8''|UTF-8'')?\"?([^"\r\n;]+)\"?/i);
      if (nameMatch) {
        filename = decodeURIComponent(nameMatch[1].trim());
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
        filename = decodeURIComponent(contParts.join(""));
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
  const cleanB64 = content.replace(/[\r\n\s]/g, "");
  if (encoding === "base64") {
    const binaryStr = atob(cleanB64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    return bytes;
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

// ─── IMAP Client with timeouts ───
async function fetchEmailsViaIMAP(
  host: string,
  port: number,
  email: string,
  password: string,
  sinceDateStr: string,
  beforeDateStr?: string,
  skipCount: number = 0,
  globalDeadlineMs: number = 100_000, // 100 seconds max for entire IMAP operation
  searchTerm?: string                  // Optional sender/subject filter
): Promise<{
  emails: FetchedEmail[];
  error?: string;
  error_code?: string;
  total_messages_in_range?: number;
  emails_with_xml?: number;
  emails_with_pdf?: number;
  next_skip_count?: number;
  partial?: boolean;
}> {
  const allEmails: FetchedEmail[] = [];
  const deadline = Date.now() + globalDeadlineMs;
  const safeSkipCount = Math.max(0, skipCount || 0);

  function checkDeadline() {
    if (Date.now() > deadline) {
      throw new Error("TIMEOUT: IMAP operation exceeded time limit");
    }
  }

  let conn: Deno.TlsConn | null = null;

  try {
    // Connection timeout: 15 seconds
    const connectPromise = Deno.connectTls({ hostname: host, port });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`CONNECTION_TIMEOUT: Could not connect to ${host}:${port} within 15 seconds`)), 15_000)
    );

    try {
      conn = await Promise.race([connectPromise, timeoutPromise]);
    } catch (connErr) {
      const errMsg = connErr instanceof Error ? connErr.message : String(connErr);
      
      if (errMsg.includes("No route to host") || errMsg.includes("os error 113")) {
        return { emails: [], error: `CONNECT_FAILED: Cannot reach IMAP server ${host}:${port}. The server may be down or blocking connections from this IP.`, error_code: "CONNECT_FAILED" };
      }
      if (errMsg.includes("CONNECTION_TIMEOUT")) {
        return { emails: [], error: errMsg, error_code: "CONNECTION_TIMEOUT" };
      }
      if (errMsg.includes("Connection refused") || errMsg.includes("os error 111")) {
        return { emails: [], error: `CONNECT_REFUSED: IMAP server ${host}:${port} refused the connection. Check host/port settings.`, error_code: "CONNECT_REFUSED" };
      }
      if (errMsg.includes("certificate") || errMsg.includes("ssl") || errMsg.includes("tls")) {
        return { emails: [], error: `TLS_ERROR: SSL/TLS error connecting to ${host}:${port}: ${errMsg}`, error_code: "TLS_ERROR" };
      }
      return { emails: [], error: `CONNECT_ERROR: ${errMsg}`, error_code: "CONNECT_ERROR" };
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const BUFFER_SIZE = 2 * 1024 * 1024;
    const buffer = new Uint8Array(BUFFER_SIZE);

    const readResponse = async (): Promise<string> => {
      let response = "";
      let attempts = 0;
      while (attempts < 50) {
        checkDeadline();
        const n = await conn!.read(buffer);
        if (n === null) break;
        response += decoder.decode(buffer.subarray(0, n));
        if (response.includes("\r\n") &&
          (response.includes("OK") || response.includes("NO") || response.includes("BAD"))) {
          if (response.endsWith("\r\n")) break;
        }
        attempts++;
        await new Promise(r => setTimeout(r, 100));
      }
      return response;
    };

    let tagN = 1;
    const cmd = async (command: string, expectLarge = false): Promise<string> => {
      checkDeadline();
      const tag = `T${tagN++}`;
      await conn!.write(encoder.encode(`${tag} ${command}\r\n`));
      let resp = "";
      let attempts = 0;
      const maxAttempts = expectLarge ? 300 : 100;
      while (attempts < maxAttempts) {
        checkDeadline();
        const n = await conn!.read(buffer);
        if (n === null) break;
        resp += decoder.decode(buffer.subarray(0, n));
        if (resp.includes(`${tag} OK`) || resp.includes(`${tag} NO`) || resp.includes(`${tag} BAD`)) break;
        attempts++;
        await new Promise(r => setTimeout(r, expectLarge ? 100 : 50));
      }
      return resp;
    };

    const greeting = await readResponse();
    if (!greeting.includes("OK")) {
      conn.close();
      return { emails: [], error: `PROTOCOL_ERROR: Server greeting invalid: ${greeting.substring(0, 200)}`, error_code: "PROTOCOL_ERROR" };
    }

    // Login with properly escaped credentials
    const safeEmail = escapeImapQuotedString(email);
    const safePassword = escapeImapQuotedString(password);
    const loginResp = await cmd(`LOGIN "${safeEmail}" "${safePassword}"`);
    
    // Use tag-specific checks to avoid false positives (e.g. "NO" appearing in capability strings)
    const loginTag = `T${tagN - 1}`;
    console.log(`[IMAP] Login response (first 300 chars): ${loginResp.substring(0, 300)}`);
    
    if (loginResp.includes("AUTHENTICATIONFAILED") || loginResp.includes(`${loginTag} NO`)) {
      conn.close();
      return { emails: [], error: `AUTH_FAILED: IMAP login failed for ${email}. Server response: ${loginResp.substring(0, 200)}. Check credentials (use mailbox password, not panel password). If 2FA is enabled, use an app password.`, error_code: "IMAP_AUTH_FAILED" };
    }
    if (!loginResp.includes(`${loginTag} OK`)) {
      conn.close();
      return { emails: [], error: `AUTH_ERROR: Unexpected login response: ${loginResp.substring(0, 300)}`, error_code: "AUTH_ERROR" };
    }

    console.log(`[IMAP] ✅ Login successful for ${email}`);

    // Search folders - try primary first, then junk/spam
    const listResp = await cmd(`LIST "" "*"`);
    const discoveredFolders = parseFolderList(listResp);
    const foldersToSearch = discoveredFolders.length > 0
      ? discoveredFolders.map(f => `"${f.replace(/"/g, '\\"')}"`)
      : ['"INBOX"', '"Junk"', '"Spam"'];
    console.log(`[IMAP] Will scan ${foldersToSearch.length} folder(s): ${foldersToSearch.join(", ")}`);
    let totalCandidatesFetched = 0;
    let totalMessagesInRange = 0;
    let emailsWithXml = 0;
    let emailsWithPdf = 0;
    let totalCandidatesSeen = 0;

    const MAX_TOTAL_CANDIDATES = 120; // Global limit to prevent timeouts
    const BATCH_SIZE = 40;
    let timeLimitReached = false;

    for (const folder of foldersToSearch) {
      if (timeLimitReached || Date.now() > deadline - 10_000) {
        // Stop 10s before deadline to allow cleanup
        timeLimitReached = true;
        console.log(`[IMAP] ⏱️ Time limit approaching, stopping folder scan`);
        break;
      }

      try {
        const selectResp = await cmd(`SELECT ${folder}`);
        if (selectResp.includes("NO") || selectResp.includes("BAD")) {
          continue;
        }

        let searchQuery = beforeDateStr
          ? `SEARCH SINCE ${sinceDateStr} BEFORE ${beforeDateStr}`
          : `SEARCH SINCE ${sinceDateStr}`;
        if (searchTerm) {
          const safe = searchTerm.replace(/["\\]/g, "").trim();
          if (safe) {
            searchQuery = `${searchQuery} OR FROM "${safe}" SUBJECT "${safe}"`;
          }
        }
        const searchResp = await cmd(searchQuery);
        const searchLine = searchResp.split("\r\n").find(l => l.startsWith("* SEARCH"));
        if (!searchLine || searchLine.trim() === "* SEARCH") {
          console.log(`[IMAP] Folder ${folder}: no messages for range ${sinceDateStr}${beforeDateStr ? `..${beforeDateStr}` : '+'}`);
          continue;
        }

        const allMsgIds = searchLine.replace("* SEARCH ", "").trim().split(" ").map(Number).filter(n => n > 0);
        totalMessagesInRange += allMsgIds.length;
        console.log(`[IMAP] Folder ${folder}: ${allMsgIds.length} messages in range`);

        // STEP 1: Pre-filter using BODYSTRUCTURE - batch fetch by range (not individual)
        const msgIdsToScan = allMsgIds.slice(-80);
        const candidateIds: number[] = [];
        
        if (msgIdsToScan.length > 0) {
          try {
            // Use range-based FETCH to get all BODYSTRUCTURE in a single round-trip
            const rangeStr = msgIdsToScan.length === 1
              ? `${msgIdsToScan[0]}`
              : `${msgIdsToScan[0]}:${msgIdsToScan[msgIdsToScan.length - 1]}`;
            
            console.log(`[IMAP] Batch FETCH BODYSTRUCTURE for range ${rangeStr} (${msgIdsToScan.length} msgs)`);
            const batchResp = await cmd(`FETCH ${rangeStr} BODYSTRUCTURE`, true);
            
            // Parse batch response: each message starts with "* N FETCH"
            const msgIdsSet = new Set(msgIdsToScan);
            const fetchBlocks = batchResp.split(/^\* (\d+) FETCH /gm);
            
            // fetchBlocks alternates: [prefix, msgId1, body1, msgId2, body2, ...]
            for (let i = 1; i + 1 < fetchBlocks.length; i += 2) {
              const msgId = parseInt(fetchBlocks[i]);
              if (!msgIdsSet.has(msgId)) continue;
              
              const blockLower = fetchBlocks[i + 1].toLowerCase();
              const hasAttachment = blockLower.includes('.xml') || blockLower.includes('.pdf') ||
                blockLower.includes('application/xml') || blockLower.includes('text/xml') ||
                blockLower.includes('application/pdf') || blockLower.includes('message/rfc822') ||
                blockLower.includes('attachment') || blockLower.includes('multipart/mixed');
              if (hasAttachment) {
                candidateIds.push(msgId);
              }
            }
            
            // Fallback: if parser found nothing but we had messages, include all (safe default)
            if (candidateIds.length === 0 && msgIdsToScan.length > 0 && batchResp.length > 100) {
              console.log(`[IMAP] Batch parser found 0 candidates, falling back to include all ${msgIdsToScan.length} msgs`);
              candidateIds.push(...msgIdsToScan);
            }
          } catch (batchErr) {
            console.warn(`[IMAP] Batch BODYSTRUCTURE failed, falling back to include all:`, batchErr);
            candidateIds.push(...msgIdsToScan);
          }
        }

        console.log(`[IMAP] Folder ${folder}: ${candidateIds.length} candidates with XML/PDF attachments`);

        // STEP 2: Fetch full body for candidates - respect global limit
        const skipInThisFolder = Math.max(0, safeSkipCount - totalCandidatesSeen);
        totalCandidatesSeen += candidateIds.length;

        const candidatesAfterSkip = candidateIds.slice(skipInThisFolder);
        const remainingSlots = MAX_TOTAL_CANDIDATES - totalCandidatesFetched;
        const toFetch = candidatesAfterSkip.slice(0, Math.min(remainingSlots, BATCH_SIZE));

        if (skipInThisFolder > 0) {
          console.log(`[IMAP] Folder ${folder}: skipped ${skipInThisFolder} candidates (pagination)`);
        }

        for (const msgId of toFetch) {
          if (Date.now() > deadline - 15_000) {
            timeLimitReached = true;
            console.log(`[IMAP] ⏱️ Time limit reached during fetch, stopping`);
            break;
          }

          try {
            const bodyResp = await cmd(`FETCH ${msgId} BODY[]`, true);
            totalCandidatesFetched++;

            const literalMatch = bodyResp.match(/\{(\d+)\}\r\n/);
            let rawEmail: string;
            if (literalMatch) {
              const start = bodyResp.indexOf(literalMatch[0]) + literalMatch[0].length;
              const size = parseInt(literalMatch[1]);
              rawEmail = bodyResp.substring(start, start + size);
            } else {
              rawEmail = bodyResp;
            }

            const mimeParts = parseMimeParts(rawEmail);
            const emailObj: FetchedEmail = { subject: "", from: "", xmlAttachments: [], pdfAttachments: [] };

            const subjectMatch = rawEmail.match(/^Subject:\s*(.+)$/mi);
            const fromMatch = rawEmail.match(/^From:\s*(.+)$/mi);
            emailObj.subject = subjectMatch ? subjectMatch[1].substring(0, 80).trim() : "(no subject)";
            emailObj.from = fromMatch ? fromMatch[1].substring(0, 60).trim() : "(unknown)";

            for (const part of mimeParts) {
              const fnameLower = part.filename.toLowerCase();

              if (fnameLower.startsWith("ahc-") || fnameLower.includes("mensaje") || fnameLower.startsWith("respuesta")) {
                continue;
              }

              try {
                const bytes = decodePartContent(part.content, part.encoding);

                if (fnameLower.endsWith(".xml") || part.contentType.includes("xml")) {
                  const decoded = new TextDecoder("utf-8").decode(bytes);
                  if (decoded.includes("<Clave>")) {
                    emailObj.xmlAttachments.push({ filename: part.filename, content: decoded });
                  }
                } else if (fnameLower.endsWith(".pdf") || part.contentType === "application/pdf") {
                  if (bytes.length > 4 && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === "%PDF") {
                    emailObj.pdfAttachments.push({ filename: part.filename, content: bytes });
                  }
                } else if (part.contentType.includes("octet-stream") && part.filename) {
                  const decoded = new TextDecoder("utf-8").decode(bytes);
                  if (decoded.includes("<Clave>") && fnameLower.endsWith(".xml")) {
                    emailObj.xmlAttachments.push({ filename: part.filename, content: decoded });
                  } else if (bytes.length > 4 && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === "%PDF") {
                    emailObj.pdfAttachments.push({ filename: part.filename, content: bytes });
                  }
                }
              } catch (decErr) {
                console.error(`[IMAP] Decode error for ${part.filename}:`, decErr);
              }
            }

            if (emailObj.xmlAttachments.length > 0 || emailObj.pdfAttachments.length > 0) {
              allEmails.push(emailObj);
              if (emailObj.xmlAttachments.length > 0) emailsWithXml += 1;
              if (emailObj.pdfAttachments.length > 0) emailsWithPdf += 1;
              console.log(`[IMAP] ✓ ${folder} msg ${msgId}: ${emailObj.xmlAttachments.length} XML, ${emailObj.pdfAttachments.length} PDF | ${emailObj.subject}`);
            }
          } catch (fetchErr) {
            console.error(`[IMAP] Error fetching msg ${msgId} from ${folder}:`, fetchErr);
          }
        }

        if (totalCandidatesFetched >= MAX_TOTAL_CANDIDATES) {
          timeLimitReached = true;
          console.log(`[IMAP] Reached max candidates limit (${MAX_TOTAL_CANDIDATES})`);
        }
      } catch (folderErr) {
        console.log(`[IMAP] Folder ${folder} not accessible: ${folderErr}`);
      }
    }

    try { await cmd("LOGOUT"); } catch { }
    try { conn.close(); } catch { }

    const nextSkipCount = safeSkipCount + totalCandidatesFetched;
    const hasMoreCandidates = totalCandidatesSeen > nextSkipCount;
    const isPartial = timeLimitReached || hasMoreCandidates || totalCandidatesFetched >= MAX_TOTAL_CANDIDATES;

    return {
      emails: allEmails,
      total_messages_in_range: totalMessagesInRange,
      emails_with_xml: emailsWithXml,
      emails_with_pdf: emailsWithPdf,
      next_skip_count: nextSkipCount,
      partial: isPartial,
      ...(isPartial ? { error: "PARTIAL: Time limit reached or pagination required", error_code: "PARTIAL" } : {})
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[IMAP] Error:", errMsg);
    
    try { conn?.close(); } catch { }

    if (errMsg.includes("TIMEOUT")) {
      return { emails: allEmails, error: errMsg, error_code: "TIMEOUT" };
    }
    
    return { emails: allEmails, error: errMsg, error_code: "UNKNOWN" };
  }
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
        break;
      }
    }

    if (!matchedPdf && pdfAttachments.length === 1 && xmlAttachments.length === 1) {
      matchedPdf = pdfAttachments[0];
    }

    matches.set(xml.filename, matchedPdf);
  }

  return matches;
}

function isProcessableInvoiceXml(xmlContent: string): boolean {
  return /<(?:[\w]+:)?(?:FacturaElectronica|NotaCreditoElectronica|NotaDebitoElectronica|TiqueteElectronico)\b/i.test(xmlContent);
}

function extractDocKey(xmlContent: string): string | null {
  const match = xmlContent.match(/<(?:[\w]+:)?Clave[^>]*>(\d{50})<\/(?:[\w]+:)?Clave>/i);
  return match?.[1] ?? null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { organization_id, month, year, skip_count, force_resync, search_term, search_days } = await req.json();
    if (!organization_id) throw new Error("organization_id required");

    const parsedSkipCount = Number.isFinite(Number(skip_count)) ? Number(skip_count) : 0;

    console.log(`[Bluehost] Fetching invoices for org ${organization_id}`);

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
      console.error(`[Bluehost] No active account found. accountError: ${JSON.stringify(accountError)}`);
      throw new Error(`No active Bluehost account found for org ${organization_id}`);
    }

    const credentials = bluehostAccount.credentials as any;
    if (!credentials?.email || !credentials?.password) {
      throw new Error("Bluehost credentials incomplete - email or password missing");
    }

const imapHost = credentials.imap_host || "mail.cemsacr.com";
    const imapPort = credentials.imap_port || 993;

    console.log(`[Bluehost] Connecting to ${imapHost}:${imapPort} for ${credentials.email}`);

    const { data: settings } = await supabase
      .from("system_settings")
      .select("key, value")
      .eq("organization_id", organization_id)
      .in("key", ["mail_query", "start_date"]);

    const startDateSetting = settings?.find(s => s.key === "start_date")?.value;
    let startDate: Date;
    let beforeDate: Date | undefined;

    if (search_term && typeof search_term === "string" && search_term.trim()) {
      const days = Number.isFinite(Number(search_days)) ? Math.max(1, Number(search_days)) : 90;
      startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      beforeDate = undefined;
    } else if (month && year) {
      startDate = new Date(year, month - 1, 1);
      beforeDate = new Date(year, month, 1);
    } else if (startDateSetting) {
      startDate = new Date(startDateSetting);
    } else {
      const { data: latestImported } = await supabase
        .from("processed_documents")
        .select("issue_date")
        .eq("organization_id", organization_id)
        .order("issue_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestImported?.issue_date) {
        startDate = new Date(`${latestImported.issue_date}T00:00:00`);
      } else {
        const now = new Date();
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      }
    }

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const day = String(startDate.getDate()).padStart(2, '0');
    const sinceDateStr = `${day}-${monthNames[startDate.getMonth()]}-${startDate.getFullYear()}`;
    const beforeDateStr = beforeDate
      ? `${String(beforeDate.getDate()).padStart(2, '0')}-${monthNames[beforeDate.getMonth()]}-${beforeDate.getFullYear()}`
      : undefined;

    console.log(`[Bluehost] Searching emails with range: SINCE ${sinceDateStr}${beforeDateStr ? ` BEFORE ${beforeDateStr}` : ''} | skip_count=${parsedSkipCount}`);

    // Use 100s deadline for IMAP to leave room for document processing
    const {
      emails: fetchedEmails,
      error: imapError,
      error_code: imapErrorCode,
      total_messages_in_range,
      emails_with_xml,
      emails_with_pdf,
      next_skip_count,
      partial: imapPartial,
    } = await fetchEmailsViaIMAP(
      imapHost,
      imapPort,
      credentials.email,
      credentials.password,
      sinceDateStr,
      beforeDateStr,
      parsedSkipCount,
      100_000,
      typeof search_term === "string" ? search_term : undefined
    );

    // For fatal IMAP errors (auth, connection), throw immediately
    if (imapError && imapErrorCode && !["PARTIAL", "TIMEOUT"].includes(imapErrorCode) && fetchedEmails.length === 0) {
      throw new Error(`IMAP_${imapErrorCode}: ${imapError}`);
    }

    // For partial/timeout, continue with whatever emails we got
    if (imapError) {
      console.warn(`[Bluehost] IMAP warning: ${imapError} (got ${fetchedEmails.length} emails before issue)`);
    }

    console.log(`[Bluehost] Retrieved ${fetchedEmails.length} emails with attachments`);

    const processedInvoices: any[] = [];
    const skippedInvoices: any[] = [];
    const errors: any[] = [];

    for (const emailObj of fetchedEmails) {
      // Check if we're running out of time (leave 10s buffer)
      if (Date.now() - startTime > 130_000) {
        console.warn(`[Bluehost] ⏱️ Time limit reached during processing, stopping`);
        break;
      }

      try {
        const { xmlAttachments, pdfAttachments } = emailObj;

        if (xmlAttachments.length > 0 || pdfAttachments.length > 0) {
          console.log(`[Bluehost] Email from: ${emailObj.from} | Subject: ${emailObj.subject} | XMLs: ${xmlAttachments.length} PDFs: ${pdfAttachments.length}`);
        }

        const pdfMatches = matchPdfToXml(xmlAttachments, pdfAttachments);

        for (const xmlAttachment of xmlAttachments) {
          const xmlContent = xmlAttachment.content || "";

          if (!isProcessableInvoiceXml(xmlContent)) {
            skippedInvoices.push({
              filename: xmlAttachment.filename,
              reason: "XML no procesable (MensajeHacienda/MensajeReceptor)"
            });
            continue;
          }

          const docKey = extractDocKey(xmlContent);
          if (!docKey) {
            console.log(`[Bluehost] Skipping invoice XML without valid Clave: ${xmlAttachment.filename}`);
            skippedInvoices.push({
              filename: xmlAttachment.filename,
              reason: "XML facturable sin Clave válida"
            });
            continue;
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
                xml_content: xmlContent,
                pdf_attachment_url: pdfUrl,
                file_path: pdfPath,
                source: "bluehost",
              },
            }
          );

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
              console.log(`[Bluehost] ⏭️ Skipped ${xmlAttachment.filename}: ${errorMsg}`);
              skippedInvoices.push({ filename: xmlAttachment.filename, reason: errorMsg });
            } else {
              console.error(`[Bluehost] Error processing ${xmlAttachment.filename}:`, processError);
              errors.push({ filename: xmlAttachment.filename, error: errorMsg });
            }
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

    const existingSkippedCount = skippedInvoices.filter((item) => item.reason === "Already exists").length;
    const missingPdfImportedCount = processedInvoices.filter((item) => !item.has_pdf).length;
    const wasPartial = imapErrorCode === "PARTIAL" || imapErrorCode === "TIMEOUT" || !!imapPartial;
    const hasMoreToProcess = wasPartial && typeof next_skip_count === "number" && next_skip_count > parsedSkipCount;
    const elapsedMs = Date.now() - startTime;

    console.log(`[Bluehost] Complete in ${elapsedMs}ms: ${processedInvoices.length} processed, ${skippedInvoices.length} skipped, ${errors.length} errors${wasPartial ? ' (PARTIAL)' : ''}`);

    return new Response(
      JSON.stringify({
        success: true,
        status: hasMoreToProcess ? "partial" : "complete",
        partial: hasMoreToProcess,
        next_skip_count: hasMoreToProcess ? next_skip_count : undefined,
        time_limit_reached: wasPartial,
        total_messages_in_range,
        messages_found: fetchedEmails.length,
        emails_with_xml,
        emails_with_pdf,
        invoices_processed: processedInvoices.length,
        invoices_skipped: skippedInvoices.length,
        invoices_existing_skipped: existingSkippedCount,
        invoices_missing_pdf: missingPdfImportedCount,
        invoices_failed: errors.length,
        processed: processedInvoices,
        skipped: skippedInvoices,
        errors: errors.length > 0 ? errors : undefined,
        elapsed_ms: elapsedMs,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const elapsedMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Bluehost] Error after ${elapsedMs}ms:`, errorMessage);

    // Return descriptive error with category
    let errorCategory = "UNKNOWN";
    if (errorMessage.includes("AUTH_FAILED")) errorCategory = "AUTH_FAILED";
    else if (errorMessage.includes("CONNECT_FAILED") || errorMessage.includes("CONNECT_REFUSED")) errorCategory = "CONNECT_FAILED";
    else if (errorMessage.includes("CONNECTION_TIMEOUT")) errorCategory = "CONNECTION_TIMEOUT";
    else if (errorMessage.includes("TIMEOUT")) errorCategory = "TIMEOUT";
    else if (errorMessage.includes("TLS_ERROR")) errorCategory = "TLS_ERROR";
    else if (errorMessage.includes("No active Bluehost account")) errorCategory = "NO_ACCOUNT";
    else if (errorMessage.includes("credentials incomplete")) errorCategory = "CREDENTIALS_INCOMPLETE";

    return new Response(
      JSON.stringify({ 
        error: errorMessage, 
        error_category: errorCategory,
        elapsed_ms: elapsedMs,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
