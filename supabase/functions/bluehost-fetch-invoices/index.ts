import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Simple IMAP client usando conexión TCP nativa de Deno
interface ParsedAttachment {
  filename: string;
  content: string; // base64-decoded text for XML, raw base64 for PDF
  type: "xml" | "pdf";
  rawBytes?: Uint8Array;
}

interface FetchedEmail {
  subject: string;
  from: string;
  xmlAttachments: Array<{ filename: string; content: string }>;
  pdfAttachments: Array<{ filename: string; content: Uint8Array }>;
}

// Parse BODYSTRUCTURE to find attachment part numbers + filenames
function parseBodystructureParts(resp: string): Array<{ partNum: string; filename: string; type: "xml" | "pdf"; encoding: string }> {
  const parts: Array<{ partNum: string; filename: string; type: "xml" | "pdf"; encoding: string }> = [];
  
  // Strategy: split by sections and find filenames with their part positions
  // IMAP BODYSTRUCTURE nests parts in parentheses. For multipart/mixed messages,
  // attachments are typically parts 2, 3, 4, etc. (part 1 is usually text body)
  
  const respLower = resp.toLowerCase();
  
  // Find all filename occurrences and determine their part numbers
  // We use a simpler heuristic: scan for filename patterns and count which 
  // top-level MIME section they belong to
  const filenameRegex = /filename[*]?(?:\*0\*?)?="?([^"\r\n;)]+)"?/gi;
  let match;
  const filenames: string[] = [];
  
  while ((match = filenameRegex.exec(resp)) !== null) {
    filenames.push(match[1].trim());
  }
  
  // Also try to find filenames with charset encoding like filename*=utf-8''name.xml
  const charsetFnRegex = /filename\*=(?:utf-8''|UTF-8'')([^\s\r\n;)]+)/gi;
  while ((match = charsetFnRegex.exec(resp)) !== null) {
    const decoded = decodeURIComponent(match[1].trim());
    if (!filenames.includes(decoded)) filenames.push(decoded);
  }
  
  // Determine encoding for each section - scan for base64/7bit/quoted-printable
  // In BODYSTRUCTURE, encoding appears right after the body type info
  
  // Assign part numbers: in a typical multipart message, part 1 = text body,
  // parts 2+ = attachments, in order of appearance
  let partCounter = 1; // Start at 1 (text body), attachments at 2+
  
  for (const fname of filenames) {
    partCounter++;
    const fnameLower = fname.toLowerCase();
    
    if (fnameLower.endsWith(".xml") && !fnameLower.startsWith("ahc-") && !fnameLower.includes("mensaje")) {
      parts.push({ partNum: String(partCounter), filename: fname, type: "xml", encoding: "BASE64" });
    } else if (fnameLower.endsWith(".pdf")) {
      parts.push({ partNum: String(partCounter), filename: fname, type: "pdf", encoding: "BASE64" });
    }
  }
  
  return parts;
}

async function fetchEmailsViaIMAP(
  host: string,
  port: number,
  email: string,
  password: string,
  sinceDateStr: string
): Promise<{ emails: FetchedEmail[]; error?: string }> {
  const emails: FetchedEmail[] = [];
  
  try {
    const conn = await Deno.connectTls({ hostname: host, port });
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const buffer = new Uint8Array(131072); // 128KB buffer for large attachments

    const readResponse = async (): Promise<string> => {
      let response = "";
      let attempts = 0;
      while (attempts < 50) {
        const n = await conn.read(buffer);
        if (n === null) break;
        response += decoder.decode(buffer.subarray(0, n));
        if (response.includes("\r\n") && 
            (response.includes("OK") || response.includes("NO") || response.includes("BAD") || response.includes("* "))) {
          if (response.endsWith("\r\n")) break;
        }
        attempts++;
        await new Promise(r => setTimeout(r, 100));
      }
      return response;
    };

    let tagN = 1;
    const cmd = async (command: string): Promise<string> => {
      const tag = `T${tagN++}`;
      await conn.write(encoder.encode(`${tag} ${command}\r\n`));
      let resp = "";
      let attempts = 0;
      while (attempts < 200) {
        const n = await conn.read(buffer);
        if (n === null) break;
        resp += decoder.decode(buffer.subarray(0, n));
        if (resp.includes(`${tag} OK`) || resp.includes(`${tag} NO`) || resp.includes(`${tag} BAD`)) break;
        attempts++;
        await new Promise(r => setTimeout(r, 50));
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

    await cmd('SELECT "INBOX"');

    const searchResp = await cmd(`SEARCH SINCE ${sinceDateStr}`);
    const searchLine = searchResp.split("\r\n").find(l => l.startsWith("* SEARCH"));
    if (!searchLine || searchLine.trim() === "* SEARCH") {
      await cmd("LOGOUT");
      conn.close();
      return { emails: [] };
    }

    const allMsgIds = searchLine.replace("* SEARCH ", "").trim().split(" ").map(Number).filter(n => n > 0);
    console.log(`[IMAP] Found ${allMsgIds.length} messages since ${sinceDateStr}`);

    // STEP 1: Pre-filter with BODYSTRUCTURE — only check for XML/PDF attachments
    const candidates: Array<{ msgId: number; parts: ReturnType<typeof parseBodystructureParts> }> = [];
    
    for (const msgId of allMsgIds) {
      try {
        const structResp = await cmd(`FETCH ${msgId} BODYSTRUCTURE`);
        const structLower = structResp.toLowerCase();
        
        const hasAttachment = structLower.includes('.xml') || structLower.includes('.pdf') ||
                              structLower.includes('application/xml') || structLower.includes('text/xml') ||
                              structLower.includes('application/pdf');
        
        if (hasAttachment) {
          const parts = parseBodystructureParts(structResp);
          if (parts.length > 0) {
            candidates.push({ msgId, parts });
          } else {
            // Couldn't parse parts but has attachments — include as fallback
            candidates.push({ msgId, parts: [] });
          }
        }
      } catch {
        candidates.push({ msgId, parts: [] });
      }
    }

    console.log(`[IMAP] ${candidates.length} emails have XML/PDF attachments`);

    // STEP 2: For each candidate, fetch ONLY the specific attachment parts (not full BODY[])
    const messagesToFetch = candidates.slice(-100); // last 100

    for (const { msgId, parts } of messagesToFetch) {
      const emailObj: FetchedEmail = { subject: "", from: "", xmlAttachments: [], pdfAttachments: [] };
      
      // Fetch headers only (lightweight)
      try {
        const headerResp = await cmd(`FETCH ${msgId} BODY[HEADER.FIELDS (Subject From)]`);
        const subjectMatch = headerResp.match(/Subject:\s*([^\r\n]+)/i);
        const fromMatch = headerResp.match(/From:\s*([^\r\n]+)/i);
        emailObj.subject = subjectMatch ? subjectMatch[1].substring(0, 80) : "(no subject)";
        emailObj.from = fromMatch ? fromMatch[1].substring(0, 60) : "(unknown)";
      } catch { /* headers are optional */ }
      
      if (parts.length > 0) {
        // TARGETED FETCH: download only specific MIME parts
        for (const part of parts) {
          try {
            const partResp = await cmd(`FETCH ${msgId} BODY[${part.partNum}]`);
            
            // Extract base64 data from response
            const dataStart = partResp.indexOf("\r\n");
            if (dataStart < 0) continue;
            const tagMatch = partResp.match(/T\d+\s+OK/);
            const dataEnd = tagMatch ? partResp.lastIndexOf(tagMatch[0]) : partResp.length;
            let b64Data = partResp.substring(dataStart + 2, dataEnd).replace(/[\r\n\s]/g, "").replace(/\)$/,"");
            
            if (b64Data.length < 50) continue;
            
            if (part.type === "xml") {
              try {
                const binaryStr = atob(b64Data);
                const bytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
                const decoded = new TextDecoder("utf-8").decode(bytes);
                
                if (decoded.includes("<Clave>")) {
                  emailObj.xmlAttachments.push({ filename: part.filename, content: decoded });
                  console.log(`[IMAP] ✓ XML part ${part.partNum}: ${part.filename}`);
                }
              } catch { /* decode error */ }
            } else if (part.type === "pdf") {
              try {
                const binaryStr = atob(b64Data);
                const bytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
                
                if (bytes.length > 4 && String.fromCharCode(...bytes.slice(0, 4)) === "%PDF") {
                  emailObj.pdfAttachments.push({ filename: part.filename, content: bytes });
                  console.log(`[IMAP] ✓ PDF part ${part.partNum}: ${part.filename} (${bytes.length} bytes)`);
                }
              } catch { /* decode error */ }
            }
          } catch (e) {
            console.error(`[IMAP] Error fetching part ${part.partNum} of msg ${msgId}:`, e);
          }
        }
      } else {
        // FALLBACK: parts couldn't be parsed, try sequential parts 2-6
        for (let pn = 2; pn <= 6; pn++) {
          try {
            const partResp = await cmd(`FETCH ${msgId} BODY[${pn}]`);
            if (partResp.includes("NIL") || partResp.includes(" NO ")) continue;
            
            const dataStart = partResp.indexOf("\r\n");
            if (dataStart < 0) continue;
            const tagMatch = partResp.match(/T\d+\s+OK/);
            const dataEnd = tagMatch ? partResp.lastIndexOf(tagMatch[0]) : partResp.length;
            let b64Data = partResp.substring(dataStart + 2, dataEnd).replace(/[\r\n\s]/g, "").replace(/\)$/,"");
            
            if (b64Data.length < 50) continue;
            
            try {
              const binaryStr = atob(b64Data);
              const bytes = new Uint8Array(binaryStr.length);
              for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
              const decoded = new TextDecoder("utf-8").decode(bytes);
              
              if (decoded.includes("<Clave>") && decoded.includes("<Emisor>")) {
                emailObj.xmlAttachments.push({ filename: `part-${pn}.xml`, content: decoded });
              } else if (bytes.length > 4 && String.fromCharCode(...bytes.slice(0, 4)) === "%PDF") {
                emailObj.pdfAttachments.push({ filename: `part-${pn}.pdf`, content: bytes });
              }
            } catch { /* not valid base64 */ }
          } catch { /* part fetch failed */ }
        }
      }
      
      if (emailObj.xmlAttachments.length > 0 || emailObj.pdfAttachments.length > 0) {
        emails.push(emailObj);
      }
    }

    try { await cmd("LOGOUT"); } catch {}
    try { conn.close(); } catch {}

    return { emails };
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
        console.log(`[Bluehost] ✓ Matched PDF ${pdf.filename} to XML ${xml.filename}`);
        break;
      }
    }
    
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
