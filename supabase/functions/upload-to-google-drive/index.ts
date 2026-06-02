import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

async function refreshGoogleDriveToken(supabase: any, organizationId: string) {
  const { data: account } = await supabase
    .from("integration_accounts")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("service_type", "google_drive")
    .eq("is_active", true)
    .single();

  if (!account) {
    throw new Error("Google Drive account not found");
  }

  const credentials = account.credentials as any;
  const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
  const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID!,
      client_secret: GOOGLE_CLIENT_SECRET!,
      refresh_token: credentials.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  const tokens = await tokenResponse.json();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await supabase
    .from("integration_accounts")
    .update({
      credentials: {
        ...credentials,
        access_token: tokens.access_token,
        expires_at: expiresAt,
      },
    })
    .eq("id", account.id);

  return tokens.access_token;
}

async function getAccessToken(supabase: any, organizationId: string) {
  const { data: account } = await supabase
    .from("integration_accounts")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("service_type", "google_drive")
    .eq("is_active", true)
    .single();

  if (!account) {
    throw new Error("Google Drive not connected");
  }

  const credentials = account.credentials as any;
  const expiresAt = new Date(credentials.expires_at);
  
  if (expiresAt <= new Date()) {
    return await refreshGoogleDriveToken(supabase, organizationId);
  }

  return credentials.access_token;
}

async function findOrCreateFolder(accessToken: string, parentId: string, folderName: string) {
  // Search for existing folder
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchResponse = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const searchData = await searchResponse.json();
  
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  // Create folder if not found
  const createResponse = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });

  const folderData = await createResponse.json();
  return folderData.id;
}

async function uploadFileToDrive(
  accessToken: string,
  folderId: string,
  fileName: string,
  fileContent: Uint8Array,
  mimeType: string
) {
  const boundary = "-------314159265358979323846";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadata = {
    name: fileName,
    parents: [folderId],
  };

  const multipartRequestBody =
    delimiter +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${mimeType}\r\n` +
    "Content-Transfer-Encoding: base64\r\n\r\n" +
    btoa(String.fromCharCode(...fileContent)) +
    closeDelimiter;

  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipartRequestBody,
    }
  );

  return await response.json();
}

// Sanitize a filename component: remove characters illegal in filesystems and Drive,
// collapse whitespace, preserve accents and case.
function sanitizeNamePart(input: string): string {
  return (input || "")
    .replace(/[\/\\?%*:|"<>\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

// Format an amount for the filename: e.g. ₡125,000 or $1,250.50
function formatAmountForName(amount: number | string | null | undefined, currency: string | null | undefined): string {
  const n = typeof amount === "number" ? amount : parseFloat(String(amount || "0"));
  if (!isFinite(n)) return "0";
  const cur = (currency || "CRC").toUpperCase();
  const symbol = cur === "USD" ? "$" : cur === "EUR" ? "€" : "₡";
  const decimals = cur === "CRC" ? 0 : 2;
  const formatted = n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${symbol}${formatted}`;
}

// Build the canonical filename basename: "Proveedor - FE-123 - ₡125,000"
function buildInvoiceBasename(doc: any): string {
  const vendor = sanitizeNamePart(doc.supplier_name || "Proveedor");
  const number = sanitizeNamePart(doc.doc_number || "SN");
  const amount = formatAmountForName(doc.total_amount, doc.currency);
  return `${vendor} - ${number} - ${amount}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json();
    const {
      document_id,
      organization_id,
      mode = "invoice", // "invoice" | "payment_proof"
      payment_proof_storage_path, // required when mode === "payment_proof"
      payment_proof_mime = "application/pdf",
      payment_proof_extension = "pdf",
    } = body;

    if (!document_id || !organization_id) {
      throw new Error("Missing document_id or organization_id");
    }

    // Get organization and root folder
    const { data: org } = await supabase
      .from("organizations")
      .select("google_drive_folder_id, google_drive_enabled")
      .eq("id", organization_id)
      .single();

    if (!org || !org.google_drive_enabled || !org.google_drive_folder_id) {
      // Silent skip: don't block if Drive is not configured
      return new Response(
        JSON.stringify({ success: false, skipped: true, reason: "drive_not_configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Get document data
    const { data: document } = await supabase
      .from("processed_documents")
      .select("*")
      .eq("id", document_id)
      .single();

    if (!document) {
      throw new Error("Document not found");
    }

    const accessToken = await getAccessToken(supabase, organization_id);

    // Build year/month folder path
    const issueDate = new Date(document.issue_date);
    const year = issueDate.getFullYear().toString();
    const monthName = MONTH_NAMES[issueDate.getMonth()];
    const yearFolderId = await findOrCreateFolder(accessToken, org.google_drive_folder_id, year);
    const monthFolderId = await findOrCreateFolder(accessToken, yearFolderId, monthName);

    const baseFileName = buildInvoiceBasename(document);
    const uploadedFiles: any[] = [];

    if (mode === "payment_proof") {
      if (!payment_proof_storage_path) {
        throw new Error("Missing payment_proof_storage_path for payment_proof mode");
      }
      // Upload payment proof to /Pagos subfolder
      const paymentsFolderId = await findOrCreateFolder(accessToken, monthFolderId, "Pagos");

      const { data: proofBlob, error: proofErr } = await supabase.storage
        .from("payment-proofs")
        .download(payment_proof_storage_path);

      if (proofErr || !proofBlob) {
        throw new Error(`Failed to download payment proof: ${proofErr?.message || "not found"}`);
      }

      const proofContent = new Uint8Array(await proofBlob.arrayBuffer());
      const proofResult = await uploadFileToDrive(
        accessToken,
        paymentsFolderId,
        `${baseFileName} - COMPROBANTE.${payment_proof_extension}`,
        proofContent,
        payment_proof_mime
      );
      uploadedFiles.push({ type: "payment_proof", id: proofResult.id, name: proofResult.name });

      if (proofResult.id) {
        await supabase
          .from("processed_documents")
          .update({ payment_proof_drive_id: proofResult.id })
          .eq("id", document_id);
      }

      return new Response(
        JSON.stringify({ success: true, uploadedFiles, folderPath: `${year}/${monthName}/Pagos` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Default mode: upload PDF + XML of the invoice itself
    if (document.pdf_attachment_url) {
      const pdfPath = document.pdf_attachment_url.replace("company-documents/", "");
      const { data: pdfBlob } = await supabase.storage
        .from("company-documents")
        .download(pdfPath);

      if (pdfBlob) {
        const pdfContent = new Uint8Array(await pdfBlob.arrayBuffer());
        const pdfResult = await uploadFileToDrive(
          accessToken,
          monthFolderId,
          `${baseFileName}.pdf`,
          pdfContent,
          "application/pdf"
        );
        uploadedFiles.push({ type: "pdf", id: pdfResult.id, name: pdfResult.name });
      }
    }

    if (document.xml_attachment_url) {
      const xmlPath = document.xml_attachment_url.replace("company-documents/", "");
      const { data: xmlBlob } = await supabase.storage
        .from("company-documents")
        .download(xmlPath);

      if (xmlBlob) {
        const xmlContent = new Uint8Array(await xmlBlob.arrayBuffer());
        const xmlResult = await uploadFileToDrive(
          accessToken,
          monthFolderId,
          `${baseFileName}.xml`,
          xmlContent,
          "application/xml"
        );
        uploadedFiles.push({ type: "xml", id: xmlResult.id, name: xmlResult.name });
      }
    }

    console.log(`Uploaded ${uploadedFiles.length} files to Google Drive for document ${document_id}`);

    const updateData: any = {
      google_drive_uploaded_at: new Date().toISOString(),
    };
    const pdfFile = uploadedFiles.find((f) => f.type === "pdf");
    const xmlFile = uploadedFiles.find((f) => f.type === "xml");
    if (pdfFile) updateData.google_drive_pdf_id = pdfFile.id;
    if (xmlFile) updateData.google_drive_xml_id = xmlFile.id;

    const { error: updateError } = await supabase
      .from("processed_documents")
      .update(updateData)
      .eq("id", document_id);

    if (updateError) {
      console.error("Failed to update document with Drive IDs:", updateError);
    }

    return new Response(
      JSON.stringify({ success: true, uploadedFiles, folderPath: `${year}/${monthName}` }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    console.error("Error uploading to Google Drive:", error);
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

