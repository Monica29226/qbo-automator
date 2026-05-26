import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";
import { XMLParser } from "https://esm.sh/fast-xml-parser@4.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ItemStatus = "accepted" | "pending_hacienda" | "rejected" | "duplicate";

interface IncomingFile {
  filename: string;
  // base64-encoded contents
  data: string;
  // "xml" | "pdf"
  kind: "xml" | "pdf";
}

interface ProcessResult {
  filename: string;
  status: ItemStatus;
  reason?: string;
  doc_key?: string;
  doc_number?: string;
  doc_type?: string;
  supplier_name?: string;
  supplier_tax_id?: string;
  receptor_tax_id?: string;
  issue_date?: string;
  currency?: string;
  total_amount?: number;
  total_tax?: number;
  hacienda_message_code?: string;
  xml_storage_path?: string;
  pdf_storage_path?: string;
  receptor_xml_storage_path?: string;
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function getRoot(doc: Record<string, unknown>): { name: string; node: any } | null {
  for (const key of Object.keys(doc)) {
    if (key.startsWith("?")) continue;
    return { name: key, node: (doc as any)[key] };
  }
  return null;
}

function detectKind(xmlText: string): {
  type: "FacturaElectronica" | "MensajeReceptor" | "TiqueteElectronico" | "Other" | "Invalid";
  rootName?: string;
} {
  try {
    const doc = parser.parse(xmlText);
    const root = getRoot(doc);
    if (!root) return { type: "Invalid" };
    if (root.name === "FacturaElectronica") return { type: "FacturaElectronica", rootName: root.name };
    if (root.name === "MensajeReceptor") return { type: "MensajeReceptor", rootName: root.name };
    if (root.name === "TiqueteElectronico") return { type: "TiqueteElectronico", rootName: root.name };
    return { type: "Other", rootName: root.name };
  } catch {
    return { type: "Invalid" };
  }
}

function parseFactura(xmlText: string) {
  const doc = parser.parse(xmlText);
  const fe = (doc as any).FacturaElectronica;
  if (!fe) return null;
  return {
    clave: String(fe.Clave ?? "").trim(),
    consecutivo: String(fe.NumeroConsecutivo ?? "").trim(),
    fecha: String(fe.FechaEmision ?? "").slice(0, 10),
    emisorNombre: String(fe.Emisor?.Nombre ?? "").trim(),
    emisorCedula: String(
      fe.Emisor?.Identificacion?.Numero ?? fe.Emisor?.IdentificacionExtranjero ?? ""
    ).trim(),
    receptorCedula: String(
      fe.Receptor?.Identificacion?.Numero ?? fe.Receptor?.IdentificacionExtranjero ?? ""
    ).trim(),
    moneda: String(fe.ResumenFactura?.CodigoTipoMoneda?.CodigoMoneda ?? fe.ResumenFactura?.CodigoMoneda ?? "CRC").trim(),
    total: num(fe.ResumenFactura?.TotalComprobante),
    impuesto: num(fe.ResumenFactura?.TotalImpuesto),
  };
}

function parseReceptor(xmlText: string): { clave: string; mensaje: string } | null {
  const doc = parser.parse(xmlText);
  const mr = (doc as any).MensajeReceptor;
  if (!mr) return null;
  return {
    clave: String(mr.Clave ?? "").trim(),
    mensaje: String(mr.Mensaje ?? "").trim(),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const body = await req.json();
    const organization_id: string = body.organization_id;
    const batch_id: string = body.batch_id;
    const month_filter: string | null = body.month_filter ?? null;
    const files: IncomingFile[] = body.files ?? [];

    if (!organization_id || !batch_id || !Array.isArray(files)) {
      return json({ error: "invalid_payload" }, 400);
    }

    // Admin check
    const { data: isAdmin } = await supabase.rpc("is_organization_admin", {
      _org_id: organization_id,
      _user_id: user.id,
    });
    if (!isAdmin) return json({ error: "forbidden" }, 403);

    // Load org tax_id for receptor validation
    const { data: org } = await supabase
      .from("organizations")
      .select("tax_id, identification_number")
      .eq("id", organization_id)
      .maybeSingle();
    const orgTaxId = String(org?.tax_id ?? org?.identification_number ?? "").replace(/\D/g, "");


    // Index files by clave
    const xmls: { filename: string; text: string; bytes: Uint8Array }[] = [];
    const pdfsByClave = new Map<string, { filename: string; bytes: Uint8Array }>();
    const pdfsByName: { filename: string; bytes: Uint8Array }[] = [];

    for (const f of files) {
      const bytes = b64ToBytes(f.data);
      if (f.kind === "pdf") {
        const m = f.filename.match(/(\d{50})/);
        if (m) pdfsByClave.set(m[1], { filename: f.filename, bytes });
        else pdfsByName.push({ filename: f.filename, bytes });
      } else {
        xmls.push({ filename: f.filename, text: bytesToText(bytes), bytes });
      }
    }

    // Split XMLs: facturas vs mensajes receptor
    const facturas: { filename: string; text: string; bytes: Uint8Array; parsed: ReturnType<typeof parseFactura> }[] = [];
    const receptoresByClave = new Map<string, { mensaje: string; filename: string; bytes: Uint8Array }>();
    const otrosRechazados: { filename: string; reason: string }[] = [];

    for (const x of xmls) {
      const det = detectKind(x.text);
      if (det.type === "MensajeReceptor") {
        const r = parseReceptor(x.text);
        if (r?.clave) receptoresByClave.set(r.clave, { mensaje: r.mensaje, filename: x.filename, bytes: x.bytes });
      } else if (det.type === "FacturaElectronica") {
        const parsed = parseFactura(x.text);
        facturas.push({ ...x, parsed });
      } else if (det.type === "TiqueteElectronico") {
        otrosRechazados.push({ filename: x.filename, reason: "Es un tiquete electrónico, no factura" });
      } else if (det.type === "Other") {
        otrosRechazados.push({ filename: x.filename, reason: `Tipo no soportado: ${det.rootName}` });
      } else {
        otrosRechazados.push({ filename: x.filename, reason: "XML inválido o no es comprobante de Hacienda" });
      }
    }

    const results: ProcessResult[] = [];

    // Pre-fetch existing claves to detect duplicates
    const claves = facturas.map((f) => f.parsed?.clave).filter(Boolean) as string[];
    let existingByKey: Record<string, { issue_date: string }> = {};
    if (claves.length > 0) {
      const { data: existing } = await supabase
        .from("processed_documents")
        .select("doc_key, issue_date")
        .eq("organization_id", organization_id)
        .in("doc_key", claves);
      for (const e of existing ?? []) existingByKey[e.doc_key] = { issue_date: e.issue_date };
    }

    for (const fac of facturas) {
      const p = fac.parsed;
      const base: ProcessResult = {
        filename: fac.filename,
        status: "rejected",
        doc_key: p?.clave,
        doc_number: p?.consecutivo,
        doc_type: "FE",
        supplier_name: p?.emisorNombre,
        supplier_tax_id: p?.emisorCedula,
        receptor_tax_id: p?.receptorCedula,
        issue_date: p?.fecha || undefined,
        currency: p?.moneda,
        total_amount: p?.total,
        total_tax: p?.impuesto,
      };

      if (!p?.clave || !/^\d{50}$/.test(p.clave)) {
        results.push({ ...base, reason: "Clave inválida (debe tener 50 dígitos)" });
        continue;
      }

      // Date cutoff: only process invoices from 2026-01-01 onwards
      if (p.fecha && p.fecha < "2026-01-01") {
        results.push({ ...base, reason: `Fuera de rango: fecha ${p.fecha} es anterior al 1-ene-2026` });
        continue;
      }

      // Month filter
      if (month_filter && p.fecha && !p.fecha.startsWith(month_filter)) {
        results.push({ ...base, reason: `Fuera del mes seleccionado (${month_filter})` });
        continue;
      }

      // Receptor must match organization tax ID
      if (orgTaxId && p.receptorCedula) {
        const recCed = p.receptorCedula.replace(/\D/g, "");
        if (recCed && recCed !== orgTaxId) {
          results.push({
            ...base,
            reason: `Receptor incorrecto: factura dirigida a ${recCed}, esperado ${orgTaxId}`,
          });
          continue;
        }
      }

      // Duplicate
      if (existingByKey[p.clave]) {
        const d = existingByKey[p.clave].issue_date;
        results.push({
          ...base,
          status: "duplicate",
          reason: `Clave duplicada — ya existe del ${d}`,
        });
        continue;
      }


      // Upload XML
      const xmlPath = `${organization_id}/${batch_id}/${p.clave}.xml`;
      await supabase.storage.from("invoice-imports").upload(xmlPath, fac.bytes, {
        contentType: "application/xml",
        upsert: true,
      });
      base.xml_storage_path = xmlPath;

      // PDF pairing
      const pdfHit = pdfsByClave.get(p.clave);
      if (pdfHit) {
        const pdfPath = `${organization_id}/${batch_id}/${p.clave}.pdf`;
        await supabase.storage.from("invoice-imports").upload(pdfPath, pdfHit.bytes, {
          contentType: "application/pdf",
          upsert: true,
        });
        base.pdf_storage_path = pdfPath;
      }

      // Hacienda receptor message
      const rec = receptoresByClave.get(p.clave);
      if (rec) {
        const recPath = `${organization_id}/${batch_id}/${p.clave}.receptor.xml`;
        await supabase.storage.from("invoice-imports").upload(recPath, rec.bytes, {
          contentType: "application/xml",
          upsert: true,
        });
        base.receptor_xml_storage_path = recPath;
        base.hacienda_message_code = rec.mensaje;

        if (rec.mensaje === "1") {
          base.status = "accepted";
        } else if (rec.mensaje === "2") {
          results.push({ ...base, status: "rejected", reason: "Rechazada por Hacienda (Mensaje=2)" });
          continue;
        } else if (rec.mensaje === "3") {
          results.push({ ...base, status: "rejected", reason: "Aceptada parcial por Hacienda (Mensaje=3)" });
          continue;
        } else {
          results.push({ ...base, status: "rejected", reason: `Mensaje Receptor desconocido: ${rec.mensaje}` });
          continue;
        }
      } else {
        base.status = "pending_hacienda";
        base.reason = "Falta Mensaje Receptor de Hacienda";
      }

      // Bridge: if accepted, actually create the invoice record via the standard pipeline
      if (base.status === "accepted") {
        try {
          const { data: procData, error: procErr } = await supabase.functions.invoke(
            "process-document-xml",
            {
              body: {
                organization_id,
                xml_content: bytesToText(fac.bytes),
                pdf_attachment_url: base.pdf_storage_path ?? null,
                file_path: base.pdf_storage_path ?? null,
                source: "batch_import_v2",
              },
            }
          );
          if (procErr) {
            const msg = (procErr.message || "").toLowerCase();
            if (msg.includes("duplicad") || msg.includes("ya existe")) {
              base.status = "duplicate";
              base.reason = "Ya existía en el sistema";
            } else {
              base.status = "rejected";
              base.reason = `Error al crear factura: ${procErr.message}`;
            }
          } else if (procData?.status === "review" || procData?.needs_config) {
            base.reason = "Aceptada — proveedor sin cuenta QBO configurada (Configuración Pendiente)";
          }
        } catch (e) {
          base.status = "rejected";
          base.reason = `Excepción al crear factura: ${e instanceof Error ? e.message : String(e)}`;
        }
      }

      results.push(base);
    }


    // Append "otros" rejected (tiquetes, etc.)
    for (const o of otrosRechazados) {
      results.push({ filename: o.filename, status: "rejected", reason: o.reason });
    }

    // Insert items
    const itemRows = results.map((r) => ({
      batch_id,
      organization_id,
      filename: r.filename,
      doc_key: r.doc_key ?? null,
      doc_number: r.doc_number ?? null,
      doc_type: r.doc_type ?? null,
      supplier_name: r.supplier_name ?? null,
      supplier_tax_id: r.supplier_tax_id ?? null,
      receptor_tax_id: r.receptor_tax_id ?? null,
      issue_date: r.issue_date ?? null,
      currency: r.currency ?? null,
      total_amount: r.total_amount ?? null,
      total_tax: r.total_tax ?? null,
      status: r.status,
      reason: r.reason ?? null,
      hacienda_message_code: r.hacienda_message_code ?? null,
      xml_storage_path: r.xml_storage_path ?? null,
      pdf_storage_path: r.pdf_storage_path ?? null,
      receptor_xml_storage_path: r.receptor_xml_storage_path ?? null,
    }));

    if (itemRows.length > 0) {
      const { error: insErr } = await supabase.from("batch_import_items").insert(itemRows);
      if (insErr) console.error("Insert items error:", insErr);
    }

    // Aggregate counts
    const counts = {
      accepted_count: results.filter((r) => r.status === "accepted").length,
      pending_count: results.filter((r) => r.status === "pending_hacienda").length,
      rejected_count: results.filter((r) => r.status === "rejected").length,
      duplicate_count: results.filter((r) => r.status === "duplicate").length,
    };

    return json({ ok: true, results, counts });
  } catch (e) {
    console.error("batch-import-process error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
