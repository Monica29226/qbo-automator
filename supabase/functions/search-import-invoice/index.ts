import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// XML parsing helpers
function parseXMLValue(xml: string, tag: string): string {
  let regex = new RegExp(`<[\\w]*:?${tag}[^>]*>([^<]*)<\\/[\\w]*:?${tag}>`, 'i');
  let match = xml.match(regex);
  if (match) return match[1].trim();
  
  regex = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i');
  match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function parseNumeroConsecutivo(xml: string): string {
  const directValue = parseXMLValue(xml, 'NumeroConsecutivo');
  
  if (directValue && directValue.length > 0 && directValue.length <= 25) {
    return directValue;
  }
  
  const clave = parseXMLValue(xml, 'Clave');
  if (clave && clave.length === 50) {
    return clave.substring(30, 50);
  }
  
  if (directValue && directValue.length > 25) {
    return directValue.substring(directValue.length - 20);
  }
  
  return directValue || '';
}

function parseFolderList(listResp: string): string[] {
  const folders: string[] = [];
  const lines = listResp.split("\r\n");

  for (const line of lines) {
    if (!line.startsWith("* LIST ")) continue;

    const flagsMatch = line.match(/^\* LIST \(([^)]*)\) /);
    if (!flagsMatch) continue;
    const flags = flagsMatch[1].toLowerCase();
    if (flags.includes("\\noselect")) continue;
    if (flags.includes("\\trash") || flags.includes("\\sent") || flags.includes("\\drafts")) continue;

    const nameMatch = line.match(/\) (?:"[^"]*"|NIL) (?:"([^"]+)"|(\S+))\s*$/);
    if (!nameMatch) continue;

    const folderName = (nameMatch[1] || nameMatch[2] || "").trim();
    if (!folderName) continue;

    const nameLower = folderName.toLowerCase();
    if (
      nameLower.includes("trash") ||
      nameLower.includes("papelera") ||
      nameLower.includes("deleted") ||
      nameLower.includes("eliminados") ||
      nameLower.includes("draft") ||
      nameLower.includes("borrador") ||
      nameLower.includes("sent") ||
      nameLower.includes("enviados")
    ) {
      continue;
    }

    folders.push(folderName);
  }

  return [...new Set(folders)].sort((a, b) => {
    if (a.toUpperCase() === "INBOX") return -1;
    if (b.toUpperCase() === "INBOX") return 1;
    return 0;
  });
}

// Aggressive vendor-name normalization for matching (same convention as the rest of the system)
function normalizeVendor(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(s\.?a\.?|sociedad\s+anonima|s\.?r\.?l\.?|limitada|ltda|cia|y\s+cia)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeTaxId(s: string): string {
  return (s || '').replace(/[^0-9]/g, '');
}

// Helper function with aggressive timeout
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Global timeout for the entire function - 35 seconds max (frontend has 45s)
const GLOBAL_TIMEOUT_MS = 35000;

serve(async (req) => {
  const startTime = Date.now();
  const log = (msg: string) => console.log(`[${Date.now() - startTime}ms] ${msg}`);
  
  // Check global timeout helper
  const checkTimeout = () => {
    if (Date.now() - startTime > GLOBAL_TIMEOUT_MS - 2000) {
      throw new Error("TIMEOUT_GLOBAL");
    }
  };
  
  console.log("🚀 search-import-invoice STARTED");
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    console.log("📋 Auth header present:", !!authHeader);
    
    if (!authHeader) throw new Error("No authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    console.log("🔧 Supabase URL:", supabaseUrl ? "SET" : "MISSING");
    console.log("🔧 Supabase Key:", supabaseKey ? "SET" : "MISSING");
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    let requestBody;
    try {
      requestBody = await req.json();
      console.log("📥 Request body parsed:", JSON.stringify(requestBody));
    } catch (parseError) {
      console.error("❌ Failed to parse request body:", parseError);
      throw new Error("Invalid request body");
    }
    
    const { organization_id, invoice_number, auto_publish, expected_vendor, validate_november_2025, vendor_name, vendor_tax_id } = requestBody;

    if (!organization_id) throw new Error("organization_id required");

    const isVendorMode = !invoice_number && (vendor_name || vendor_tax_id);
    if (!invoice_number && !isVendorMode) throw new Error("invoice_number or vendor_name required");

    log(`🔍 Searching: ${invoice_number || `vendor="${vendor_name || ''}" taxId="${vendor_tax_id || ''}"`}`);
    if (expected_vendor) log(`   Vendor esperado: ${expected_vendor}`);

    // Helper function to check for existing invoice by doc_key (unique 50-char Clave) 
    // CRITICAL: doc_number alone is NOT unique - different vendors can have same invoice numbers
    // The doc_key contains the vendor's tax_id embedded in it, making it truly unique
    const checkExistingInvoice = async (docNumber: string, vendorTaxId: string | null, vendorName: string | null, docKey: string | null) => {
      // FIRST: Check by doc_key (the only truly unique identifier)
      if (docKey && docKey.length === 50) {
        const { data: byKey } = await supabase
          .from("processed_documents")
          .select("id, doc_key, doc_number, supplier_name, supplier_tax_id, status, qbo_entity_id, default_account_ref, issue_date, total_amount, currency")
          .eq("organization_id", organization_id)
          .eq("doc_key", docKey);
        
        if (byKey && byKey.length > 0) {
          log(`📋 Duplicado por doc_key: ${byKey[0].doc_number} de ${byKey[0].supplier_name}`);
          return byKey[0];
        }
      }
      
      // SECOND: If no doc_key provided, check by doc_number + vendor combination
      // This is a fallback - doc_number alone is NOT reliable for duplicate detection
      if (vendorTaxId) {
        const normalizedTaxId = vendorTaxId.replace(/[^0-9]/g, '');
        const { data: byNumber } = await supabase
          .from("processed_documents")
          .select("id, doc_key, doc_number, supplier_name, supplier_tax_id, status, qbo_entity_id, default_account_ref, issue_date, total_amount, currency")
          .eq("organization_id", organization_id)
          .eq("doc_number", docNumber);
        
        const exactMatch = byNumber?.find(doc => 
          doc.supplier_tax_id?.replace(/[^0-9]/g, '') === normalizedTaxId
        );
        
        if (exactMatch) {
          log(`📋 Duplicado por número+cédula: ${exactMatch.doc_number} de ${exactMatch.supplier_name}`);
          return exactMatch;
        }
        
        // Log if same number exists but different vendor (this is OK - NOT a duplicate!)
        if (byNumber && byNumber.length > 0) {
          log(`ℹ️ Mismo número ${docNumber} existe de OTRO proveedor: ${byNumber[0].supplier_name} (buscando: ${vendorName || vendorTaxId}) - NO es duplicado`);
        }
      }
      
      // No duplicate found - this invoice can be imported
      return null;
    };

    // Detect email provider for this organization
    log("📧 Detecting email provider...");
    const { data: emailAccounts } = await supabase
      .from("integration_accounts")
      .select("*")
      .eq("organization_id", organization_id)
      .eq("is_active", true)
      .in("service_type", ["gmail", "bluehost", "outlook", "hostinger"])
      .order("created_at", { ascending: false });

    const emailAccount = emailAccounts?.[0];
    if (!emailAccount) {
      throw new Error("No hay cuenta de correo configurada para esta organización");
    }

    const emailProvider = emailAccount.service_type;
    log(`📧 Provider: ${emailProvider} (${emailAccount.account_email || 'N/A'})`);

    let foundMessage: { id: string; xmlContent: string } | null = null;
    let foundPdfPart: any = null;

    // ==================== VENDOR-NAME SEARCH MODE ====================
    // Triggered when user searches by supplier name / tax id (not by invoice number).
    // Scans recent email attachments, parses every XML, and imports all whose <NombreEmisor>
    // (or <NumeroCedulaEmisor>) matches the normalized needle.
    if (isVendorMode) {
      const needleName = normalizeVendor(vendor_name || '');
      const needleTax = normalizeTaxId(vendor_tax_id || '');
      log(`🔎 Vendor mode — needle name: "${needleName}", tax: "${needleTax}"`);

      const imported: Array<{ doc_number: string; supplier_name: string; clave: string }> = [];
      const skippedDuplicates: string[] = [];
      let messagesScanned = 0;
      let xmlsScanned = 0;

      const matchesNeedle = (xml: string): { ok: boolean; emisorName: string; emisorTax: string } => {
        const emisorBlock = xml.match(/<Emisor[^>]*>([\s\S]*?)<\/Emisor>/i)?.[1] || "";
        const emisorName = parseXMLValue(emisorBlock, 'Nombre') || parseXMLValue(xml, 'NombreEmisor') || '';
        const emisorTax = parseXMLValue(emisorBlock, 'Numero')
          || parseXMLValue(emisorBlock, 'NumeroIdentificacion')
          || parseXMLValue(xml, 'NumeroCedulaEmisor') || '';
        const nName = normalizeVendor(emisorName);
        const nTax = normalizeTaxId(emisorTax);
        let ok = false;
        if (needleTax && nTax && nTax === needleTax) ok = true;
        if (!ok && needleName && nName && (nName.includes(needleName) || needleName.includes(nName))) ok = true;
        return { ok, emisorName, emisorTax };
      };

      const importXml = async (xmlContent: string, pdfPath: string | null) => {
        xmlsScanned++;
        const m = matchesNeedle(xmlContent);
        if (!m.ok) return;
        const clave = parseXMLValue(xmlContent, 'Clave');
        const docNum = parseNumeroConsecutivo(xmlContent);
        log(`✓ match vendor en clave ${clave?.substring(0, 20)}… (${m.emisorName})`);

        // Skip if already in DB
        const existing = await checkExistingInvoice(docNum, m.emisorTax, m.emisorName, clave);
        if (existing) {
          skippedDuplicates.push(`${docNum} (ya existe)`);
          return;
        }

        try {
          const resp = await fetchWithTimeout(
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
                pdf_attachment_url: pdfPath,
              }),
            },
            15000
          );
          const result = await resp.json();
          if (result?.success) {
            imported.push({ doc_number: docNum, supplier_name: m.emisorName, clave });
            const documentId = result.documentId || result.doc_id;
            if (auto_publish && documentId) {
              fetch(`${supabaseUrl}/functions/v1/publish-to-quickbooks`, {
                method: "POST",
                headers: { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ organization_id, document_ids: [documentId] }),
              }).catch(() => {});
            }
          } else {
            log(`⚠️ process-document-xml failed for ${docNum}: ${result?.message}`);
          }
        } catch (e: any) {
          log(`⚠️ Import error: ${e?.message || e}`);
        }
      };

      // ---------------- Gmail path ----------------
      if (emailProvider === "gmail") {
        const credentials = emailAccount.credentials as any;
        let accessToken = credentials?.access_token;
        if (!accessToken) throw new Error("No access token para Gmail");

        // Refresh token if needed
        const expiresAt = typeof credentials.expires_at === 'string'
          ? new Date(credentials.expires_at).getTime()
          : credentials.expires_at;
        if (expiresAt && (expiresAt - Date.now()) < 2 * 60 * 60 * 1000) {
          const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
          const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
          if (credentials.refresh_token && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
            try {
              const r = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                  client_id: GOOGLE_CLIENT_ID,
                  client_secret: GOOGLE_CLIENT_SECRET,
                  refresh_token: credentials.refresh_token,
                  grant_type: "refresh_token",
                }),
              }, 5000);
              if (r.ok) {
                const j = await r.json();
                accessToken = j.access_token;
                await supabase.from("integration_accounts").update({
                  credentials: { ...credentials, access_token: j.access_token, expires_at: Date.now() + (j.expires_in * 1000) },
                  updated_at: new Date().toISOString(),
                }).eq("id", emailAccount.id);
              }
            } catch (e) { log(`⚠️ Token refresh failed: ${e}`); }
          }
        }

        const term = (vendor_name || vendor_tax_id || '').replace(/"/g, '').trim();
        const queries = [
          `has:attachment filename:xml "${term}" newer_than:90d`,
          `has:attachment "${term}" newer_than:90d`,
        ];
        const seen = new Set<string>();
        const msgIds: string[] = [];
        for (const q of queries) {
          try {
            const r = await fetchWithTimeout(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=25`,
              { headers: { Authorization: `Bearer ${accessToken}` } },
              7000
            );
            if (r.ok) {
              const j = await r.json();
              for (const m of (j.messages || [])) {
                if (!seen.has(m.id)) { seen.add(m.id); msgIds.push(m.id); }
              }
            }
          } catch (e) { log(`⚠️ Gmail query error: ${e}`); }
        }
        log(`📬 Gmail: ${msgIds.length} mensajes candidatos`);

        function findAllParts(part: any, result: any[] = []): any[] {
          if (!part) return result;
          if (part.filename && part.filename.length > 0) result.push(part);
          if (part.parts && Array.isArray(part.parts)) for (const sp of part.parts) findAllParts(sp, result);
          return result;
        }

        for (const id of msgIds.slice(0, 20)) {
          try { checkTimeout(); } catch { break; }
          messagesScanned++;
          try {
            const r = await fetchWithTimeout(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`,
              { headers: { Authorization: `Bearer ${accessToken}` } },
              5000
            );
            if (!r.ok) continue;
            const md = await r.json();
            const allParts = findAllParts(md.payload);
            const xmlParts = allParts.filter((p: any) => p.filename?.toLowerCase().endsWith(".xml"));
            const pdfPart = allParts.find((p: any) => p.filename?.toLowerCase().endsWith(".pdf"));

            // Save PDF (if present) so importXml can attach it
            let savedPdfPath: string | null = null;
            if (pdfPart?.body?.attachmentId) {
              try {
                const pr = await fetchWithTimeout(
                  `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/attachments/${pdfPart.body.attachmentId}`,
                  { headers: { Authorization: `Bearer ${accessToken}` } },
                  4000
                );
                if (pr.ok) {
                  const pj = await pr.json();
                  const b64 = pj.data.replace(/-/g, "+").replace(/_/g, "/");
                  const bin = atob(b64);
                  const bytes = new Uint8Array(bin.length);
                  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                  const pdfPath = `${organization_id}/${pdfPart.filename || `vendor_${Date.now()}.pdf`}`;
                  await supabase.storage.from("company-documents").upload(pdfPath, bytes, { contentType: "application/pdf", upsert: true });
                  savedPdfPath = pdfPath;
                }
              } catch (e) { log(`⚠️ PDF save error: ${e}`); }
            }

            for (const xp of xmlParts.slice(0, 3)) {
              if (!xp?.body?.attachmentId) continue;
              try {
                const xr = await fetchWithTimeout(
                  `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/attachments/${xp.body.attachmentId}`,
                  { headers: { Authorization: `Bearer ${accessToken}` } },
                  3000
                );
                if (!xr.ok) continue;
                const xj = await xr.json();
                const b64 = xj.data.replace(/-/g, "+").replace(/_/g, "/");
                const bin = atob(b64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                const xml = new TextDecoder('utf-8').decode(bytes);
                if (xml.includes('<MensajeHacienda') || xml.includes('mensajeHacienda')) continue;
                const isInv = xml.includes('<FacturaElectronica') || xml.includes('<NotaCreditoElectronica')
                  || xml.includes('<NotaDebitoElectronica') || xml.includes('<TiqueteElectronico');
                if (!isInv) continue;
                await importXml(xml, savedPdfPath);
              } catch (e) { log(`⚠️ XML decode error: ${e}`); }
            }
          } catch (e) { log(`⚠️ Msg ${id} error: ${e}`); }
        }
      }
      // ---------------- IMAP path (hostinger/bluehost/outlook_imap) ----------------
      else {
        // Defer to fallback fetch functions for IMAP — they already scan attachments by date range.
        // We just need to tell the user we don't support deep vendor scan for IMAP yet.
        return new Response(JSON.stringify({
          success: false,
          message: `Búsqueda profunda por proveedor solo disponible en Gmail por ahora. Usá el sync automático para ${emailProvider}.`,
          provider: emailProvider,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const summary = imported.length > 0
        ? `Se importaron ${imported.length} factura(s) de "${vendor_name || vendor_tax_id}". Escaneados ${messagesScanned} correos, ${xmlsScanned} XML.`
        : `No se encontraron facturas nuevas de "${vendor_name || vendor_tax_id}" en los últimos 90 días. Escaneados ${messagesScanned} correos, ${xmlsScanned} XML${skippedDuplicates.length ? `, ${skippedDuplicates.length} duplicados ignorados` : ''}.`;
      log(`✅ Vendor mode done in ${Date.now() - startTime}ms — imported ${imported.length}, scanned ${xmlsScanned} XML`);

      return new Response(JSON.stringify({
        success: imported.length > 0,
        message: summary,
        imported: imported.length,
        invoices: imported,
        skipped_duplicates: skippedDuplicates.length,
        messages_scanned: messagesScanned,
        xmls_scanned: xmlsScanned,
        vendor_mode: true,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }


    // ==================== GMAIL SEARCH ====================
    if (emailProvider === "gmail") {
      const credentials = emailAccount.credentials as any;
      let accessToken = credentials?.access_token;
      
      if (!accessToken) {
        throw new Error("No access token para Gmail");
      }

      // Refresh token if needed
      const expiresAt = typeof credentials.expires_at === 'string' 
        ? new Date(credentials.expires_at).getTime() 
        : credentials.expires_at;
      
      if (expiresAt && (expiresAt - Date.now()) < 2 * 60 * 60 * 1000) {
        log("🔄 Refreshing Gmail token...");
        const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
        const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");

        if (credentials.refresh_token && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
          try {
            const refreshResponse = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                refresh_token: credentials.refresh_token,
                grant_type: "refresh_token",
              }),
            }, 5000);

            if (refreshResponse.ok) {
              const refreshData = await refreshResponse.json();
              accessToken = refreshData.access_token;
              
              await supabase
                .from("integration_accounts")
                .update({
                  credentials: {
                    ...credentials,
                    access_token: refreshData.access_token,
                    expires_at: Date.now() + (refreshData.expires_in * 1000),
                  },
                  updated_at: new Date().toISOString(),
                })
                .eq("id", emailAccount.id);
            }
          } catch (e) {
            log(`⚠️ Token refresh failed: ${e}`);
          }
        }
      }

      // Search Gmail - PARALLEL queries for speed
      log("🔍 Gmail search...");
      
      const query1 = `has:attachment filename:xml ${invoice_number}`;
      const query2 = `has:attachment ${invoice_number}`;
      
      const [search1, search2] = await Promise.all([
        fetchWithTimeout(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query1)}&maxResults=3`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
          8000
        ).then(r => r.ok ? r.json() : { messages: [] }).catch((e) => {
          log(`⚠️ Query1 error: ${e.message}`);
          return { messages: [] };
        }),
        fetchWithTimeout(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query2)}&maxResults=3`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
          8000
        ).then(r => r.ok ? r.json() : { messages: [] }).catch((e) => {
          log(`⚠️ Query2 error: ${e.message}`);
          return { messages: [] };
        })
      ]);
      
      const seenIds = new Set<string>();
      let messages: any[] = [];
      for (const msg of [...(search1.messages || []), ...(search2.messages || [])]) {
        if (!seenIds.has(msg.id)) {
          seenIds.add(msg.id);
          messages.push(msg);
        }
      }
      log(`📬 Found ${messages.length} messages (q1:${search1.messages?.length || 0}, q2:${search2.messages?.length || 0})`)

      if (messages.length === 0) {
        return new Response(
          JSON.stringify({
            success: false,
            message: `No se encontró en Gmail: ${invoice_number}`
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Fetch messages in parallel
      const messagePromises = messages.slice(0, 2).map((msg: any) =>
        fetchWithTimeout(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
          6000
        ).then(r => r.ok ? r.json() : null).catch((e) => {
          log(`⚠️ Message fetch error: ${e.message}`);
          return null;
        })
      );

      const messageResults = await Promise.all(messagePromises);
      log(`📩 Fetched ${messageResults.filter(Boolean).length} messages`);

      // Helper function to recursively find all attachments
      function findAllParts(part: any, result: any[] = []): any[] {
        if (!part) return result;
        if (part.filename && part.filename.length > 0) {
          result.push(part);
        }
        if (part.parts && Array.isArray(part.parts)) {
          for (const subPart of part.parts) {
            findAllParts(subPart, result);
          }
        }
        return result;
      }

      for (const messageData of messageResults) {
        if (!messageData || foundMessage) continue;
        
        const allParts = findAllParts(messageData.payload);
        log(`📎 Found ${allParts.length} attachments: ${allParts.map((p: any) => p.filename).join(', ')}`);
        
        const xmlParts = allParts.filter((p: any) => p.filename?.toLowerCase().endsWith(".xml"));
        const pdfPart = allParts.find((p: any) => p.filename?.toLowerCase().endsWith(".pdf"));

        const xmlPromises = xmlParts.slice(0, 2).map(async (xmlPart: any) => {
          if (!xmlPart?.body?.attachmentId) return null;
          try {
            const resp = await fetchWithTimeout(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageData.id}/attachments/${xmlPart.body.attachmentId}`,
              { headers: { Authorization: `Bearer ${accessToken}` } },
              2000
            );
            if (!resp.ok) return null;
            const data = await resp.json();
            const base64Fixed = data.data.replace(/-/g, "+").replace(/_/g, "/");
            const binaryString = atob(base64Fixed);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const content = new TextDecoder('utf-8').decode(bytes);
            return { xmlPart, content };
          } catch { return null; }
        });

        const xmlResults = await Promise.all(xmlPromises);
        
        for (const result of xmlResults) {
          if (!result || foundMessage) continue;
          
          const { content: xmlContent, xmlPart } = result;
          
          if (xmlContent.includes('<MensajeHacienda') || xmlContent.includes('mensajeHacienda')) {
            log(`⏭️ Skip MensajeHacienda: ${xmlPart.filename}`);
            continue;
          }

          const isInvoice = xmlContent.includes('<FacturaElectronica') || 
                            xmlContent.includes('<NotaCreditoElectronica') ||
                            xmlContent.includes('<NotaDebitoElectronica') ||
                            xmlContent.includes('<TiqueteElectronico') ||
                            xmlContent.includes('<Emisor>');
          
          if (!isInvoice) {
            log(`⏭️ Not an invoice: ${xmlPart.filename}`);
            continue;
          }

          const docNumber = parseNumeroConsecutivo(xmlContent);
          
          if (docNumber === invoice_number || 
              docNumber.includes(invoice_number) || 
              invoice_number.includes(docNumber)) {
            log(`✅ MATCH: ${docNumber}`);
            foundMessage = { id: messageData.id, xmlContent };
            foundPdfPart = pdfPart;
            break;
          }
        }
      }

      if (!foundMessage) {
        return new Response(
          JSON.stringify({
            success: false,
            message: `XML no encontrado en Gmail para: ${invoice_number}`
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    // ==================== NON-GMAIL (Bluehost/Outlook/Hostinger) ====================
    else {
      // For non-Gmail providers, first check if the invoice already exists in DB
      log(`🔍 Buscando factura ${invoice_number} en documentos existentes (provider: ${emailProvider})...`);
      
      const { data: existingDocs } = await supabase
        .from("processed_documents")
        .select("id, doc_key, doc_number, supplier_name, supplier_tax_id, status, qbo_entity_id, default_account_ref, issue_date, total_amount, currency, xml_data")
        .eq("organization_id", organization_id)
        .or(`doc_number.ilike.%${invoice_number}%,doc_key.ilike.%${invoice_number}%`);

      if (existingDocs && existingDocs.length > 0) {
        const existingDoc = existingDocs[0];
        log(`📋 Encontrado en DB: ${existingDoc.doc_number} de ${existingDoc.supplier_name} (status: ${existingDoc.status})`);
        
        // If already published, return info
        if (existingDoc.qbo_entity_id) {
          return new Response(
            JSON.stringify({
              success: true,
              message: `Ya en QBO (ID: ${existingDoc.qbo_entity_id}): ${existingDoc.supplier_name}`,
              existing: existingDoc,
              alreadyPublished: true,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        // If has account, publish it
        if (existingDoc.default_account_ref && auto_publish) {
          log(`📤 Existe sin QB, publicando: ${existingDoc.id}`);
          await supabase
            .from("processed_documents")
            .update({ status: "pending" })
            .eq("id", existingDoc.id);
          
          fetch(`${supabaseUrl}/functions/v1/publish-to-quickbooks`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ organization_id, document_ids: [existingDoc.id] }),
          }).catch(e => log(`⚠️ QB publish error: ${e}`));
          
          return new Response(
            JSON.stringify({
              success: true,
              message: `Existente → QB en cola: ${existingDoc.supplier_name}`,
              existing: existingDoc,
              qbQueued: true
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        return new Response(
          JSON.stringify({
            success: true,
            message: `Encontrada (pendiente configurar cuenta): ${existingDoc.supplier_name}`,
            existing: existingDoc,
            needsConfig: !existingDoc.default_account_ref
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Not found in DB - do a targeted IMAP search for this specific invoice
      log(`📥 No encontrada en DB, buscando directamente en ${emailProvider} vía IMAP...`);
      
      const credentials = emailAccount.credentials as any;
      if (!credentials?.email || !credentials?.password) {
        throw new Error(`Credenciales de ${emailProvider} incompletas`);
      }

      const imapHost = credentials.imap_host || 
        (emailProvider === "bluehost" ? "mail.cemsacr.com" : 
         emailProvider === "hostinger" ? "imap.hostinger.com" : 
         emailProvider === "outlook" ? "outlook.office365.com" : "localhost");
      const imapPort = credentials.imap_port || 993;

      log(`📧 IMAP connect: ${imapHost}:${imapPort} as ${credentials.email}`);

      try {
        const conn = await Deno.connectTls({ hostname: imapHost, port: imapPort });
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        const buf = new Uint8Array(65536);

        const readResp = async (): Promise<string> => {
          let resp = "";
          let attempts = 0;
          while (attempts < 50) {
            const n = await conn.read(buf);
            if (n === null) break;
            resp += decoder.decode(buf.subarray(0, n));
            if (resp.includes("\r\n") && (resp.includes("OK") || resp.includes("NO") || resp.includes("BAD"))) {
              if (resp.endsWith("\r\n")) break;
            }
            attempts++;
            await new Promise(r => setTimeout(r, 100));
          }
          return resp;
        };

        let tagN = 1;
        const cmd = async (command: string): Promise<string> => {
          const tag = `T${tagN++}`;
          await conn.write(encoder.encode(`${tag} ${command}\r\n`));
          let resp = "";
          let attempts = 0;
          while (attempts < 100) {
            const n = await conn.read(buf);
            if (n === null) break;
            resp += decoder.decode(buf.subarray(0, n));
            if (resp.includes(`${tag} OK`) || resp.includes(`${tag} NO`) || resp.includes(`${tag} BAD`)) break;
            attempts++;
            await new Promise(r => setTimeout(r, 100));
          }
          return resp;
        };

        const greeting = await readResp();
        if (!greeting.includes("OK")) {
          conn.close();
          throw new Error("IMAP greeting failed");
        }

        const loginResp = await cmd(`LOGIN "${credentials.email}" "${credentials.password}"`);
        if (!loginResp.includes("OK")) {
          conn.close();
          throw new Error("IMAP login failed");
        }

        const listResp = await cmd('LIST "" "*"');
        const discoveredFolders = parseFolderList(listResp);
        const foldersToSearch = discoveredFolders.length > 0
          ? discoveredFolders
          : ["INBOX", "Junk", "SPAM", "Spam"];
        let msgIds: number[] = [];
        let selectedFolder = "";
        let broaderScanIds: number[] = [];
        let broaderScanFolder = "";

        for (const folder of foldersToSearch) {
          checkTimeout();
          const selectResp = await cmd(`SELECT "${folder}"`);
          if (selectResp.includes("NO") || selectResp.includes("BAD")) {
            log(`⏭️ Folder ${folder} not available, skipping`);
            continue;
          }
          
          // Try TEXT search first (searches headers + body)
          const searchResp = await cmd(`SEARCH TEXT "${invoice_number}"`);
          log(`🔍 IMAP SEARCH ${folder}: ${searchResp.substring(0, 200)}`);

          const searchLine = searchResp.split("\r\n").find(l => l.startsWith("* SEARCH"));
          let ids = searchLine && searchLine.trim() !== "* SEARCH" 
            ? searchLine.replace("* SEARCH ", "").trim().split(" ").map(Number).filter(n => n > 0)
            : [];

          // If clave (50 digits), also try by cedula del emisor (positions 4-13)
          // and by NumeroConsecutivo (positions 21-40). These often appear in body/subject.
          if (ids.length === 0 && /^\d{50}$/.test(invoice_number)) {
            const cedulaEmisor = invoice_number.substring(3, 13).replace(/^0+/, "");
            const consecutivo = invoice_number.substring(21, 41);
            for (const term of [consecutivo, cedulaEmisor]) {
              if (!term || term.length < 6) continue;
              const altResp = await cmd(`SEARCH TEXT "${term}"`);
              const altLine = altResp.split("\r\n").find(l => l.startsWith("* SEARCH"));
              const altIds = altLine && altLine.trim() !== "* SEARCH"
                ? altLine.replace("* SEARCH ", "").trim().split(" ").map(Number).filter(n => n > 0)
                : [];
              if (altIds.length > 0 && altIds.length < 200) {
                ids = altIds;
                log(`🔍 Alt SEARCH "${term}" en ${folder}: ${altIds.length} candidatos`);
                break;
              }
            }
          }
          
          if (ids.length > 0) {
            msgIds = ids;
            selectedFolder = folder;
            log(`📬 Found ${ids.length} messages in ${folder}`);
            break;
          }
          
          // If TEXT search found nothing, try a broader SINCE search and scan attachments
          // This catches cases where the invoice number is only inside the XML attachment
          if (ids.length === 0 && !broaderScanIds.length) {
            log(`🔍 TEXT search empty, trying SINCE-based scan in ${folder}...`);
            const sinceDate = new Date();
            sinceDate.setDate(sinceDate.getDate() - 30);
            const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            const sinceDateStr = `${sinceDate.getDate()}-${months[sinceDate.getMonth()]}-${sinceDate.getFullYear()}`;
            
            const sinceResp = await cmd(`SEARCH SINCE ${sinceDateStr}`);
            const sinceLine = sinceResp.split("\r\n").find(l => l.startsWith("* SEARCH"));
            const sinceIds = sinceLine && sinceLine.trim() !== "* SEARCH"
              ? sinceLine.replace("* SEARCH ", "").trim().split(" ").map(Number).filter(n => n > 0)
              : [];
            
            if (sinceIds.length > 0) {
              // Take last 150 (most recent) — we'll filter for multipart quickly
              broaderScanIds = sinceIds.slice(-150);
              broaderScanFolder = folder;
              log(`📬 Broader scan candidate: ${sinceIds.length} messages since ${sinceDateStr}, checking last ${broaderScanIds.length} in ${folder}`);
            }
          }
        }

        if (msgIds.length === 0 && broaderScanIds.length > 0) {
          msgIds = broaderScanIds;
          selectedFolder = broaderScanFolder;
        }
        
        log(`📬 Final: ${msgIds.length} messages to check in ${selectedFolder || 'none'}`);
        
        if (msgIds.length === 0) {
          try { await cmd("LOGOUT"); } catch {}
          try { conn.close(); } catch {}
          return new Response(
            JSON.stringify({
              success: false,
              message: `No se encontró la factura ${invoice_number} en ${emailProvider} (${emailAccount.account_email || ''})`,
              provider: emailProvider
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // CRITICAL: Re-SELECT the folder where the msgIds came from.
        // The folder loop above may have SELECTed other folders after finding the IDs,
        // which makes subsequent FETCH commands fail with "Invalid messageset".
        if (selectedFolder) {
          const reselectResp = await cmd(`SELECT "${selectedFolder}"`);
          log(`🔄 Re-selected folder ${selectedFolder} before FETCH: ${reselectResp.substring(0, 100)}`);
        }

        let xmlContent = "";
        let pdfBase64 = "";
        let pdfFilename = "";

        // Scan candidates newest-first. Skip non-multipart messages quickly.
        const candidates = [...msgIds].reverse();
        let scannedAttachments = 0;
        const MAX_ATTACHMENT_SCANS = 40;
        for (const msgId of candidates) {
          if (xmlContent) break;
          if (scannedAttachments >= MAX_ATTACHMENT_SCANS) {
            log(`⏹️ Reached scan limit (${MAX_ATTACHMENT_SCANS} attachment scans)`);
            break;
          }
          checkTimeout();
          log(`📩 Fetching BODYSTRUCTURE for msg ${msgId}...`);
          
          // Step 1: Get BODYSTRUCTURE to find attachment part numbers
          const structResp = await cmd(`FETCH ${msgId} BODYSTRUCTURE`);
          // Quick skip: if no "multipart" and no filename hints, it's text-only — no attachments
          const structLowerQuick = structResp.toLowerCase();
          if (!structLowerQuick.includes("multipart") && !structLowerQuick.includes("filename") && !structLowerQuick.includes(".xml")) {
            continue;
          }
          scannedAttachments++;
          log(`📋 BODYSTRUCTURE (first 300): ${structResp.substring(0, 300)}`);
          
          // Parse part numbers for XML and PDF attachments
          // BODYSTRUCTURE returns nested structure - we need to find parts with .xml and .pdf filenames
          const structLower = structResp.toLowerCase();
          
          // Find all filename references with their approximate positions
          const xmlParts: { partNum: string; filename: string }[] = [];
          const pdfParts: { partNum: string; filename: string }[] = [];
          
          // Simple heuristic: count opening parens to determine part numbers
          // For typical emails with attachments, parts are numbered 1, 2, 3, etc.
          // We'll extract filenames and map them to sequential part numbers
          // Match both IMAP-style ("name" "x.xml") and MIME-style filename="x.xml"
          const nameMatches: string[] = [];
          for (const m of structResp.matchAll(/"name"\s+"([^"]+)"/gi)) nameMatches.push(m[1]);
          for (const m of structResp.matchAll(/filename[*]?\s*=\s*"([^"]+)"/gi)) nameMatches.push(m[1]);
          const seenF = new Set<string>();
          let attachmentIdx = 0;
          for (const fnameRaw of nameMatches) {
            const fname = fnameRaw.trim();
            if (!fname || seenF.has(fname)) continue;
            seenF.add(fname);
            attachmentIdx++;
            const partNum = String(attachmentIdx + 1);
            const fLower = fname.toLowerCase();
            if (fLower.endsWith(".xml") && !fLower.includes("ahc-") && !fLower.includes("mensajereceptor") && !fLower.includes("mensaje-receptor")) {
              xmlParts.push({ partNum, filename: fname });
              log(`📎 XML attachment: ${fname} -> part ${partNum}`);
            } else if (fLower.endsWith(".pdf")) {
              pdfParts.push({ partNum, filename: fname });
              log(`📎 PDF attachment: ${fname} -> part ${partNum}`);
            }
          }
          
          // If we couldn't parse parts, try a simpler approach: just try parts 2, 3, 4
          if (xmlParts.length === 0) {
            log(`⚠️ Could not parse BODYSTRUCTURE, trying sequential parts 2-5...`);
            for (let partNum = 2; partNum <= 5; partNum++) {
              checkTimeout();
              try {
                const partResp = await cmd(`FETCH ${msgId} BODY[${partNum}]`);
                if (partResp.includes("NIL") || partResp.includes("NO")) continue;
                
                // Extract the base64 content between { and the tag OK
                const dataStart = partResp.indexOf("\r\n");
                if (dataStart < 0) continue;
                const dataEnd = partResp.lastIndexOf(`\r\n`);
                let b64Data = partResp.substring(dataStart + 2, dataEnd).replace(/[\r\n\s]/g, "");
                // Remove trailing IMAP tag
                b64Data = b64Data.replace(/T\d+\s+OK.*$/i, "").replace(/\)$/,"");
                
                if (b64Data.length < 100) continue;
                
                try {
                  const decoded = atob(b64Data);
                  if (decoded.includes("<?xml") || decoded.includes("<FacturaElectronica") || 
                      decoded.includes("<NotaCreditoElectronica") || decoded.includes("<Emisor>")) {
                    const docNum = parseNumeroConsecutivo(decoded);
                    if (docNum === invoice_number || docNum.includes(invoice_number) || invoice_number.includes(docNum)) {
                      xmlContent = decoded;
                      log(`✅ XML match on part ${partNum}: docNum=${docNum}`);
                    }
                  } else if (decoded.startsWith("%PDF")) {
                    pdfBase64 = b64Data;
                    pdfFilename = `invoice-${invoice_number}.pdf`;
                    log(`📄 PDF found on part ${partNum}`);
                  }
                } catch { /* not valid base64 */ }
              } catch (e) {
                log(`⚠️ Part ${partNum} fetch error: ${e}`);
              }
            }
          } else {
            // Fetch XML parts
            for (const xp of xmlParts) {
              checkTimeout();
              log(`📥 Fetching XML part ${xp.partNum}...`);
              const partResp = await cmd(`FETCH ${msgId} BODY[${xp.partNum}]`);
              
              // Extract base64 data - IMAP response format: * N FETCH (BODY[X] {size}\r\n<data>\r\n)\r\nTAG OK ...
              // Strip everything before the literal size marker, and keep only valid base64 chars.
              let body = partResp;
              const litMatch = body.match(/\{(\d+)\}\r\n/);
              if (litMatch) body = body.substring(body.indexOf(litMatch[0]) + litMatch[0].length);
              else {
                const ds = body.indexOf("\r\n");
                if (ds >= 0) body = body.substring(ds + 2);
              }
              // Remove trailing IMAP tag/close paren
              body = body.replace(/\)\r?\n[A-Z]?T?\d+\s+OK[\s\S]*$/i, "").replace(/\)\s*$/, "");
              let b64Data = body.replace(/[^A-Za-z0-9+/=]/g, "");
              // Pad to multiple of 4
              while (b64Data.length % 4) b64Data += "=";
              if (b64Data.length < 50) continue;
              
              try {
                const decoded = atob(b64Data);
                if (decoded.includes("<FacturaElectronica") || decoded.includes("<NotaCreditoElectronica") || 
                    decoded.includes("<NotaDebitoElectronica") || decoded.includes("<TiqueteElectronico") ||
                    decoded.includes("<Emisor>")) {
                  const docNum = parseNumeroConsecutivo(decoded);
                  if (docNum === invoice_number || docNum.includes(invoice_number) || invoice_number.includes(docNum)) {
                    xmlContent = decoded;
                    log(`✅ XML match: ${xp.filename} (docNum: ${docNum})`);
                    break;
                  }
                }
              } catch (e) {
                log(`⚠️ Failed to decode XML ${xp.filename}: ${e}`);
              }
            }
            
            // Fetch PDF if XML was found
            if (xmlContent && pdfParts.length > 0) {
              const pp = pdfParts[0];
              log(`📥 Fetching PDF part ${pp.partNum}...`);
              try {
                const partResp = await cmd(`FETCH ${msgId} BODY[${pp.partNum}]`);
                let body = partResp;
                const litMatch = body.match(/\{(\d+)\}\r\n/);
                if (litMatch) body = body.substring(body.indexOf(litMatch[0]) + litMatch[0].length);
                else {
                  const ds = body.indexOf("\r\n");
                  if (ds >= 0) body = body.substring(ds + 2);
                }
                body = body.replace(/\)\r?\n[A-Z]?T?\d+\s+OK[\s\S]*$/i, "").replace(/\)\s*$/, "");
                let b64Data = body.replace(/[^A-Za-z0-9+/=]/g, "");
                while (b64Data.length % 4) b64Data += "=";
                if (b64Data.length > 100) {
                  pdfBase64 = b64Data;
                  pdfFilename = pp.filename;
                  log(`📄 PDF fetched: ${pp.filename}`);
                }
              } catch (e) {
                log(`⚠️ PDF fetch error: ${e}`);
              }
            }
          }

          if (xmlContent) break; // Found it, stop searching
        }

        // Logout and close
        try { await cmd("LOGOUT"); } catch {}
        try { conn.close(); } catch {}

        if (xmlContent) {
          log(`✅ Found XML via IMAP, processing...`);
          // We found the XML! Set it as foundMessage so the rest of the function processes it
          foundMessage = { id: `imap-${emailProvider}-${Date.now()}`, xmlContent };
          
          // If we also found a PDF, save it to storage
          if (pdfBase64 && pdfFilename) {
            try {
              const pdfBytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
              const pdfPath = `${organization_id}/${pdfFilename}`;
              await supabase.storage.from("company-documents").upload(pdfPath, pdfBytes, {
                contentType: "application/pdf",
                upsert: true,
              });
              const { data: urlData } = supabase.storage.from("company-documents").getPublicUrl(pdfPath);
              foundPdfPart = { savedUrl: urlData?.publicUrl, filename: pdfFilename };
              log(`📄 PDF saved: ${pdfFilename}`);
            } catch (e) {
              log(`⚠️ PDF save error: ${e}`);
            }
          }
        } else {
          return new Response(
            JSON.stringify({
              success: false,
              message: `No se encontró la factura ${invoice_number} en ${emailProvider} (${emailAccount.account_email || ''})`,
              provider: emailProvider
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } catch (imapErr: any) {
        log(`❌ IMAP error: ${imapErr.message}`);
        return new Response(
          JSON.stringify({
            success: false,
            message: `Error conectando a ${emailProvider}: ${imapErr.message}`,
            provider: emailProvider
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // CRITICAL: Now that we have the XML, extract doc_key and check for REAL duplicates
    // doc_key is a 50-character unique identifier that includes the vendor's tax ID
    const extractedDocKey = parseXMLValue(foundMessage.xmlContent, 'Clave');
    const extractedDocNumber = parseNumeroConsecutivo(foundMessage.xmlContent);
    
    // Parse vendor info from XML for accurate duplicate checking
    const emisorMatch = foundMessage.xmlContent.match(/<Emisor[^>]*>([\s\S]*?)<\/Emisor>/i);
    let extractedVendorTaxId = '';
    let extractedVendorName = '';
    if (emisorMatch) {
      extractedVendorName = parseXMLValue(emisorMatch[1], 'Nombre');
      extractedVendorTaxId = parseXMLValue(emisorMatch[1], 'Numero') || 
                            parseXMLValue(emisorMatch[1], 'NumeroIdentificacion');
      if (!extractedVendorTaxId) {
        const identMatch = emisorMatch[1].match(/<Identificacion[^>]*>([\s\S]*?)<\/Identificacion>/i);
        if (identMatch) {
          extractedVendorTaxId = parseXMLValue(identMatch[1], 'Numero');
        }
      }
    }
    
    log(`📋 XML encontrado - Clave: ${extractedDocKey?.substring(0, 20)}..., Proveedor: ${extractedVendorName} (${extractedVendorTaxId})`);
    
    // Check for duplicates using the doc_key (the ONLY truly unique identifier)
    const existingDoc = await checkExistingInvoice(extractedDocNumber, extractedVendorTaxId, extractedVendorName, extractedDocKey);
    if (existingDoc) {
      // If existing record claims "published", verify the QBO ID matches THIS vendor + doc_number.
      if (existingDoc.qbo_entity_id) {
        try {
          const { data: qboAccount } = await supabase
            .from("integration_accounts")
            .select("credentials")
            .eq("organization_id", organization_id)
            .eq("service_type", "quickbooks")
            .eq("is_active", true)
            .maybeSingle();

          const credentials = (qboAccount?.credentials as any) || null;
          const accessToken = credentials?.access_token;
          const realmId = credentials?.realm_id;

          if (accessToken && realmId) {
            const billId = String(existingDoc.qbo_entity_id).trim();

            const qboResp = await fetchWithTimeout(
              `https://quickbooks.api.intuit.com/v3/company/${realmId}/bill/${billId}?minorversion=73`,
              {
                method: 'GET',
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  Accept: 'application/json',
                  'Content-Type': 'application/json'
                },
              },
              6000
            );

            if (qboResp.ok) {
              const qboJson = await qboResp.json();
              const bill = qboJson?.Bill;
              const qboVendorName = String(bill?.VendorRef?.name || '').trim();
              const qboDocNumber = String(bill?.DocNumber || '').trim();

              const matchesVendor = qboVendorName.toLowerCase() === String(existingDoc.supplier_name || '').trim().toLowerCase();
              const matchesDocNumber = qboDocNumber === String(existingDoc.doc_number || '').trim();

              if (matchesVendor && matchesDocNumber) {
                log(`✅ Verificado en QBO (${billId}): ${qboVendorName} / ${qboDocNumber}`);
                return new Response(
                  JSON.stringify({
                    success: true,
                    message: `Ya en QBO (ID: ${billId}): ${existingDoc.supplier_name}`,
                    existing: existingDoc,
                    alreadyPublished: true,
                    qboVerified: true,
                    qbo: {
                      vendor_name: qboVendorName,
                      doc_number: qboDocNumber,
                      total_amount: bill?.TotalAmt,
                      txn_date: bill?.TxnDate,
                    }
                  }),
                  { headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
              }

              // Mismatch: QBO ID exists but belongs to another vendor/docNumber. Clear and re-queue.
              log(`⚠️ Inconsistencia: QBO Bill ${billId} es de "${qboVendorName}" (${qboDocNumber}), pero el sistema tiene "${existingDoc.supplier_name}" (${existingDoc.doc_number}). Reintentando publicación.`);
              await supabase
                .from("processed_documents")
                .update({ status: "processed", qbo_entity_id: null, qbo_entity_type: null, error_message: "Inconsistencia: QBO ID corresponde a otro proveedor. Reprocesando." })
                .eq("id", existingDoc.id);

              fetch(`${supabaseUrl}/functions/v1/publish-to-quickbooks`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${supabaseKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ organization_id, document_ids: [existingDoc.id] }),
              }).catch(e => log(`⚠️ QB publish error: ${e}`));

              return new Response(
                JSON.stringify({
                  success: true,
                  message: "Inconsistencia detectada: re-publicando a QBO.",
                  existing: existingDoc,
                  mismatch: true,
                  qbQueued: true,
                  qboFound: {
                    bill_id: billId,
                    vendor_name: qboVendorName,
                    doc_number: qboDocNumber,
                  }
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
          }
        } catch (e: any) {
          log(`⚠️ No se pudo verificar en QBO: ${e?.message || e}`);
        }

        // Fallback: cannot verify QBO, keep previous behavior
        log(`✅ Ya publicada en QB (${existingDoc.qbo_entity_id}): ${existingDoc.doc_number} de ${existingDoc.supplier_name}`);
        return new Response(
          JSON.stringify({
            success: true,
            message: `Ya en QBO (ID: ${existingDoc.qbo_entity_id}): ${existingDoc.supplier_name}`,
            existing: existingDoc,
            alreadyPublished: true,
            qboVerified: false,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // ALWAYS publish existing invoices that aren't in QB yet (if they have account configured)
      if (existingDoc.default_account_ref) {
        log(`📤 Existe sin QB, marcando pending y publicando: ${existingDoc.id}`);
        
        // First update status to pending
        await supabase
          .from("processed_documents")
          .update({ status: "pending" })
          .eq("id", existingDoc.id);
        
        // Then trigger QB publish - TRUE fire-and-forget using fetch, don't use supabase.functions.invoke
        fetch(`${supabaseUrl}/functions/v1/publish-to-quickbooks`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ organization_id, document_ids: [existingDoc.id] }),
        }).catch(e => log(`⚠️ QB publish error: ${e}`));
        
        return new Response(
          JSON.stringify({
            success: true,
            message: `Existente → QB en cola: ${existingDoc.supplier_name}`,
            existing: existingDoc,
            qbQueued: true
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // No account - mark as pending so user can configure and publish later
      log(`📋 Existe sin cuenta, marcando pending: ${existingDoc.id}`);
      await supabase
        .from("processed_documents")
        .update({ status: "pending" })
        .eq("id", existingDoc.id);
      
      // No account configured - return success anyway since we updated status
      return new Response(
        JSON.stringify({
          success: true,
          message: `Pendiente configurar cuenta: ${existingDoc.supplier_name}`,
          existing: existingDoc,
          needsConfig: true
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    log(`✅ No duplicado, procesando factura de: ${extractedVendorName}`);

    // Download PDF in parallel with XML processing (non-blocking)
    let pdfUrl = null;
    const pdfPromise = (async () => {
      // For IMAP providers, PDF was already saved during search
      if (foundPdfPart?.savedUrl) {
        log(`✓ PDF already saved via IMAP: ${foundPdfPart.filename}`);
        return foundPdfPart.savedUrl;
      }
      
      if (!foundPdfPart?.body?.attachmentId) return null;
      try {
        const pdfAttachmentResponse = await fetchWithTimeout(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${foundMessage.id}/attachments/${foundPdfPart.body.attachmentId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
          3000
        );

        if (pdfAttachmentResponse.ok) {
          const pdfData = await pdfAttachmentResponse.json();
          const pdfBase64 = pdfData.data.replace(/-/g, "+").replace(/_/g, "/");
          const pdfBinary = atob(pdfBase64);
          const pdfBytes = new Uint8Array(pdfBinary.length);
          for (let i = 0; i < pdfBinary.length; i++) {
            pdfBytes[i] = pdfBinary.charCodeAt(i);
          }

          const pdfPath = `${organization_id}/${invoice_number}.pdf`;
          await supabase.storage
            .from("company-documents")
            .upload(pdfPath, pdfBytes, {
              contentType: "application/pdf",
              upsert: true
            });
          
          log(`✓ PDF saved`);
          return pdfPath;
        }
      } catch (e) {
        log(`⚠️ PDF error: ${e}`);
      }
      return null;
    })();

    // Process the XML (wait for PDF in parallel)
    log("⚙️ Processing XML...");
    
    const [processResponse, resolvedPdfUrl] = await Promise.all([
      fetchWithTimeout(
        `${supabaseUrl}/functions/v1/process-document-xml`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            organization_id,
            xml_content: foundMessage.xmlContent,
            pdf_attachment_url: null, // Will update after
          }),
        },
        15000 // Increased from 8s to 15s for cold starts
      ),
      pdfPromise
    ]);

    pdfUrl = resolvedPdfUrl;

    const processResult = await processResponse.json();
    log(`⚙️ Process result: ${processResult.success ? 'OK' : processResult.message}`);
    
    if (!processResult.success) {
      return new Response(
        JSON.stringify({
          success: false,
          message: processResult.message || 'Error procesando XML',
          details: processResult
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // Update PDF URL if we got it - fix: use documentId or doc_id from response
    const documentId = processResult.documentId || processResult.doc_id;
    
    if (pdfUrl && documentId) {
      log(`📎 Updating PDF URL for document ${documentId}...`);
      await supabase
        .from("processed_documents")
        .update({ pdf_attachment_url: pdfUrl })
        .eq("id", documentId);
      log(`✅ PDF URL saved: ${pdfUrl}`);
    } else if (pdfUrl && !documentId) {
      log(`⚠️ PDF saved but no documentId to update!`);
    }
    const issueDate = processResult.document?.issue_date;

    // Validate November 2025
    if (validate_november_2025 && issueDate) {
      const date = new Date(issueDate);
      const isNovember2025 = date.getMonth() === 10 && date.getFullYear() === 2025;
      
      if (!isNovember2025) {
        log(`❌ Wrong date: ${issueDate}`);
        
        if (documentId) {
          await supabase.from("processed_documents").delete().eq("id", documentId);
          log(`🗑️ Deleted: ${documentId}`);
        }
        
        return new Response(
          JSON.stringify({
            success: false,
            message: `Fecha inválida: ${new Date(issueDate).toLocaleDateString('es-CR')} (solo Nov 2025)`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      log(`✅ Date OK: Nov 2025`);
    }

    // Auto-publish to QuickBooks - fire and forget (don't wait)
    if (auto_publish && documentId) {
      log("📤 QB queued (background)...");
      
      // Fire and forget - don't await
      fetch(`${supabaseUrl}/functions/v1/publish-to-quickbooks`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          organization_id,
          document_ids: [documentId],
        }),
      }).then(r => r.json()).then(result => {
        console.log(`[BG] QB publish ${documentId}: ${result.success ? 'OK' : result.error || 'failed'}`);
      }).catch(e => {
        console.log(`[BG] QB publish error: ${e.message}`);
      });
    }

    log(`✅ DONE in ${Date.now() - startTime}ms`);
    
    return new Response(
      JSON.stringify({
        success: true,
        message: auto_publish ? `Importada (QB en cola): ${invoice_number}` : `Importada: ${invoice_number}`,
        document: processResult.document,
        qbQueued: auto_publish,
        pdfSaved: !!pdfUrl
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        message: error.message || "Error desconocido" 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
