import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  refreshSharePointToken,
  ensureFolderPath,
  uploadFileToSharePoint,
  buildSafeFileName,
  monthEs,
} from "../_shared/sharepoint.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function downloadFromStorage(
  supabase: ReturnType<typeof createClient>,
  pathOrUrl: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!pathOrUrl) return null;
  try {
    if (/^https?:\/\//i.test(pathOrUrl)) {
      const res = await fetch(pathOrUrl);
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      return { bytes: buf, contentType: res.headers.get("Content-Type") || "application/octet-stream" };
    }
    // Treat as path in company-documents bucket
    const { data, error } = await supabase.storage.from("company-documents").download(pathOrUrl);
    if (error || !data) return null;
    const buf = new Uint8Array(await data.arrayBuffer());
    const ct = pathOrUrl.toLowerCase().endsWith(".pdf")
      ? "application/pdf"
      : pathOrUrl.toLowerCase().endsWith(".xml")
        ? "application/xml"
        : "application/octet-stream";
    return { bytes: buf, contentType: ct };
  } catch (_e) {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { document_id } = await req.json();
    if (!document_id) return json({ error: "document_id required" }, 400);

    const { data: doc, error: docErr } = await supabase
      .from("processed_documents")
      .select("*")
      .eq("id", document_id)
      .single();
    if (docErr || !doc) return json({ error: "document not found" }, 404);

    const { data: org } = await supabase
      .from("organizations")
      .select("id, name, sharepoint_enabled, sharepoint_folder_override")
      .eq("id", doc.organization_id)
      .single();
    if (!org) return json({ error: "organization not found" }, 404);

    if (org.sharepoint_enabled === false) {
      return json({ skipped: true, reason: "org sharepoint disabled" });
    }

    // Check active account exists
    const { data: existsCheck } = await supabase
      .from("sharepoint_admin_account")
      .select("id")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (!existsCheck) {
      return json({ skipped: true, reason: "no active sharepoint admin account" });
    }

    const { accessToken, account } = await refreshSharePointToken(supabase);
    if (!account.drive_id || !account.root_folder_id) {
      return json({ skipped: true, reason: "sharepoint site not configured" });
    }

    const folderName = (org.sharepoint_folder_override || org.name || "Sin_Nombre").trim();
    const issueDate = doc.issue_date || new Date().toISOString().slice(0, 10);
    const year = String(new Date(issueDate).getUTCFullYear());
    const month = monthEs(issueDate);

    const folderId = await ensureFolderPath(
      accessToken,
      account.drive_id,
      account.root_folder_id,
      [folderName, year, month],
    );

    const pathLog = `${account.root_folder_path}/${folderName}/${year}/${month}`;
    const uploadedFiles: { kind: string; name: string; id: string }[] = [];

    // PDF
    let sharepoint_pdf_id: string | null = doc.sharepoint_pdf_id || null;
    if (doc.pdf_attachment_url) {
      const pdf = await downloadFromStorage(supabase, doc.pdf_attachment_url);
      if (pdf) {
        const name = buildSafeFileName(
          doc.supplier_name || "Proveedor",
          doc.total_amount || 0,
          issueDate,
          doc.currency || "CRC",
          "pdf",
        );
        const up = await uploadFileToSharePoint(accessToken, account.drive_id, folderId, name, pdf.bytes, "application/pdf");
        sharepoint_pdf_id = up.id;
        uploadedFiles.push({ kind: "pdf", name: up.name, id: up.id });
      } else {
        console.log(`[SharePoint] doc=${doc.id} PDF not found at ${doc.pdf_attachment_url}`);
      }
    }

    // XML
    let sharepoint_xml_id: string | null = doc.sharepoint_xml_id || null;
    if (doc.xml_attachment_url) {
      const xml = await downloadFromStorage(supabase, doc.xml_attachment_url);
      if (xml) {
        const name = buildSafeFileName(
          doc.supplier_name || "Proveedor",
          doc.total_amount || 0,
          issueDate,
          doc.currency || "CRC",
          "xml",
        );
        const up = await uploadFileToSharePoint(accessToken, account.drive_id, folderId, name, xml.bytes, "application/xml");
        sharepoint_xml_id = up.id;
        uploadedFiles.push({ kind: "xml", name: up.name, id: up.id });
      } else {
        console.log(`[SharePoint] doc=${doc.id} XML not found at ${doc.xml_attachment_url}`);
      }
    }

    const status = uploadedFiles.length > 0 ? "uploaded" : "no_files";

    await supabase
      .from("processed_documents")
      .update({
        sharepoint_pdf_id,
        sharepoint_xml_id,
        sharepoint_uploaded_at: uploadedFiles.length > 0 ? new Date().toISOString() : doc.sharepoint_uploaded_at,
        sharepoint_status: status,
        sharepoint_error: null,
        sharepoint_retry_count: (doc.sharepoint_retry_count || 0),
      })
      .eq("id", document_id);

    console.log(`[SharePoint] org=${org.name} doc=${doc.doc_number} → ${pathLog}, Files: ${uploadedFiles.map(f => f.kind.toUpperCase()).join("+") || "none"}, Status: ${status}`);

    return json({ ok: true, uploaded: uploadedFiles, folder_path: pathLog });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[SharePoint] upload error:", msg);
    try {
      const body = await req.clone().json();
      if (body.document_id) {
        await supabase
          .from("processed_documents")
          .update({
            sharepoint_status: "failed",
            sharepoint_error: msg.slice(0, 500),
            sharepoint_retry_count: 1,
          })
          .eq("id", body.document_id);
        // Best-effort increment
        await supabase.rpc("noop").catch(() => {});
      }
    } catch (_) { /* */ }
    return json({ error: msg }, 500);
  }
});
