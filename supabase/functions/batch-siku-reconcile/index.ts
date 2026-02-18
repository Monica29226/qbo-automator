import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_EXECUTION_MS = 50000; // 50 seconds max

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getGmailAccessToken(supabase: any, organizationId: string) {
  const { data: account } = await supabase
    .from("integration_accounts")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("service_type", "gmail")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!account) throw new Error("No Gmail account found");

  const credentials = account.credentials as any;
  let accessToken = credentials.access_token;

  const expiresAt = typeof credentials.expires_at === 'string'
    ? new Date(credentials.expires_at).getTime()
    : credentials.expires_at;

  if (expiresAt && (expiresAt - Date.now()) < 5 * 60 * 1000) {
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");

    if (credentials.refresh_token && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
      const resp = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: credentials.refresh_token,
          grant_type: "refresh_token",
        }),
      }, 5000);

      if (resp.ok) {
        const data = await resp.json();
        accessToken = data.access_token;
        await supabase
          .from("integration_accounts")
          .update({
            credentials: { ...credentials, access_token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 },
            updated_at: new Date().toISOString(),
          })
          .eq("id", account.id);
      }
    }
  }

  return accessToken;
}

function findAllParts(part: any, result: any[] = []): any[] {
  if (!part) return result;
  if (part.filename && part.filename.length > 0) result.push(part);
  if (part.parts && Array.isArray(part.parts)) {
    for (const subPart of part.parts) findAllParts(subPart, result);
  }
  return result;
}

function parseXMLValue(xml: string, tag: string): string {
  let regex = new RegExp(`<[\\w]*:?${tag}[^>]*>([^<]*)<\\/[\\w]*:?${tag}>`, 'i');
  let match = xml.match(regex);
  if (match) return match[1].trim();
  regex = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i');
  match = xml.match(regex);
  return match ? match[1].trim() : '';
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const log = (msg: string) => console.log(`[${Date.now() - startTime}ms] ${msg}`);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { organization_id, missing_invoices, auto_publish = true } = await req.json();

    if (!organization_id || !missing_invoices || !Array.isArray(missing_invoices)) {
      throw new Error("organization_id and missing_invoices[] required");
    }

    log(`🚀 Batch Siku reconcile: ${missing_invoices.length} invoices for org ${organization_id}`);

    // Get Gmail token once
    const accessToken = await getGmailAccessToken(supabase, organization_id);
    log("✅ Gmail token ready");

    const results: any[] = [];
    let processed = 0;
    let found = 0;
    let notFound = 0;
    let alreadyInDb = 0;
    let failed = 0;

    for (const inv of missing_invoices) {
      // Check timeout
      if (Date.now() - startTime > MAX_EXECUTION_MS) {
        log(`⏰ Timeout reached after ${processed} invoices`);
        break;
      }

      const docNumber = inv.doc_number;
      const expectedVendor = inv.vendor_name;
      const clave = inv.clave;

      log(`\n--- Processing: ${docNumber} (${expectedVendor}) ---`);

      // Check if already in DB by clave
      if (clave) {
        const { data: existing } = await supabase
          .from("processed_documents")
          .select("id, status, qbo_entity_id")
          .eq("organization_id", organization_id)
          .eq("doc_key", clave)
          .maybeSingle();

        if (existing) {
          log(`✓ Already in DB: ${docNumber} (${existing.status})`);
          alreadyInDb++;
          processed++;
          results.push({ doc_number: docNumber, vendor: expectedVendor, status: "already_in_db", db_status: existing.status });
          continue;
        }
      }

      // Search Gmail
      try {
        const searchQuery = encodeURIComponent(`has:attachment filename:xml ${docNumber}`);
        const searchResp = await fetchWithTimeout(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${searchQuery}&maxResults=3`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
          8000
        );

        if (!searchResp.ok) {
          log(`❌ Gmail search failed for ${docNumber}`);
          notFound++;
          processed++;
          results.push({ doc_number: docNumber, vendor: expectedVendor, status: "gmail_error" });
          continue;
        }

        const searchData = await searchResp.json();
        if (!searchData.messages || searchData.messages.length === 0) {
          // Try broader search
          const broadQuery = encodeURIComponent(`has:attachment ${docNumber}`);
          const broadResp = await fetchWithTimeout(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${broadQuery}&maxResults=3`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
            8000
          );

          if (!broadResp.ok || !(await broadResp.json()).messages?.length) {
            log(`❌ Not found in Gmail: ${docNumber}`);
            notFound++;
            processed++;
            results.push({ doc_number: docNumber, vendor: expectedVendor, status: "not_found_in_gmail" });
            continue;
          }

          searchData.messages = (await broadResp.json()).messages;
        }

        // Fetch first message
        const msgResp = await fetchWithTimeout(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${searchData.messages[0].id}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
          6000
        );

        if (!msgResp.ok) {
          log(`❌ Message fetch failed for ${docNumber}`);
          failed++;
          processed++;
          results.push({ doc_number: docNumber, vendor: expectedVendor, status: "message_fetch_error" });
          continue;
        }

        const msgData = await msgResp.json();
        const allParts = findAllParts(msgData.payload);
        const xmlParts = allParts.filter((p: any) => p.filename?.toLowerCase().endsWith(".xml"));
        const pdfPart = allParts.find((p: any) => p.filename?.toLowerCase().endsWith(".pdf"));

        let xmlContent = "";
        let xmlFound = false;

        for (const xmlPart of xmlParts.slice(0, 3)) {
          if (!xmlPart?.body?.attachmentId) continue;

          try {
            const attResp = await fetchWithTimeout(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${searchData.messages[0].id}/attachments/${xmlPart.body.attachmentId}`,
              { headers: { Authorization: `Bearer ${accessToken}` } },
              3000
            );

            if (!attResp.ok) continue;

            const attData = await attResp.json();
            const base64Fixed = attData.data.replace(/-/g, "+").replace(/_/g, "/");
            const binaryString = atob(base64Fixed);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const content = new TextDecoder('utf-8').decode(bytes);

            // Skip MensajeHacienda
            if (content.includes('<MensajeHacienda') || content.includes('mensajeHacienda')) continue;

            // Must be an invoice
            if (content.includes('<FacturaElectronica') || content.includes('<NotaCreditoElectronica') || content.includes('<NotaDebitoElectronica')) {
              // Skip TiqueteElectronico
              if (content.includes('<TiqueteElectronico')) continue;

              xmlContent = content;
              xmlFound = true;
              break;
            }
          } catch (e) {
            log(`⚠️ Attachment error: ${e}`);
          }
        }

        if (!xmlFound) {
          log(`❌ No valid XML found for ${docNumber}`);
          notFound++;
          processed++;
          results.push({ doc_number: docNumber, vendor: expectedVendor, status: "no_xml_in_email" });
          continue;
        }

        // Download PDF if available
        let pdfUrl: string | null = null;
        if (pdfPart?.body?.attachmentId) {
          try {
            const pdfResp = await fetchWithTimeout(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${searchData.messages[0].id}/attachments/${pdfPart.body.attachmentId}`,
              { headers: { Authorization: `Bearer ${accessToken}` } },
              3000
            );
            if (pdfResp.ok) {
              const pdfData = await pdfResp.json();
              const pdfBase64 = pdfData.data.replace(/-/g, "+").replace(/_/g, "/");
              const pdfBinary = atob(pdfBase64);
              const pdfBytes = new Uint8Array(pdfBinary.length);
              for (let i = 0; i < pdfBinary.length; i++) {
                pdfBytes[i] = pdfBinary.charCodeAt(i);
              }
              const pdfPath = `${organization_id}/${docNumber}.pdf`;
              await supabase.storage.from("company-documents").upload(pdfPath, pdfBytes, {
                contentType: "application/pdf",
                upsert: true,
              });
              pdfUrl = pdfPath;
            }
          } catch (e) {
            log(`⚠️ PDF download error: ${e}`);
          }
        }

        // Process the XML via process-document-xml
        log(`⚙️ Processing XML for ${docNumber}...`);
        const processResp = await fetchWithTimeout(
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
            }),
          },
          15000
        );

        const processResult = await processResp.json();

        if (!processResult.success) {
          log(`❌ Processing failed: ${processResult.message}`);
          failed++;
          processed++;
          results.push({ doc_number: docNumber, vendor: expectedVendor, status: "process_error", error: processResult.message });
          continue;
        }

        const documentId = processResult.documentId || processResult.doc_id;

        // Update PDF URL
        if (pdfUrl && documentId) {
          await supabase.from("processed_documents").update({ pdf_attachment_url: pdfUrl }).eq("id", documentId);
        }

        // Auto-publish if requested
        if (auto_publish && documentId) {
          fetch(`${supabaseUrl}/functions/v1/publish-to-quickbooks`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ organization_id, document_ids: [documentId] }),
          }).catch(e => log(`⚠️ QB publish error: ${e}`));
        }

        log(`✅ Processed: ${docNumber} (${expectedVendor})`);
        found++;
        processed++;
        results.push({
          doc_number: docNumber,
          vendor: expectedVendor,
          status: "processed",
          document_id: documentId,
          pdf_saved: !!pdfUrl,
          qb_queued: auto_publish,
        });

      } catch (e: any) {
        log(`❌ Error for ${docNumber}: ${e.message}`);
        failed++;
        processed++;
        results.push({ doc_number: docNumber, vendor: expectedVendor, status: "error", error: e.message });
      }

      // Small delay to avoid Gmail rate limits
      await new Promise(r => setTimeout(r, 300));
    }

    const summary = {
      total_requested: missing_invoices.length,
      processed,
      found_and_processed: found,
      not_found_in_gmail: notFound,
      already_in_db: alreadyInDb,
      failed,
      remaining: missing_invoices.length - processed,
      execution_time_ms: Date.now() - startTime,
      results,
    };

    log(`\n=== BATCH SUMMARY ===`);
    log(`Processed: ${processed}/${missing_invoices.length}`);
    log(`Found: ${found}, Not found: ${notFound}, Already in DB: ${alreadyInDb}, Failed: ${failed}`);
    log(`Time: ${Date.now() - startTime}ms`);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("Batch reconcile error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
