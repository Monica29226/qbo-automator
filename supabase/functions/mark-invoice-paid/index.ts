import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_MIME: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.split(",")[1] : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function sanitizeFilename(name: string): string {
  return (name || "comprobante")
    .replace(/[\/\\?%*:|"<>\x00-\x1F]/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json();
    const {
      document_id,
      payment_proof_base64,
      filename,
      payment_reference,
      payment_method,
    } = body || {};

    if (!document_id || !payment_proof_base64 || !filename) {
      return new Response(
        JSON.stringify({ error: "document_id, payment_proof_base64 and filename are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch document and check membership
    const { data: doc, error: docErr } = await admin
      .from("processed_documents")
      .select("id, organization_id, payment_status, supplier_name, doc_number, total_amount, currency")
      .eq("id", document_id)
      .single();

    if (docErr || !doc) {
      return new Response(JSON.stringify({ error: "Document not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: canEdit } = await admin.rpc("can_edit_organization_content", {
      _user_id: user.id,
      _org_id: doc.organization_id,
    });
    if (!canEdit) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Validate file
    const safeName = sanitizeFilename(filename);
    const ext = (safeName.split(".").pop() || "").toLowerCase();
    const mime = ALLOWED_MIME[ext];
    if (!mime) {
      return new Response(JSON.stringify({ error: `Unsupported file type: .${ext}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const bytes = b64ToBytes(payment_proof_base64);
    if (bytes.byteLength > MAX_BYTES) {
      return new Response(JSON.stringify({ error: "File exceeds 10 MB limit" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Upload to private bucket
    const ts = Date.now();
    const storagePath = `${doc.organization_id}/${document_id}/${ts}_${safeName}`;
    const { error: uploadErr } = await admin.storage
      .from("payment-proofs")
      .upload(storagePath, bytes, { contentType: mime, upsert: false });

    if (uploadErr) {
      return new Response(JSON.stringify({ error: `Upload failed: ${uploadErr.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Update document
    const updateData: any = {
      payment_status: "paid",
      paid_at: new Date().toISOString(),
      paid_by: user.id,
      payment_proof_url: storagePath,
      payment_proof_drive_id: null, // reset; will be set after Drive upload
    };
    if (payment_reference) updateData.payment_reference = payment_reference;
    if (payment_method) updateData.payment_method = payment_method;

    const { error: updErr } = await admin
      .from("processed_documents")
      .update(updateData)
      .eq("id", document_id);

    if (updErr) {
      return new Response(JSON.stringify({ error: `DB update failed: ${updErr.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Audit log
    await admin.from("audit_log").insert({
      organization_id: doc.organization_id,
      user_id: user.id,
      action: "invoice_marked_paid",
      resource_type: "processed_documents",
      resource_id: document_id,
      details: {
        payment_reference: payment_reference || null,
        payment_method: payment_method || null,
        storage_path: storagePath,
        previous_status: doc.payment_status,
      },
    });

    // Fire-and-forget Drive upload (don't block response)
    const driveUpload = fetch(`${SUPABASE_URL}/functions/v1/upload-to-google-drive`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        document_id,
        organization_id: doc.organization_id,
        mode: "payment_proof",
        payment_proof_storage_path: storagePath,
        payment_proof_mime: mime,
        payment_proof_extension: ext,
      }),
    }).catch((e) => console.error("Drive upload failed:", e));

    // Don't await — but wait briefly so EdgeRuntime doesn't kill it
    // @ts-ignore - EdgeRuntime is provided by Supabase
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(driveUpload);
    }

    return new Response(
      JSON.stringify({ success: true, storage_path: storagePath }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("mark-invoice-paid error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
