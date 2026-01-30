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
    
    const { organization_id, invoice_number, auto_publish, expected_vendor, validate_november_2025 } = requestBody;
    
    if (!organization_id) throw new Error("organization_id required");
    if (!invoice_number) throw new Error("invoice_number required");

    log(`🔍 Searching: ${invoice_number}`);
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

    // NOTE: We NO LONGER check for duplicates here before downloading the XML
    // This was causing false positives when the same invoice number exists from different vendors
    // The duplicate check will happen in process-document-xml using the doc_key (unique 50-char Clave)

    // Get Gmail account
    log("📧 Getting Gmail account...");
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
      throw new Error("No Gmail account found");
    }

    const credentials = gmailAccount.credentials as any;
    let accessToken = credentials?.access_token;
    
    if (!accessToken) {
      throw new Error("No access token");
    }

    // Refresh token if needed
    const expiresAt = typeof credentials.expires_at === 'string' 
      ? new Date(credentials.expires_at).getTime() 
      : credentials.expires_at;
    
    if (expiresAt && (expiresAt - Date.now()) < 2 * 60 * 60 * 1000) {
      log("🔄 Refreshing token...");
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
              .eq("id", gmailAccount.id);
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
    
    // Run BOTH queries in parallel - increased timeout to 8s for Gmail API
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
    
    // Merge and dedupe results (prefer query1)
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

    let foundMessage: { id: string; xmlContent: string } | null = null;
    let foundPdfPart: any = null;

    // Fetch messages in parallel - increased timeout to 6s
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

    // Process each message to find the invoice
    for (const messageData of messageResults) {
      if (!messageData || foundMessage) continue;
      
      // Find all attachments recursively (handles nested multipart structures)
      const allParts = findAllParts(messageData.payload);
      log(`📎 Found ${allParts.length} attachments: ${allParts.map((p: any) => p.filename).join(', ')}`);
      
      const xmlParts = allParts.filter((p: any) => p.filename?.toLowerCase().endsWith(".xml"));
      const pdfPart = allParts.find((p: any) => p.filename?.toLowerCase().endsWith(".pdf"));

      // Download XMLs in parallel - reduced timeout
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
          // Decodificar base64 a bytes y luego a UTF-8 para preservar tildes
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
        
        // Skip MensajeHacienda (not an invoice)
        if (xmlContent.includes('<MensajeHacienda') || xmlContent.includes('mensajeHacienda')) {
          log(`⏭️ Skip MensajeHacienda: ${xmlPart.filename}`);
          continue;
        }

        // Verify it's an actual invoice
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
        
        // Check match
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
          message: `XML no encontrado para: ${invoice_number}`
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
