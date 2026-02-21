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

// ─── Recursive MIME parser ───
function parseMimeParts(body: string): Array<{ filename: string; content: string; contentType: string; encoding: string }> {
  const parts: Array<{ filename: string; content: string; contentType: string; encoding: string }> = [];

  function extractParts(section: string) {
    // Find boundary
    const boundaryMatch = section.match(/boundary="?([^\s";]+)"?/i);
    if (!boundaryMatch) {
      // Not multipart — check if it's an attachment itself
      extractSinglePart(section);
      return;
    }

    const boundary = boundaryMatch[1];
    const segments = section.split(`--${boundary}`);

    for (const seg of segments) {
      if (seg.startsWith("--") || seg.trim() === "") continue;
      
      // Check if this segment is itself multipart (nested)
      if (seg.match(/Content-Type:\s*multipart\//i)) {
        extractParts(seg);
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

    // Extract content type
    const ctMatch = headers.match(/Content-Type:\s*([^\s;]+)/i);
    const contentType = ctMatch ? ctMatch[1].toLowerCase() : "";

    // Extract encoding
    const encMatch = headers.match(/Content-Transfer-Encoding:\s*(\S+)/i);
    const encoding = encMatch ? encMatch[1].toLowerCase() : "7bit";

    // Extract filename from Content-Disposition or Content-Type
    let filename = "";
    
    // Try Content-Disposition filename
    const dispMatch = headers.match(/filename\*?=(?:utf-8''|UTF-8'')?\"?([^"\r\n;]+)\"?/i);
    if (dispMatch) {
      filename = decodeURIComponent(dispMatch[1].trim());
    }
    
    // Try name= in Content-Type
    if (!filename) {
      const nameMatch = headers.match(/name\*?=(?:utf-8''|UTF-8'')?\"?([^"\r\n;]+)\"?/i);
      if (nameMatch) {
        filename = decodeURIComponent(nameMatch[1].trim());
      }
    }

    // Also handle RFC 2231 continuation: filename*0*= filename*1*= etc.
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

  extractParts(body);
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
  // For quoted-printable or 7bit, treat as text
  return new TextEncoder().encode(content);
}

// ─── IMAP Client ───
async function fetchEmailsViaIMAP(
  host: string,
  port: number,
  email: string,
  password: string,
  sinceDateStr: string
): Promise<{ emails: FetchedEmail[]; error?: string }> {
  const allEmails: FetchedEmail[] = [];

  try {
    const conn = await Deno.connectTls({ hostname: host, port });
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // Use a large buffer for attachment data (2MB)
    const BUFFER_SIZE = 2 * 1024 * 1024;
    const buffer = new Uint8Array(BUFFER_SIZE);

    const readResponse = async (): Promise<string> => {
      let response = "";
      let attempts = 0;
      while (attempts < 50) {
        const n = await conn.read(buffer);
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
      const tag = `T${tagN++}`;
      await conn.write(encoder.encode(`${tag} ${command}\r\n`));
      let resp = "";
      let attempts = 0;
      const maxAttempts = expectLarge ? 600 : 200;
      while (attempts < maxAttempts) {
        const n = await conn.read(buffer);
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
      return { emails: [], error: "Server did not send OK greeting" };
    }

    const loginResp = await cmd(`LOGIN "${email}" "${password}"`);
    if (!loginResp.includes("OK")) {
      conn.close();
      return { emails: [], error: "Login failed" };
    }

    // Search multiple folders
    const foldersToSearch = ['"INBOX"', '"Junk"', '"Spam"', '"INBOX.Junk"', '"INBOX.Spam"'];

    for (const folder of foldersToSearch) {
      try {
        const selectResp = await cmd(`SELECT ${folder}`);
        if (selectResp.includes("NO") || selectResp.includes("BAD")) {
          continue; // Folder doesn't exist
        }

        const searchResp = await cmd(`SEARCH SINCE ${sinceDateStr}`);
        const searchLine = searchResp.split("\r\n").find(l => l.startsWith("* SEARCH"));
        if (!searchLine || searchLine.trim() === "* SEARCH") {
          console.log(`[IMAP] Folder ${folder}: no messages since ${sinceDateStr}`);
          continue;
        }

        const allMsgIds = searchLine.replace("* SEARCH ", "").trim().split(" ").map(Number).filter(n => n > 0);
        console.log(`[IMAP] Folder ${folder}: ${allMsgIds.length} messages since ${sinceDateStr}`);

        // STEP 1: Pre-filter using BODYSTRUCTURE to find emails with attachments
        const candidateIds: number[] = [];
        for (const msgId of allMsgIds) {
          try {
            const structResp = await cmd(`FETCH ${msgId} BODYSTRUCTURE`);
            const structLower = structResp.toLowerCase();
            const hasAttachment = structLower.includes('.xml') || structLower.includes('.pdf') ||
              structLower.includes('application/xml') || structLower.includes('text/xml') ||
              structLower.includes('application/pdf');
            if (hasAttachment) {
              candidateIds.push(msgId);
            }
          } catch {
            // If BODYSTRUCTURE fails, include as candidate anyway
            candidateIds.push(msgId);
          }
        }

        console.log(`[IMAP] Folder ${folder}: ${candidateIds.length} candidates with XML/PDF attachments`);

        // STEP 2: Fetch FULL BODY for candidates (reliable MIME parsing)
        // Process last 500 to cover full month history
        const toFetch = candidateIds.slice(-500);

        for (const msgId of toFetch) {
          try {
            // Fetch full message body (expectLarge=true for big attachments)
            const bodyResp = await cmd(`FETCH ${msgId} BODY[]`, true);

            // Extract raw email content between the literal marker and the final tag
            const literalMatch = bodyResp.match(/\{(\d+)\}\r\n/);
            let rawEmail: string;
            if (literalMatch) {
              const start = bodyResp.indexOf(literalMatch[0]) + literalMatch[0].length;
              const size = parseInt(literalMatch[1]);
              rawEmail = bodyResp.substring(start, start + size);
            } else {
              rawEmail = bodyResp;
            }

            // Parse MIME parts recursively
            const mimeParts = parseMimeParts(rawEmail);

            const emailObj: FetchedEmail = { subject: "", from: "", xmlAttachments: [], pdfAttachments: [] };

            // Extract subject/from from headers
            const subjectMatch = rawEmail.match(/^Subject:\s*(.+)$/mi);
            const fromMatch = rawEmail.match(/^From:\s*(.+)$/mi);
            emailObj.subject = subjectMatch ? subjectMatch[1].substring(0, 80).trim() : "(no subject)";
            emailObj.from = fromMatch ? fromMatch[1].substring(0, 60).trim() : "(unknown)";

            for (const part of mimeParts) {
              const fnameLower = part.filename.toLowerCase();

              // Skip Hacienda response XMLs
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
                  // Unknown type — try to detect by content
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
              console.log(`[IMAP] ✓ ${folder} msg ${msgId}: ${emailObj.xmlAttachments.length} XML, ${emailObj.pdfAttachments.length} PDF | ${emailObj.subject}`);
            }
          } catch (fetchErr) {
            console.error(`[IMAP] Error fetching msg ${msgId} from ${folder}:`, fetchErr);
          }
        }
      } catch (folderErr) {
        console.log(`[IMAP] Folder ${folder} not accessible: ${folderErr}`);
      }
    }

    try { await cmd("LOGOUT"); } catch { }
    try { conn.close(); } catch { }

    return { emails: allEmails };
  } catch (error) {
    console.error("[IMAP] Connection error:", error);
    return { emails: [], error: String(error) };
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
      // Default: rolling 7-day window for cron syncs (runs every 30 min)
      // This prevents 504 timeouts from scanning too many emails
      // Deduplication by doc_key ensures no invoices are missed over time
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
    }

    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const sinceDateStr = `${startDate.getDate()}-${months[startDate.getMonth()]}-${startDate.getFullYear()}`;

    console.log(`[Bluehost] Searching for emails since ${sinceDateStr}`);

    const { emails: fetchedEmails, error: imapError } = await fetchEmailsViaIMAP(
      imapHost,
      imapPort,
      credentials.email,
      credentials.password,
      sinceDateStr
    );

    if (imapError) {
      throw new Error(`IMAP error: ${imapError}`);
    }

    console.log(`[Bluehost] Retrieved ${fetchedEmails.length} emails with attachments`);

    const processedInvoices: any[] = [];
    const skippedInvoices: any[] = [];
    const errors: any[] = [];

    for (const emailObj of fetchedEmails) {
      try {
        const { xmlAttachments, pdfAttachments } = emailObj;

        if (xmlAttachments.length > 0 || pdfAttachments.length > 0) {
          console.log(`[Bluehost] Email from: ${emailObj.from} | Subject: ${emailObj.subject} | XMLs: ${xmlAttachments.length} PDFs: ${pdfAttachments.length}`);
        }

        const pdfMatches = matchPdfToXml(xmlAttachments, pdfAttachments);

        for (const xmlAttachment of xmlAttachments) {
          const claveMatch = xmlAttachment.content.match(/<Clave>(\d{50})<\/Clave>/);
          if (!claveMatch) {
            console.log(`[Bluehost] Skipping XML without valid Clave: ${xmlAttachment.filename}`);
            continue;
          }

          const docKey = claveMatch[1];

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
        messages_found: fetchedEmails.length,
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
