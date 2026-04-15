import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action, ...params } = await req.json();

    switch (action) {
      case "process_job":
        return await processJob(supabaseAdmin, params);
      case "process_csv_content":
        return await processCsvContent(supabaseAdmin, params);
      case "process_xlsx_content":
        return await processXlsxContent(supabaseAdmin, params);
      case "generate_qbo_csv":
        return await generateQboCsv(supabaseAdmin, params);
      case "reprocess_job":
        return await reprocessJob(supabaseAdmin, params);
      default:
        return new Response(JSON.stringify({ error: "Unknown action" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (err) {
    console.error("process-bank-statement error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ===== PARSERS =====

function parseDebeHaber(
  rows: string[][],
  config: any,
  source: any
): { items: any[]; errors: string[] } {
  const items: any[] = [];
  const errors: string[] = [];
  const mapping = source?.column_mapping || {};
  
  // Default column indices for Fecha, Documento, Debe, Haber, Descripción
  const dateCol = mapping.date ?? 0;
  const refCol = mapping.reference ?? 1;
  const debitCol = mapping.debit ?? 2;
  const creditCol = mapping.credit ?? 3;
  const descCol = mapping.description ?? 4;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => !c?.trim())) continue;

    try {
      const dateStr = row[dateCol]?.trim();
      const ref = row[refCol]?.trim() || "";
      const debitStr = row[debitCol]?.trim() || "0";
      const creditStr = row[creditCol]?.trim() || "0";
      const desc = row[descCol]?.trim() || "";

      const parsedDate = parseDate(dateStr, config.date_format);
      if (!parsedDate) {
        items.push({
          transaction_date: new Date().toISOString().split("T")[0],
          reference: ref,
          description: desc,
          money_in: 0,
          money_out: 0,
          currency: config.currency,
          source_bank: config.bank_name,
          raw_row: Object.fromEntries(row.map((v, idx) => [`col${idx}`, v])),
          status: "INVALID",
          validation_error: `Fecha inválida en fila ${i + 1}: "${dateStr}"`,
        });
        errors.push(`Fila ${i + 1}: fecha inválida "${dateStr}"`);
        continue;
      }

      const moneyOut = parseAmount(debitStr);
      const moneyIn = parseAmount(creditStr);

      if (moneyIn === 0 && moneyOut === 0) {
        items.push({
          transaction_date: parsedDate,
          reference: ref,
          description: desc,
          money_in: 0,
          money_out: 0,
          currency: config.currency,
          source_bank: config.bank_name,
          raw_row: Object.fromEntries(row.map((v, idx) => [`col${idx}`, v])),
          status: "INVALID",
          validation_error: `Fila ${i + 1}: debe y haber son cero`,
        });
        errors.push(`Fila ${i + 1}: montos en cero`);
        continue;
      }

      items.push({
        transaction_date: parsedDate,
        reference: ref,
        description: desc,
        money_in: moneyIn,
        money_out: moneyOut,
        currency: config.currency,
        source_bank: config.bank_name,
        raw_row: Object.fromEntries(row.map((v, idx) => [`col${idx}`, v])),
        status: "VALID",
        validation_error: null,
      });
    } catch (e) {
      errors.push(`Fila ${i + 1}: ${e.message}`);
    }
  }

  return { items, errors };
}

function parseSingleAmount(
  rows: string[][],
  config: any,
  source: any
): { items: any[]; errors: string[] } {
  const items: any[] = [];
  const errors: string[] = [];
  const mapping = source?.column_mapping || {};
  
  const dateCol = mapping.date ?? 0;
  const descCol = mapping.description ?? 1;
  const amountCol = mapping.amount ?? 2;
  const refCol = mapping.reference ?? null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => !c?.trim())) continue;

    try {
      const dateStr = row[dateCol]?.trim();
      const desc = row[descCol]?.trim() || "";
      const amountStr = row[amountCol]?.trim() || "0";
      const ref = refCol !== null ? (row[refCol]?.trim() || "") : "";

      const parsedDate = parseDate(dateStr, config.date_format);
      if (!parsedDate) {
        items.push({
          transaction_date: new Date().toISOString().split("T")[0],
          reference: ref,
          description: desc,
          money_in: 0,
          money_out: 0,
          currency: config.currency,
          source_bank: config.bank_name,
          raw_row: Object.fromEntries(row.map((v, idx) => [`col${idx}`, v])),
          status: "INVALID",
          validation_error: `Fecha inválida en fila ${i + 1}: "${dateStr}"`,
        });
        continue;
      }

      const amount = parseAmount(amountStr);
      const moneyIn = amount > 0 ? amount : 0;
      const moneyOut = amount < 0 ? Math.abs(amount) : 0;

      if (amount === 0) {
        items.push({
          transaction_date: parsedDate,
          reference: ref,
          description: desc,
          money_in: 0,
          money_out: 0,
          currency: config.currency,
          source_bank: config.bank_name,
          raw_row: Object.fromEntries(row.map((v, idx) => [`col${idx}`, v])),
          status: "INVALID",
          validation_error: `Fila ${i + 1}: monto es cero`,
        });
        continue;
      }

      items.push({
        transaction_date: parsedDate,
        reference: ref,
        description: desc,
        money_in: moneyIn,
        money_out: moneyOut,
        currency: config.currency,
        source_bank: config.bank_name,
        raw_row: Object.fromEntries(row.map((v, idx) => [`col${idx}`, v])),
        status: "VALID",
        validation_error: null,
      });
    } catch (e) {
      errors.push(`Fila ${i + 1}: ${e.message}`);
    }
  }

  return { items, errors };
}

// ===== UTILITIES =====

function parseDate(dateStr: string, format: string): string | null {
  if (!dateStr) return null;

  try {
    let day: number, month: number, year: number;

    if (format === "dd/MM/yyyy") {
      const parts = dateStr.split(/[\/\-\.]/);
      if (parts.length < 3) return null;
      day = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10);
      year = parseInt(parts[2], 10);
    } else if (format === "MM/dd/yyyy") {
      const parts = dateStr.split(/[\/\-\.]/);
      if (parts.length < 3) return null;
      month = parseInt(parts[0], 10);
      day = parseInt(parts[1], 10);
      year = parseInt(parts[2], 10);
    } else if (format === "yyyy-MM-dd") {
      const parts = dateStr.split(/[\/\-\.]/);
      if (parts.length < 3) return null;
      year = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10);
      day = parseInt(parts[2], 10);
    } else {
      // Try auto-detect
      const parts = dateStr.split(/[\/\-\.]/);
      if (parts.length < 3) return null;
      if (parts[0].length === 4) {
        year = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10);
        day = parseInt(parts[2], 10);
      } else {
        day = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10);
        year = parseInt(parts[2], 10);
      }
    }

    if (year < 100) year += 2000;
    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    const d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
      return null;
    }

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  } catch {
    return null;
  }
}

function parseAmount(str: string): number {
  if (!str || str.trim() === "" || str.trim() === "-") return 0;
  // Remove currency symbols, spaces
  let cleaned = str.replace(/[₡$€\s]/g, "").trim();
  
  // Detect negative: parentheses or leading minus
  let negative = false;
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    negative = true;
    cleaned = cleaned.slice(1, -1);
  } else if (cleaned.startsWith("-")) {
    negative = true;
    cleaned = cleaned.slice(1);
  }

  // Handle thousand separators vs decimal separators
  // Costa Rican format: 1.234.567,89 or 1,234,567.89
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  
  if (lastComma > lastDot) {
    // Comma is decimal separator: 1.234,56
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    // Dot is decimal separator: 1,234.56
    cleaned = cleaned.replace(/,/g, "");
  } else {
    // Only one type or none
    cleaned = cleaned.replace(/,/g, "");
  }

  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return negative ? -num : num;
}

function parseCsvContent(content: string): string[][] {
  const lines = content.split(/\r?\n/);
  const rows: string[][] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    // Simple CSV parser handling quoted fields
    const row: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if ((char === "," || char === ";") && !inQuotes) {
        row.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    row.push(current);
    rows.push(row);
  }

  return rows;
}

function isHeaderRow(row: string[]): boolean {
  const headerKeywords = [
    "fecha", "date", "documento", "document", "debe", "haber",
    "debit", "credit", "descripcion", "description", "monto",
    "amount", "referencia", "reference", "concepto",
  ];
  const rowLower = row.map((c) => (c || "").toLowerCase().trim());
  const matches = rowLower.filter((c) => headerKeywords.some((k) => c.includes(k)));
  return matches.length >= 2;
}

// ===== ACTIONS =====

async function processCsvContent(supabase: any, params: any) {
  const { job_id, csv_content, organization_id, config_id } = params;

  if (!job_id || !csv_content || !organization_id || !config_id) {
    return new Response(
      JSON.stringify({ error: "Missing required params: job_id, csv_content, organization_id, config_id" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Update job to PROCESSING
  await supabase
    .from("bank_import_jobs")
    .update({ status: "PROCESSING" })
    .eq("id", job_id);

  // Get config
  const { data: config, error: configErr } = await supabase
    .from("bank_import_configs")
    .select("*")
    .eq("id", config_id)
    .single();

  if (configErr || !config) {
    await supabase
      .from("bank_import_jobs")
      .update({ status: "ERROR", error_message: "Configuración no encontrada" })
      .eq("id", job_id);
    return new Response(
      JSON.stringify({ error: "Config not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get source (optional, for column mapping)
  const { data: sources } = await supabase
    .from("bank_import_sources")
    .select("*")
    .eq("bank_import_config_id", config_id)
    .eq("is_active", true)
    .limit(1);

  const source = sources?.[0] || null;

  // Parse CSV
  const allRows = parseCsvContent(csv_content);
  if (allRows.length === 0) {
    await supabase
      .from("bank_import_jobs")
      .update({ status: "ERROR", error_message: "Archivo vacío" })
      .eq("id", job_id);
    return new Response(
      JSON.stringify({ error: "Empty file" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Skip header row if detected
  let dataRows = allRows;
  if (isHeaderRow(allRows[0])) {
    dataRows = allRows.slice(1);
  }

  // Parse based on layout
  let result: { items: any[]; errors: string[] };
  if (config.amount_layout === "SINGLE_SIGNED_AMOUNT") {
    result = parseSingleAmount(dataRows, config, source);
  } else {
    result = parseDebeHaber(dataRows, config, source);
  }

  if (result.items.length === 0) {
    await supabase
      .from("bank_import_jobs")
      .update({
        status: "ERROR",
        error_message: "No se encontraron transacciones válidas",
        error_details: result.errors.join("\n"),
      })
      .eq("id", job_id);
    return new Response(
      JSON.stringify({ error: "No valid transactions", errors: result.errors }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Delete existing items for this job (in case of reprocess)
  await supabase
    .from("bank_import_job_items")
    .delete()
    .eq("bank_import_job_id", job_id);

  // Insert items in batches of 100
  const itemsToInsert = result.items.map((item) => ({
    ...item,
    bank_import_job_id: job_id,
    organization_id,
  }));

  for (let i = 0; i < itemsToInsert.length; i += 100) {
    const batch = itemsToInsert.slice(i, i + 100);
    const { error: insertErr } = await supabase
      .from("bank_import_job_items")
      .insert(batch);
    if (insertErr) {
      console.error("Insert error:", insertErr);
    }
  }

  const validCount = result.items.filter((i) => i.status === "VALID").length;
  const invalidCount = result.items.filter((i) => i.status === "INVALID").length;

  const finalStatus = invalidCount > 0 && validCount === 0 ? "ERROR" : "PROCESSED";

  await supabase
    .from("bank_import_jobs")
    .update({
      status: finalStatus,
      total_rows: result.items.length,
      valid_rows: validCount,
      invalid_rows: invalidCount,
      error_message: invalidCount > 0 ? `${invalidCount} filas con errores` : null,
      error_details: result.errors.length > 0 ? result.errors.join("\n") : null,
    })
    .eq("id", job_id);

  return new Response(
    JSON.stringify({
      success: true,
      total: result.items.length,
      valid: validCount,
      invalid: invalidCount,
      errors: result.errors,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function processJob(supabase: any, params: any) {
  const { job_id } = params;
  if (!job_id) {
    return new Response(JSON.stringify({ error: "job_id required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: job } = await supabase
    .from("bank_import_jobs")
    .select("*")
    .eq("id", job_id)
    .single();

  if (!job) {
    return new Response(JSON.stringify({ error: "Job not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // For now, this just triggers generate CSV if job is PROCESSED
  if (job.status === "PROCESSED") {
    return await generateQboCsv(supabase, { job_id, organization_id: job.organization_id });
  }

  return new Response(JSON.stringify({ error: "Job not in processable state", status: job.status }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function generateQboCsv(supabase: any, params: any) {
  const { job_id, organization_id } = params;

  if (!job_id) {
    return new Response(JSON.stringify({ error: "job_id required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Get valid items
  const { data: items, error: itemsErr } = await supabase
    .from("bank_import_job_items")
    .select("*")
    .eq("bank_import_job_id", job_id)
    .eq("status", "VALID")
    .order("transaction_date", { ascending: true });

  if (itemsErr || !items || items.length === 0) {
    return new Response(
      JSON.stringify({ error: "No valid items to export" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get job info for config
  const { data: job } = await supabase
    .from("bank_import_jobs")
    .select("*, bank_import_configs(*)")
    .eq("id", job_id)
    .single();

  // Generate QBO-compatible CSV (3 columns: Date, Description, Amount)
  // QBO expects: positive = deposit (money in), negative = withdrawal (money out)
  const csvLines: string[] = ["Date,Description,Amount"];

  for (const item of items) {
    // Format date as MM/DD/YYYY for QBO
    const d = new Date(item.transaction_date + "T00:00:00");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const year = d.getFullYear();
    const qboDate = `${month}/${day}/${year}`;

    // Build description: include reference if available
    let desc = (item.description || "").replace(/"/g, '""');
    if (item.reference) {
      desc = `${item.reference} - ${desc}`;
    }

    // Amount: positive for deposits (money_in), negative for withdrawals (money_out)
    let amount: number;
    if (item.money_in > 0) {
      amount = item.money_in;
    } else {
      amount = -item.money_out;
    }

    csvLines.push(`${qboDate},"${desc}",${amount.toFixed(2)}`);
  }

  const csvContent = csvLines.join("\n");

  // Upload to storage
  const fileName = `bank-csv/${organization_id}/${job_id}_qbo.csv`;
  const { error: uploadErr } = await supabase.storage
    .from("company-documents")
    .upload(fileName, new Blob([csvContent], { type: "text/csv" }), {
      contentType: "text/csv",
      upsert: true,
    });

  if (uploadErr) {
    console.error("Upload error:", uploadErr);
    return new Response(
      JSON.stringify({ error: "Failed to upload CSV", details: uploadErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Update job with CSV URL
  await supabase
    .from("bank_import_jobs")
    .update({ generated_csv_url: fileName })
    .eq("id", job_id);

  return new Response(
    JSON.stringify({
      success: true,
      csv_path: fileName,
      rows_exported: items.length,
      csv_content: csvContent,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function reprocessJob(supabase: any, params: any) {
  const { job_id } = params;
  if (!job_id) {
    return new Response(JSON.stringify({ error: "job_id required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Reset job to PENDING
  await supabase
    .from("bank_import_jobs")
    .update({
      status: "PENDING",
      error_message: null,
      error_details: null,
      generated_csv_url: null,
      total_rows: 0,
      valid_rows: 0,
      invalid_rows: 0,
    })
    .eq("id", job_id);

  return new Response(
    JSON.stringify({ success: true, message: "Job reset to PENDING" }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ===== XLSX Parser =====

function parseXlsxBase64(base64: string): string[][] {
  // Decode base64 to binary
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  // Minimal XLSX parser - XLSX files are ZIP archives containing XML sheets
  // We'll extract the shared strings and sheet data
  try {
    const zip = parseZip(bytes);
    
    // Get shared strings
    const sharedStringsXml = zip["xl/sharedStrings.xml"] || "";
    const sharedStrings = extractSharedStrings(sharedStringsXml);
    
    // Get first sheet
    const sheetXml = zip["xl/worksheets/sheet1.xml"] || "";
    return extractSheetRows(sheetXml, sharedStrings);
  } catch (err) {
    console.error("XLSX parse error:", err);
    throw new Error("No se pudo leer el archivo XLSX. Verifique que sea un archivo válido.");
  }
}

function parseZip(data: Uint8Array): Record<string, string> {
  const files: Record<string, string> = {};
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  while (offset < data.length - 4) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break; // Not a local file header

    const compMethod = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const uncompSize = view.getUint32(offset + 22, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);

    const nameBytes = data.slice(offset + 30, offset + 30 + nameLen);
    const fileName = new TextDecoder().decode(nameBytes);
    const dataStart = offset + 30 + nameLen + extraLen;

    if (compMethod === 0) {
      // Stored (no compression)
      const fileData = data.slice(dataStart, dataStart + uncompSize);
      files[fileName] = new TextDecoder().decode(fileData);
    } else if (compMethod === 8) {
      // Deflate - use DecompressionStream
      try {
        const compressed = data.slice(dataStart, dataStart + compSize);
        // For Deno, use raw inflate
        const decompressed = inflateRaw(compressed);
        files[fileName] = new TextDecoder().decode(decompressed);
      } catch {
        // Skip files we can't decompress
      }
    }

    offset = dataStart + compSize;
  }

  return files;
}

function inflateRaw(data: Uint8Array): Uint8Array {
  // Simple inflate implementation for Deno
  // Use the built-in DecompressionStream
  const ds = new DecompressionStream("raw");
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  
  const chunks: Uint8Array[] = [];
  
  // This is sync-like using a workaround
  let done = false;
  
  writer.write(data).then(() => writer.close());
  
  const readAll = async () => {
    while (true) {
      const { value, done: d } = await reader.read();
      if (d) break;
      if (value) chunks.push(value);
    }
  };
  
  // We need to handle this synchronously in the context
  // Fall back to treating compressed data as-is if decompression fails
  throw new Error("Use async xlsx parsing");
}

function extractSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const regex = /<si>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/si>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    strings.push(decodeXmlEntities(match[1]));
  }
  
  // Also try multi-run strings <si><r><t>...</t></r>...</si>
  if (strings.length === 0) {
    const siRegex = /<si>([\s\S]*?)<\/si>/g;
    while ((match = siRegex.exec(xml)) !== null) {
      const tValues: string[] = [];
      const tRegex = /<t[^>]*>([\s\S]*?)<\/t>/g;
      let tMatch;
      while ((tMatch = tRegex.exec(match[1])) !== null) {
        tValues.push(decodeXmlEntities(tMatch[1]));
      }
      strings.push(tValues.join(""));
    }
  }
  
  return strings;
}

function extractSheetRows(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  const rowRegex = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const row: string[] = [];
    const cellRegex = /<c\s+r="([A-Z]+)(\d+)"[^>]*(?:t="([^"]*)")?[^>]*>[\s\S]*?(?:<v>([\s\S]*?)<\/v>)?[\s\S]*?<\/c>/g;
    let cellMatch;
    let maxCol = 0;

    const cells: Array<{ col: number; value: string }> = [];

    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      const colLetter = cellMatch[1];
      const cellType = cellMatch[3] || "";
      const rawValue = cellMatch[4] || "";

      const colIndex = colLetterToIndex(colLetter);
      maxCol = Math.max(maxCol, colIndex);

      let value: string;
      if (cellType === "s") {
        // Shared string
        const idx = parseInt(rawValue, 10);
        value = sharedStrings[idx] || "";
      } else if (cellType === "inlineStr") {
        value = rawValue;
      } else {
        value = rawValue;
      }

      cells.push({ col: colIndex, value });
    }

    // Fill row with empty strings up to maxCol
    for (let i = 0; i <= maxCol; i++) {
      const cell = cells.find((c) => c.col === i);
      row.push(cell ? cell.value : "");
    }

    if (row.length > 0) rows.push(row);
  }

  return rows;
}

function colLetterToIndex(letters: string): number {
  let index = 0;
  for (let i = 0; i < letters.length; i++) {
    index = index * 26 + (letters.charCodeAt(i) - 64);
  }
  return index - 1;
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function processXlsxContent(supabase: any, params: any) {
  const { job_id, xlsx_base64, organization_id, config_id } = params;

  if (!job_id || !xlsx_base64 || !organization_id || !config_id) {
    return new Response(
      JSON.stringify({ error: "Missing required params: job_id, xlsx_base64, organization_id, config_id" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Update job to PROCESSING
  await supabase
    .from("bank_import_jobs")
    .update({ status: "PROCESSING" })
    .eq("id", job_id);

  // Get config
  const { data: config, error: configErr } = await supabase
    .from("bank_import_configs")
    .select("*")
    .eq("id", config_id)
    .single();

  if (configErr || !config) {
    await supabase
      .from("bank_import_jobs")
      .update({ status: "ERROR", error_message: "Configuración no encontrada" })
      .eq("id", job_id);
    return new Response(
      JSON.stringify({ error: "Config not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get source
  const { data: sources } = await supabase
    .from("bank_import_sources")
    .select("*")
    .eq("bank_import_config_id", config_id)
    .eq("is_active", true)
    .limit(1);

  const source = sources?.[0] || null;

  try {
    // Parse XLSX - for compressed XLSX we need async decompression
    const binary = atob(xlsx_base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const allRows = await parseXlsxAsync(bytes);

    if (allRows.length === 0) {
      await supabase
        .from("bank_import_jobs")
        .update({ status: "ERROR", error_message: "Archivo XLSX vacío o no se pudo leer" })
        .eq("id", job_id);
      return new Response(
        JSON.stringify({ error: "Empty XLSX file" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Skip header row if detected
    let dataRows = allRows;
    if (isHeaderRow(allRows[0])) {
      dataRows = allRows.slice(1);
    }

    // Parse based on layout
    let result: { items: any[]; errors: string[] };
    if (config.amount_layout === "SINGLE_SIGNED_AMOUNT") {
      result = parseSingleAmount(dataRows, config, source);
    } else {
      result = parseDebeHaber(dataRows, config, source);
    }

    if (result.items.length === 0) {
      await supabase
        .from("bank_import_jobs")
        .update({
          status: "ERROR",
          error_message: "No se encontraron transacciones válidas en XLSX",
          error_details: result.errors.join("\n"),
        })
        .eq("id", job_id);
      return new Response(
        JSON.stringify({ error: "No valid transactions in XLSX", errors: result.errors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Delete existing items
    await supabase
      .from("bank_import_job_items")
      .delete()
      .eq("bank_import_job_id", job_id);

    // Insert items
    const itemsToInsert = result.items.map((item) => ({
      ...item,
      bank_import_job_id: job_id,
      organization_id,
    }));

    for (let i = 0; i < itemsToInsert.length; i += 100) {
      const batch = itemsToInsert.slice(i, i + 100);
      await supabase.from("bank_import_job_items").insert(batch);
    }

    const validCount = result.items.filter((i) => i.status === "VALID").length;
    const invalidCount = result.items.filter((i) => i.status === "INVALID").length;
    const finalStatus = invalidCount > 0 && validCount === 0 ? "ERROR" : "PROCESSED";

    await supabase
      .from("bank_import_jobs")
      .update({
        status: finalStatus,
        total_rows: result.items.length,
        valid_rows: validCount,
        invalid_rows: invalidCount,
        error_message: invalidCount > 0 ? `${invalidCount} filas con errores` : null,
        error_details: result.errors.length > 0 ? result.errors.join("\n") : null,
      })
      .eq("id", job_id);

    return new Response(
      JSON.stringify({
        success: true,
        total: result.items.length,
        valid: validCount,
        invalid: invalidCount,
        errors: result.errors,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("XLSX processing error:", err);
    await supabase
      .from("bank_import_jobs")
      .update({ status: "ERROR", error_message: `Error XLSX: ${err.message}` })
      .eq("id", job_id);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

async function parseXlsxAsync(data: Uint8Array): Promise<string[][]> {
  const files = await parseZipAsync(data);
  const sharedStringsXml = files["xl/sharedStrings.xml"] || "";
  const sharedStrings = extractSharedStrings(sharedStringsXml);
  const sheetXml = files["xl/worksheets/sheet1.xml"] || "";
  return extractSheetRows(sheetXml, sharedStrings);
}

async function parseZipAsync(data: Uint8Array): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  while (offset < data.length - 4) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break;

    const compMethod = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const uncompSize = view.getUint32(offset + 22, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);

    const nameBytes = data.slice(offset + 30, offset + 30 + nameLen);
    const fileName = new TextDecoder().decode(nameBytes);
    const dataStart = offset + 30 + nameLen + extraLen;

    // Only process XML files we need
    if (fileName.endsWith(".xml") || fileName.endsWith(".rels")) {
      if (compMethod === 0) {
        const fileData = data.slice(dataStart, dataStart + uncompSize);
        files[fileName] = new TextDecoder().decode(fileData);
      } else if (compMethod === 8) {
        try {
          const compressed = data.slice(dataStart, dataStart + compSize);
          const decompressed = await decompressDeflate(compressed);
          files[fileName] = new TextDecoder().decode(decompressed);
        } catch (e) {
          console.error(`Failed to decompress ${fileName}:`, e);
        }
      }
    }

    offset = dataStart + compSize;
  }

  return files;
}

async function decompressDeflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("raw");
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  writer.write(data).then(() => writer.close());

  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}
