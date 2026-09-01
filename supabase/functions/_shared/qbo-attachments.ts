// =============================================================
// QBO ATTACHMENTS (shared)
// Sube archivos (PDF / XML) al Bill o VendorCredit usando la API
// Attachable de QuickBooks (multipart/form-data).
// =============================================================

export async function attachFileToQuickBooks(
  fileUrl: string,
  contentType: string,
  ext: string,
  entityId: string,
  entityType: string,
  docNumber: string,
  realmId: string,
  accessToken: string,
  supabase: any,
): Promise<boolean> {
  const label = ext.toUpperCase();
  try {
    console.log(`📎 ${docNumber}: adjuntando ${label} a ${entityType} ${entityId}...`);

    let fileData: ArrayBuffer;
    const filename = `${docNumber}.${ext}`;

    if (fileUrl.startsWith("http")) {
      const fileResponse = await fetch(fileUrl);
      if (!fileResponse.ok) {
        console.error(`❌ ${docNumber}: no se pudo descargar ${label}: ${fileResponse.status}`);
        return false;
      }
      fileData = await fileResponse.arrayBuffer();
    } else {
      const { data, error } = await supabase.storage
        .from("company-documents")
        .download(fileUrl);
      if (error || !data) {
        console.error(`❌ ${docNumber}: no se pudo descargar ${label} de storage: ${error?.message}`);
        return false;
      }
      fileData = await data.arrayBuffer();
    }

    if (!fileData || fileData.byteLength === 0) {
      console.error(`❌ ${docNumber}: ${label} vacío`);
      return false;
    }

    const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
    const metadata = {
      AttachableRef: [{ EntityRef: { type: entityType, value: entityId } }],
      FileName: filename,
      ContentType: contentType,
    };

    const encoder = new TextEncoder();
    const metadataBytes = encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file_metadata_01"; filename="file_metadata_01"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    );
    const headerBytes = encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file_content_01"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    );
    const endBytes = encoder.encode(`\r\n--${boundary}--\r\n`);
    const fileBytes = new Uint8Array(fileData);

    const body = new Uint8Array(
      metadataBytes.length + headerBytes.length + fileBytes.length + endBytes.length,
    );
    let offset = 0;
    body.set(metadataBytes, offset); offset += metadataBytes.length;
    body.set(headerBytes, offset); offset += headerBytes.length;
    body.set(fileBytes, offset); offset += fileBytes.length;
    body.set(endBytes, offset);

    const uploadResponse = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${realmId}/upload?minorversion=69`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      },
    );

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error(
        `❌ ${docNumber}: falló la subida de ${label}: ${uploadResponse.status} - ${errorText.substring(0, 200)}`,
      );
      return false;
    }

    const uploadResult = await uploadResponse.json();
    const attachableId = uploadResult.AttachableResponse?.[0]?.Attachable?.Id;
    console.log(
      `✅ ${docNumber}: ${label} adjuntado a ${entityType} ${entityId}${attachableId ? ` (Attachable ${attachableId})` : ""}`,
    );
    return true;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`❌ ${docNumber}: error adjuntando ${label}: ${msg}`);
    return false;
  }
}

export function attachPdfToQuickBooks(
  pdfUrl: string,
  entityId: string,
  entityType: string,
  docNumber: string,
  realmId: string,
  accessToken: string,
  supabase: any,
): Promise<boolean> {
  return attachFileToQuickBooks(
    pdfUrl, "application/pdf", "pdf",
    entityId, entityType, docNumber, realmId, accessToken, supabase,
  );
}

export function attachXmlToQuickBooks(
  xmlUrl: string,
  entityId: string,
  entityType: string,
  docNumber: string,
  realmId: string,
  accessToken: string,
  supabase: any,
): Promise<boolean> {
  return attachFileToQuickBooks(
    xmlUrl, "text/xml", "xml",
    entityId, entityType, docNumber, realmId, accessToken, supabase,
  );
}
