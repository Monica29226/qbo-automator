import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper to get Gmail credentials
async function getGmailCredentials(supabase: any, organizationId: string) {
  const { data: accounts, error } = await supabase
    .from("integration_accounts")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("service_type", "gmail")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !accounts || accounts.length === 0) {
    throw new Error("No active Gmail account found");
  }

  const account = accounts[0];
  const credentials = account.credentials;

  // Check if token needs refresh
  const expiresAt = new Date(credentials.expires_at).getTime();
  const now = Date.now();

  if (now >= expiresAt - 5 * 60 * 1000) {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
        client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
        refresh_token: credentials.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error("Failed to refresh Gmail token");
    }

    const tokenData = await tokenResponse.json();
    credentials.access_token = tokenData.access_token;
    credentials.expires_at = new Date(now + tokenData.expires_in * 1000).toISOString();

    await supabase
      .from("integration_accounts")
      .update({ credentials })
      .eq("id", account.id);
  }

  return credentials.access_token;
}

// Search Gmail and download XML/PDF
async function searchGmailForDocument(
  accessToken: string,
  docNumber: string,
  supabase: any,
  organizationId: string
): Promise<{ xmlContent: string; pdfUrl: string | null; xmlUrl: string | null } | null> {
  try {
    console.log(`🔍 Searching Gmail for: ${docNumber}`);
    
    const searchQuery = encodeURIComponent(`has:attachment filename:xml "${docNumber}"`);
    const searchResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${searchQuery}&maxResults=5`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!searchResponse.ok) return null;

    const searchData = await searchResponse.json();
    if (!searchData.messages || searchData.messages.length === 0) {
      console.log(`❌ Not found in Gmail: ${docNumber}`);
      return null;
    }

    const messageId = searchData.messages[0].id;
    const messageResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!messageResponse.ok) return null;

    const messageData = await messageResponse.json();
    let xmlContent = "";
    let pdfUrl: string | null = null;
    let xmlUrl: string | null = null;

    for (const part of messageData.payload.parts || []) {
      const filename = part.filename || "";
      const mimeType = part.mimeType || "";
      
      if (!part.body?.attachmentId) continue;

      const attachmentResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${part.body.attachmentId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!attachmentResponse.ok) continue;

      const attachmentData = await attachmentResponse.json();
      const fileContent = Uint8Array.from(atob(attachmentData.data.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

      // Handle XML
      if (filename.toLowerCase().endsWith(".xml") || mimeType.includes("xml")) {
        xmlContent = new TextDecoder().decode(fileContent);
        
        const xmlPath = `${organizationId}/${docNumber}.xml`;
        const { error: uploadError } = await supabase.storage
          .from("company-documents")
          .upload(xmlPath, fileContent, {
            contentType: "application/xml",
            upsert: true,
          });

        if (!uploadError) {
          const { data: urlData } = supabase.storage
            .from("company-documents")
            .getPublicUrl(xmlPath);
          xmlUrl = urlData.publicUrl;
        }
      }

      // Handle PDF
      if (filename.toLowerCase().endsWith(".pdf") || mimeType === "application/pdf") {
        const pdfPath = `${organizationId}/${docNumber}.pdf`;
        const { error: uploadError } = await supabase.storage
          .from("company-documents")
          .upload(pdfPath, fileContent, {
            contentType: "application/pdf",
            upsert: true,
          });

        if (!uploadError) {
          const { data: urlData } = supabase.storage
            .from("company-documents")
            .getPublicUrl(pdfPath);
          pdfUrl = urlData.publicUrl;
        }
      }
    }

    if (!xmlContent) return null;

    return { xmlContent, pdfUrl, xmlUrl };
  } catch (error) {
    console.error(`Error searching Gmail:`, error);
    return null;
  }
}

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

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const organizationId = formData.get("organization_id") as string;

    if (!file || !organizationId) {
      throw new Error("file and organization_id are required");
    }

    console.log(`Processing Excel file for organization: ${organizationId}`);

    // Parse Excel file
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(firstSheet) as any[];

    console.log(`Found ${data.length} rows in Excel`);

    // Get Gmail credentials
    const gmailAccessToken = await getGmailCredentials(supabase, organizationId);

    const results = {
      total: data.length,
      already_in_db: 0,
      already_in_qbo: 0,
      found_and_processed: 0,
      not_found: 0,
      failed: 0,
      details: [] as any[],
    };

    for (const row of data) {
      const docNumber = row["Consecutivo Documento"];
      const docType = row["Tipo Doc Recibido"];
      const emisor = row["Nombre Emisor"];
      const total = row["Total Comprobante"];

      if (!docNumber) continue;

      console.log(`\n=== Checking: ${docNumber} (${emisor}) ===`);

      // Check if already in database
      const { data: existingDoc } = await supabase
        .from("processed_documents")
        .select("*")
        .eq("doc_number", docNumber)
        .eq("organization_id", organizationId)
        .single();

      if (existingDoc) {
        if (existingDoc.status === "published") {
          console.log(`✓ Already published in QuickBooks`);
          results.already_in_qbo++;
          results.details.push({
            doc_number: docNumber,
            emisor,
            status: "already_published",
          });
        } else {
          console.log(`✓ Already in database (status: ${existingDoc.status})`);
          results.already_in_db++;
          results.details.push({
            doc_number: docNumber,
            emisor,
            status: existingDoc.status,
          });
        }
        continue;
      }

      // Not in DB, search in Gmail
      console.log(`🔍 Not in database, searching Gmail...`);
      const gmailResult = await searchGmailForDocument(
        gmailAccessToken,
        docNumber,
        supabase,
        organizationId
      );

      if (!gmailResult) {
        console.log(`❌ Not found in Gmail`);
        results.not_found++;
        results.details.push({
          doc_number: docNumber,
          emisor,
          status: "not_found_in_gmail",
        });
        continue;
      }

      // Process document
      console.log(`📄 Found in Gmail, processing...`);
      try {
        const { data: processData, error: processError } = await supabase.functions.invoke(
          "process-document-xml",
          {
            body: {
              organization_id: organizationId,
              xml_content: gmailResult.xmlContent,
              pdf_attachment_url: gmailResult.pdfUrl,
              xml_attachment_url: gmailResult.xmlUrl,
            },
          }
        );

        if (processError) throw processError;

        if (processData?.success && processData?.documentId) {
          // Publish to QuickBooks
          const { data: publishData, error: publishError } = await supabase.functions.invoke(
            "publish-to-quickbooks",
            {
              body: {
                organization_id: organizationId,
                document_ids: [processData.documentId],
              },
              headers: {
                Authorization: authHeader,
              },
            }
          );

          if (publishError) throw publishError;

          if (publishData?.published > 0) {
            console.log(`✓ Successfully processed and published`);
            results.found_and_processed++;
            results.details.push({
              doc_number: docNumber,
              emisor,
              status: "processed_and_published",
            });
          } else {
            throw new Error(publishData?.errors?.[0]?.error || "Publication failed");
          }
        } else {
          throw new Error(processData?.error || "Processing failed");
        }
      } catch (error: any) {
        console.error(`✗ Failed to process: ${error.message}`);
        results.failed++;
        results.details.push({
          doc_number: docNumber,
          emisor,
          status: "failed",
          error: error.message,
        });
      }

      // Add delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`\n=== Summary ===`);
    console.log(`Total: ${results.total}`);
    console.log(`Already in QuickBooks: ${results.already_in_qbo}`);
    console.log(`Already in DB: ${results.already_in_db}`);
    console.log(`Found and processed: ${results.found_and_processed}`);
    console.log(`Not found in Gmail: ${results.not_found}`);
    console.log(`Failed: ${results.failed}`);

    return new Response(
      JSON.stringify(results),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in sync-from-excel:", error);
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
