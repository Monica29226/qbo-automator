import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_EXECUTION_MS = 50_000;

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

function pickField(row: Record<string, any>, candidates: string[]): string {
  const normalizedRow: Record<string, any> = {};
  for (const k of Object.keys(row)) normalizedRow[norm(k)] = row[k];
  for (const c of candidates) {
    const v = normalizedRow[norm(c)];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

const CLAVE_CANDIDATES = [
  "clave", "clavenumerica", "clavecomprobante", "claveelectronica",
  "numeroclave", "clavedoc", "clavedocumento", "claveelec",
];
const CONSEC_CANDIDATES = [
  "consecutivodocumento", "numeroconsecutivo", "consecutivo",
  "numerodocumento", "numerofactura", "numero", "documento", "ndocumento",
  "nrodocumento", "nfactura",
];
const EMISOR_CANDIDATES = [
  "nombreemisor", "emisor", "nombre", "proveedor", "razonsocial",
  "nombreproveedor", "nombrerazonsocial",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const log = (m: string) => console.log(`[${Date.now() - startTime}ms] ${m}`);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) throw new Error("Authentication failed");

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const organizationId = formData.get("organization_id") as string;
    if (!file || !organizationId) throw new Error("file and organization_id are required");

    log(`📊 Parsing Excel for org ${organizationId}`);

    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(firstSheet) as any[];
    log(`📋 ${rows.length} rows`);

    const detected_headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    log(`🔎 Headers detectados: ${JSON.stringify(detected_headers)}`);

    const results = {
      total: rows.length,
      already_in_db: 0,
      already_in_qbo: 0,
      found_and_processed: 0,
      not_found: 0,
      failed: 0,
      skipped_timeout: 0,
      rows_skipped_no_id: 0,
      detected_headers,
      details: [] as any[],
    };

    let skippedSamples = 0;

    for (const row of rows) {
      if (Date.now() - startTime > MAX_EXECUTION_MS) {
        results.skipped_timeout = results.total -
          (results.already_in_db + results.already_in_qbo + results.found_and_processed +
           results.not_found + results.failed + results.rows_skipped_no_id);
        log(`⏰ Timeout, skipping remaining ${results.skipped_timeout}`);
        break;
      }

      const clave = pickField(row, CLAVE_CANDIDATES);
      const docNumber = pickField(row, CONSEC_CANDIDATES);
      const emisor = pickField(row, EMISOR_CANDIDATES);

      if (!docNumber && !clave) {
        results.rows_skipped_no_id++;
        if (skippedSamples < 3) {
          results.details.push({
            doc_number: "(sin id)",
            emisor: emisor || "(sin emisor)",
            status: "skipped_no_id",
            error: `No se encontró Clave ni Consecutivo. Headers de esta fila: ${JSON.stringify(Object.keys(row))}`,
          });
          skippedSamples++;
        }
        continue;
      }

      const searchKey = clave && clave.length === 50 ? clave : docNumber;

      let existing: any = null;
      if (clave && clave.length === 50) {
        const { data } = await supabase
          .from("processed_documents")
          .select("id,status,qbo_entity_id")
          .eq("organization_id", organizationId)
          .eq("doc_key", clave)
          .maybeSingle();
        existing = data;
      }
      if (!existing && docNumber) {
        const { data } = await supabase
          .from("processed_documents")
          .select("id,status,qbo_entity_id")
          .eq("organization_id", organizationId)
          .eq("doc_number", docNumber)
          .maybeSingle();
        existing = data;
      }

      if (existing) {
        if (existing.status === "published") {
          results.already_in_qbo++;
          results.details.push({ doc_number: docNumber, emisor, status: "already_published" });
        } else {
          results.already_in_db++;
          results.details.push({ doc_number: docNumber, emisor, status: existing.status });
        }
        continue;
      }

      try {
        log(`🔎 Searching providers for ${searchKey}`);
        const { data: searchData, error: searchErr } = await supabase.functions.invoke(
          "search-import-invoice",
          {
            body: {
              organization_id: organizationId,
              invoice_number: searchKey,
              expected_vendor: emisor || undefined,
              auto_publish: true,
            },
            headers: { Authorization: authHeader },
          }
        );

        if (searchErr) throw searchErr;

        const status = searchData?.status ?? (searchData?.success ? "processed_and_published" : "failed");
        if (
          searchData?.published ||
          status === "processed_and_published" ||
          status === "imported_and_published" ||
          searchData?.qbo_entity_id
        ) {
          results.found_and_processed++;
          results.details.push({ doc_number: docNumber, emisor, status: "processed_and_published" });
        } else if (status === "not_found" || status === "not_found_in_gmail" || searchData?.not_found) {
          results.not_found++;
          results.details.push({ doc_number: docNumber, emisor, status: "not_found_in_gmail" });
        } else if (status === "already_published" || status === "already_in_db") {
          results.already_in_qbo++;
          results.details.push({ doc_number: docNumber, emisor, status });
        } else {
          results.failed++;
          results.details.push({
            doc_number: docNumber,
            emisor,
            status: "failed",
            error: searchData?.error || searchData?.message || `status: ${status}`,
          });
        }
      } catch (e: any) {
        log(`❌ ${docNumber}: ${e.message}`);
        results.failed++;
        results.details.push({ doc_number: docNumber, emisor, status: "failed", error: e.message });
      }

      await new Promise((r) => setTimeout(r, 200));
    }

    log(`✅ Summary: processed=${results.found_and_processed} alreadyQBO=${results.already_in_qbo} alreadyDB=${results.already_in_db} notFound=${results.not_found} failed=${results.failed} skippedNoId=${results.rows_skipped_no_id} skippedTimeout=${results.skipped_timeout}`);

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("sync-from-excel error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
