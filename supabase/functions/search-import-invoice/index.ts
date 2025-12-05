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

// Helper function with timeout
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

serve(async (req) => {
  const startTime = Date.now();
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { organization_id, invoice_number, auto_publish } = await req.json();
    
    if (!organization_id) throw new Error("organization_id required");
    if (!invoice_number) throw new Error("invoice_number required");

    console.log(`🔍 [${Date.now() - startTime}ms] Searching for invoice: ${invoice_number}`);

    // Check if invoice already exists
    const { data: existing } = await supabase
      .from("processed_documents")
      .select("id, doc_number, status, qbo_entity_id")
      .eq("organization_id", organization_id)
      .or(`doc_number.eq.${invoice_number},doc_number.ilike.%${invoice_number}%`)
      .limit(1);

    if (existing && existing.length > 0) {
      const doc = existing[0];
      if (doc.qbo_entity_id) {
        return new Response(
          JSON.stringify({
            success: false,
            message: `La factura ${invoice_number} ya existe y está publicada en QuickBooks (ID: ${doc.qbo_entity_id})`,
            existing: doc
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          success: false,
          message: `La factura ${invoice_number} ya existe en el sistema con estado: ${doc.status}`,
          existing: doc
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get Gmail account
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
      throw new Error("No active Gmail account found");
    }

    const credentials = gmailAccount.credentials as any;
    let accessToken = credentials?.access_token;
    
    if (!accessToken) {
      throw new Error("No access token found");
    }

    // Refresh token if needed
    const expiresAt = typeof credentials.expires_at === 'string' 
      ? new Date(credentials.expires_at).getTime() 
      : credentials.expires_at;
    
    if (expiresAt && (expiresAt - Date.now()) < 2 * 60 * 60 * 1000) {
      console.log("🔄 Refreshing Gmail token...");
      const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
      const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");

      if (credentials.refresh_token && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
        const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            refresh_token: credentials.refresh_token,
            grant_type: "refresh_token",
          }),
        });

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
      }
    }

    // Search Gmail for the specific invoice number
    // Try multiple search patterns to find the invoice
    console.log(`⏱️ [${Date.now() - startTime}ms] Starting Gmail search...`);
    
    const searchPatterns = [
      `has:attachment filename:xml ${invoice_number}`,
      `subject:${invoice_number} has:attachment`,
    ];

    let foundMessage: { id: string; xmlContent: string } | null = null;
    let foundXmlPart: any = null;
    let foundPdfPart: any = null;

    for (const query of searchPatterns) {
      if (foundMessage) break;
      console.log(`📧 [${Date.now() - startTime}ms] Searching: ${query}`);
      
      const searchResponse = await fetchWithTimeout(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=10`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        10000
      );

      if (!searchResponse.ok) {
        console.error(`Gmail search failed: ${searchResponse.status}`);
        continue;
      }

      const searchData = await searchResponse.json();
      const messages = searchData.messages || [];
      
      console.log(`[${Date.now() - startTime}ms] Found ${messages.length} messages with pattern`);

      // Check each message for the invoice number in XML
      for (const msg of messages) {
        const messageResponse = await fetchWithTimeout(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
          8000
        );

        if (!messageResponse.ok) continue;

        const messageData = await messageResponse.json();
        const parts = messageData.payload?.parts || [];

        let pdfPart = null;
        const xmlParts: any[] = [];

        // Collect all attachments
        for (const part of parts) {
          if (part.filename?.toLowerCase().endsWith(".xml")) {
            xmlParts.push(part);
          }
          if (part.filename?.toLowerCase().endsWith(".pdf")) {
            pdfPart = part;
          }
        }

        // Check each XML part to find the actual invoice (not MensajeHacienda)
        for (const xmlPart of xmlParts) {
          if (!xmlPart?.body?.attachmentId) continue;
          
          // Download XML to check invoice number
          const attachmentResponse = await fetchWithTimeout(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/attachments/${xmlPart.body.attachmentId}`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
            8000
          );

          if (!attachmentResponse.ok) continue;
          
          const attachmentData = await attachmentResponse.json();
          const xmlContent = atob(attachmentData.data.replace(/-/g, "+").replace(/_/g, "/"));
          const docNumber = parseNumeroConsecutivo(xmlContent);
          
          console.log(`📄 Found XML: ${xmlPart.filename} with doc_number: ${docNumber}`);

          // CRITICAL: Skip MensajeHacienda (response XMLs) - they don't have invoice data
          const isMensajeHacienda = xmlContent.includes('<MensajeHacienda') || 
                                     xmlContent.includes('mensajeHacienda');
          
          if (isMensajeHacienda) {
            console.log(`⏭️ Skipping MensajeHacienda (response XML): ${xmlPart.filename}`);
            continue;
          }

          // Verify it's an actual invoice document
          const isActualInvoice = xmlContent.includes('<FacturaElectronica') || 
                                  xmlContent.includes('<NotaCreditoElectronica') ||
                                  xmlContent.includes('<NotaDebitoElectronica') ||
                                  xmlContent.includes('<TiqueteElectronico') ||
                                  xmlContent.includes('<Emisor>');
          
          if (!isActualInvoice) {
            console.log(`⏭️ Skipping non-invoice XML: ${xmlPart.filename}`);
            continue;
          }

          // Check if this is the invoice we're looking for
          if (docNumber === invoice_number || 
              docNumber.includes(invoice_number) || 
              invoice_number.includes(docNumber) ||
              xmlContent.includes(invoice_number)) {
            console.log(`✅ MATCH FOUND! Invoice ${invoice_number} in ${xmlPart.filename}`);
            foundMessage = { id: msg.id, xmlContent };
            foundXmlPart = xmlPart;
            foundPdfPart = pdfPart;
            break;
          }
        }

        if (foundMessage) break;
      }

      if (foundMessage) break;
    }

    if (!foundMessage) {
      return new Response(
        JSON.stringify({
          success: false,
          message: `No se encontró la factura ${invoice_number} en Gmail. Verifique el número e intente nuevamente.`
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Download PDF if available
    let pdfUrl = null;
    if (foundPdfPart?.body?.attachmentId) {
      try {
        const pdfAttachmentResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${foundMessage.id}/attachments/${foundPdfPart.body.attachmentId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
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
          
          pdfUrl = pdfPath;
          console.log(`✓ PDF saved: ${pdfPath}`);
        }
      } catch (pdfError) {
        console.error("Error downloading PDF:", pdfError);
      }
    }

    // Process the XML through process-document-xml
    console.log(`⏱️ [${Date.now() - startTime}ms] Processing XML...`);
    
    const processResponse = await fetchWithTimeout(
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
          pdf_attachment_url: pdfUrl,
        }),
      },
      20000
    );

    console.log(`⏱️ [${Date.now() - startTime}ms] XML processed`);

    const processResult = await processResponse.json();
    
    if (!processResult.success) {
      return new Response(
        JSON.stringify({
          success: false,
          message: `Error procesando factura: ${processResult.message || 'Error desconocido'}`,
          details: processResult
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const documentId = processResult.document?.id;
    
    // Validate totals from XML match what was extracted
    const xmlContent = foundMessage.xmlContent;
    const xmlSubtotal = parseFloat(parseXMLValue(xmlContent, 'TotalGravado') || parseXMLValue(xmlContent, 'TotalVenta') || '0');
    const xmlTax = parseFloat(parseXMLValue(xmlContent, 'TotalImpuesto') || '0');
    const xmlTotal = parseFloat(parseXMLValue(xmlContent, 'TotalComprobante') || '0');
    const xmlOtrosCargos = parseFloat(parseXMLValue(xmlContent, 'TotalOtrosCargos') || '0');
    
    const validationResult = {
      xmlSubtotal,
      xmlTax,
      xmlOtrosCargos,
      xmlTotal,
      extractedTotal: processResult.document?.total_amount,
      extractedTax: processResult.document?.total_tax,
      matches: Math.abs(xmlTotal - (processResult.document?.total_amount || 0)) < 0.01
    };

    console.log(`⏱️ [${Date.now() - startTime}ms] Validation complete`);

    // Auto-publish to QuickBooks if requested and vendor has account configured
    let publishResult = null;
    
    if (auto_publish && documentId) {
      console.log(`⏱️ [${Date.now() - startTime}ms] Auto-publishing to QuickBooks...`);
      
      try {
        const publishResponse = await fetchWithTimeout(
          `${supabaseUrl}/functions/v1/publish-to-quickbooks`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              organization_id,
              document_ids: [documentId],
            }),
          },
          30000
        );

        publishResult = await publishResponse.json();
        console.log(`⏱️ [${Date.now() - startTime}ms] Publish complete:`, publishResult);
      } catch (pubError: any) {
        console.error("Error publishing:", pubError);
        publishResult = { error: pubError?.message || "Error desconocido" };
      }
    }

    console.log(`⏱️ [${Date.now() - startTime}ms] Total time - returning response`);
    
    return new Response(
      JSON.stringify({
        success: true,
        message: `Factura ${invoice_number} importada correctamente`,
        document: processResult.document,
        validation: validationResult,
        publishResult,
        pdfSaved: !!pdfUrl
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Error in search-import-invoice:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || "Error desconocido"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
