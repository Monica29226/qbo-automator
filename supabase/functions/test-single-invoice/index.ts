import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (authError || !user) {
      throw new Error("Authentication failed");
    }

    const { organization_id, doc_number } = await req.json();

    if (!organization_id || !doc_number) {
      throw new Error("organization_id and doc_number are required");
    }

    console.log(`🔍 Testing single invoice: ${doc_number}`);
    const result = {
      steps: [] as any[],
      success: false,
      error: null as string | null,
    };

    // PASO 1: Obtener credenciales de Gmail
    result.steps.push({ step: 1, name: "Getting Gmail credentials", status: "running" });
    
    const { data: gmailAccount } = await supabase
      .from("integration_accounts")
      .select("credentials")
      .eq("organization_id", organization_id)
      .eq("service_type", "gmail")
      .eq("is_active", true)
      .maybeSingle();

    if (!gmailAccount) {
      throw new Error("Gmail not connected");
    }

    const gmailCreds = gmailAccount.credentials as any;
    let accessToken = gmailCreds.access_token;
    
    // Refresh token si está expirado
    if (new Date(gmailCreds.expires_at) < new Date()) {
      console.log("Refreshing Gmail token...");
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
          client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
          refresh_token: gmailCreds.refresh_token,
          grant_type: "refresh_token",
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error("Failed to refresh Gmail token");
      }

      const tokens = await tokenResponse.json();
      accessToken = tokens.access_token;

      await supabase
        .from("integration_accounts")
        .update({
          credentials: {
            ...gmailCreds,
            access_token: tokens.access_token,
            expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          },
        })
        .eq("organization_id", organization_id)
        .eq("service_type", "gmail");
    }

    result.steps[0].status = "completed";

    // PASO 2: Buscar factura en Gmail
    result.steps.push({ step: 2, name: `Searching Gmail for ${doc_number}`, status: "running" });
    
    // Extraer solo los últimos 10-12 dígitos del número para búsqueda más flexible
    const searchNumber = doc_number.slice(-12);
    console.log(`📧 Searching Gmail with: ${searchNumber} (from ${doc_number})`);
    
    const searchQuery = `has:attachment filename:xml ${searchNumber}`;
    const searchUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(searchQuery)}&maxResults=10`;
    
    const searchResponse = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!searchResponse.ok) {
      throw new Error(`Gmail search failed: ${searchResponse.statusText}`);
    }

    const searchData = await searchResponse.json();
    
    if (!searchData.messages || searchData.messages.length === 0) {
      // Intentar búsqueda alternativa con número completo
      console.log(`⚠️ No results with ${searchNumber}, trying full number...`);
      const altSearchQuery = `has:attachment filename:xml ${doc_number}`;
      const altSearchUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(altSearchQuery)}&maxResults=10`;
      
      const altSearchResponse = await fetch(altSearchUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      
      const altSearchData = await altSearchResponse.json();
      
      if (!altSearchData.messages || altSearchData.messages.length === 0) {
        throw new Error(`Invoice ${doc_number} not found in Gmail. Tried searching: "${searchNumber}" and "${doc_number}"`);
      }
      
      searchData.messages = altSearchData.messages;
    }

    console.log(`✅ Found ${searchData.messages.length} message(s) in Gmail`);
    result.steps[1].status = "completed";
    result.steps[1].messages_found = searchData.messages.length;
    result.steps[1].found = searchData.messages.length;

    // PASO 3: Descargar attachments
    result.steps.push({ step: 3, name: "Downloading XML and PDF", status: "running" });
    
    const messageId = searchData.messages[0].id;
    const messageUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`;
    
    const messageResponse = await fetch(messageUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const message = await messageResponse.json();
    
    let xmlContent = "";
    let pdfUrl = "";
    let xmlUrl = "";

    // Extraer attachments
    const parts = message.payload.parts || [message.payload];
    for (const part of parts) {
      const filename = part.filename?.toLowerCase() || "";
      
      if (filename.endsWith(".xml") && part.body?.attachmentId) {
        const attachUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${part.body.attachmentId}`;
        const attachResponse = await fetch(attachUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const attachData = await attachResponse.json();
        const xmlBuffer = Uint8Array.from(atob(attachData.data.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
        const tempXml = new TextDecoder().decode(xmlBuffer);
        
        // Solo tomar el XML de la factura, NO el MensajeHacienda
        if (tempXml.includes('FacturaElectronica') || 
            tempXml.includes('NotaCreditoElectronica') || 
            tempXml.includes('TiqueteElectronico') ||
            tempXml.includes('NotaDebitoElectronica')) {
          xmlContent = tempXml;
          
          // Upload XML to Supabase Storage
          const xmlFileName = `${organization_id}/${Date.now()}_${filename}`;
          const { data: xmlUploadData } = await supabase.storage
            .from("company-documents")
            .upload(xmlFileName, xmlBuffer, { contentType: "application/xml" });
          
          if (xmlUploadData) {
            xmlUrl = supabase.storage.from("company-documents").getPublicUrl(xmlUploadData.path).data.publicUrl;
          }
          console.log("✅ Found invoice XML:", filename);
        } else {
          console.log("⏩ Skipping MensajeHacienda XML");
        }
      }
      
      if (filename.endsWith(".pdf") && part.body?.attachmentId) {
        const attachUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${part.body.attachmentId}`;
        const attachResponse = await fetch(attachUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const attachData = await attachResponse.json();
        const pdfBuffer = Uint8Array.from(atob(attachData.data.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
        
        // Upload PDF to Supabase Storage
        const pdfFileName = `${organization_id}/${Date.now()}_${filename}`;
        const { data: pdfUploadData } = await supabase.storage
          .from("company-documents")
          .upload(pdfFileName, pdfBuffer, { contentType: "application/pdf" });
        
        if (pdfUploadData) {
          pdfUrl = supabase.storage.from("company-documents").getPublicUrl(pdfUploadData.path).data.publicUrl;
        }
      }
    }

    if (!xmlContent) {
      throw new Error("XML not found in email");
    }

    result.steps[2].status = "completed";
    result.steps[2].xml_found = !!xmlContent;
    result.steps[2].pdf_found = !!pdfUrl;

    // PASO 4: Procesar XML
    result.steps.push({ step: 4, name: "Processing XML document", status: "running" });
    
    // Primero verificar si el documento ya existe
    const { data: existingDoc } = await supabase
      .from('processed_documents')
      .select('id, status, xml_data')
      .eq('organization_id', organization_id)
      .eq('doc_number', doc_number)
      .maybeSingle();

    let processData;
    
    if (existingDoc) {
      console.log(`📄 Document already exists with status: ${existingDoc.status}`);
      
      // Actualizar URLs de attachments si no existen
      if (xmlUrl || pdfUrl) {
        console.log(`📎 Updating attachment URLs for existing document`);
        await supabase
          .from('processed_documents')
          .update({
            xml_attachment_url: xmlUrl || undefined,
            pdf_attachment_url: pdfUrl || undefined,
          })
          .eq('id', existingDoc.id);
      }
      
      processData = {
        documentId: existingDoc.id,
        account_code: existingDoc.xml_data?.cuentaContable || 'N/A',
        status: existingDoc.status
      };
      result.steps[3].status = "completed";
      result.steps[3].document_id = processData.documentId;
      result.steps[3].account_code = processData.account_code;
      result.steps[3].doc_status = processData.status;
      result.steps[3].note = "Document already exists, updated attachment URLs";
    } else {
      const { data: newProcessData, error: processError } = await supabase.functions.invoke(
        "process-document-xml",
        {
          body: {
            organization_id,
            xml_content: xmlContent,
            xml_attachment_url: xmlUrl,
            pdf_attachment_url: pdfUrl,
          },
          headers: { Authorization: authHeader },
        }
      );

      if (processError) {
        throw new Error(`Processing failed: ${processError.message}`);
      }

      processData = newProcessData;
      result.steps[3].status = "completed";
      result.steps[3].document_id = processData.documentId;
      result.steps[3].account_code = processData.account_code;
      result.steps[3].doc_status = processData.status;
    }

    // PASO 5: Publicar a QuickBooks (si está en estado 'processed' y NO tiene qbo_entity_id)
    // Verificar si el documento ya está publicado
    const { data: docCheck } = await supabase
      .from('processed_documents')
      .select('qbo_entity_id, status')
      .eq('id', processData.documentId)
      .single();
    
    console.log(`📤 Checking if document should be published. Status: ${docCheck?.status}, QBO ID: ${docCheck?.qbo_entity_id}, DocumentId: ${processData.documentId}`);
    
    if (docCheck?.status === "processed" && !docCheck?.qbo_entity_id) {
      result.steps.push({ step: 5, name: "Publishing to QuickBooks", status: "running" });
      
      console.log(`📤 Attempting to publish document ${processData.documentId} to QuickBooks...`);
      
      const { data: publishData, error: publishError } = await supabase.functions.invoke(
        "publish-to-quickbooks",
        {
          body: {
            organization_id,
            document_ids: [processData.documentId],
          },
          headers: { Authorization: authHeader },
        }
      );

      if (publishError) {
        console.error(`❌ Publishing error: ${publishError.message}`);
        throw new Error(`Publishing failed: ${publishError.message}`);
      }

      console.log(`✅ Publishing result:`, publishData);
      
      result.steps[4].status = "completed";
      result.steps[4].published = publishData.published || 0;
      result.steps[4].failed = publishData.failed || 0;
      result.steps[4].errors = publishData.errors || [];
    } else {
      console.log(`⚠️  Skipping QuickBooks - document status: ${docCheck?.status}, QBO ID: ${docCheck?.qbo_entity_id}`);
      
      // Determinar razón específica
      let skipReason = "Document needs manual review";
      if (docCheck?.qbo_entity_id) {
        skipReason = `Document already published to QuickBooks (QBO ID: ${docCheck.qbo_entity_id})`;
      } else if (processData.account_code === "Gastos por clasificar") {
        skipReason = "Vendor not found in vendor_categories - assigned to 'Gastos por clasificar'";
      } else if (docCheck?.status === "pending") {
        skipReason = `Document has pending status (Account: ${processData.account_code}) - may need republishing`;
      } else if (docCheck?.status === "review") {
        skipReason = `Document marked for review (Account: ${processData.account_code})`;
      }
      
      result.steps.push({ 
        step: 5, 
        name: docCheck?.qbo_entity_id ? "Already in QuickBooks" : "Skipped QuickBooks (needs review)", 
        status: "skipped",
        reason: skipReason
      });
    }

    result.success = true;

    return new Response(
      JSON.stringify({ ...result, doc_number }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("❌ Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        steps: [],
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
