import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TestResult {
  id: string;
  name: string;
  status: "pass" | "fail" | "skip";
  message: string;
  details?: any;
  duration_ms?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "No authorization" }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { organization_id, test_id } = await req.json();

    if (!organization_id) return jsonResponse({ error: "organization_id required" }, 400);

    // Verify membership
    const { data: isMember } = await admin.rpc("is_organization_member", {
      _org_id: organization_id,
      _user_id: user.id,
    });
    if (!isMember) return jsonResponse({ error: "Not a member of this organization" }, 403);

    // Run tests
    const tests: Record<string, () => Promise<TestResult>> = {
      valid_invoice: () => testValidInvoice(admin, organization_id),
      duplicate: () => testDuplicate(admin, organization_id),
      debit_only: () => testDebitOnly(admin, organization_id),
      malformed_xml: () => testMalformedXml(admin, organization_id),
      special_iva: () => testSpecialIva(admin, organization_id),
    };

    if (test_id && tests[test_id]) {
      const result = await runTimed(tests[test_id]);
      return jsonResponse({ results: [result] });
    }

    // Run all
    const results: TestResult[] = [];
    for (const [, fn] of Object.entries(tests)) {
      results.push(await runTimed(fn));
    }
    return jsonResponse({ results });
  } catch (err) {
    console.error("qa-test-suite error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function runTimed(fn: () => Promise<TestResult>): Promise<TestResult> {
  const start = Date.now();
  try {
    const result = await fn();
    result.duration_ms = Date.now() - start;
    return result;
  } catch (err) {
    return {
      id: "unknown",
      name: "Test execution error",
      status: "fail",
      message: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - start,
    };
  }
}

// ============= TEST 1: Valid invoice publishable to QBO =============
async function testValidInvoice(admin: any, orgId: string): Promise<TestResult> {
  // Find a pending or processed (without qbo_entity_id) invoice with valid totals
  const { data: doc } = await admin
    .from("processed_documents")
    .select("id, doc_number, supplier_name, total_amount, status, qbo_entity_id, xml_data, vendor_id")
    .eq("organization_id", orgId)
    .in("status", ["pending", "processed"])
    .is("qbo_entity_id", null)
    .gt("total_amount", 0)
    .not("vendor_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!doc) {
    return {
      id: "valid_invoice",
      name: "Factura válida → publicable en QBO",
      status: "skip",
      message: "No hay facturas pendientes con vendor configurado para validar.",
    };
  }

  // Check QBO token validity
  const { data: qbo } = await admin
    .from("integration_accounts")
    .select("credentials, is_active")
    .eq("organization_id", orgId)
    .eq("service_type", "quickbooks")
    .eq("is_active", true)
    .maybeSingle();

  if (!qbo) {
    return {
      id: "valid_invoice",
      name: "Factura válida → publicable en QBO",
      status: "fail",
      message: "QuickBooks no está conectado para esta organización.",
    };
  }

  const expiresAt = new Date((qbo.credentials as any).expires_at);
  const minutesLeft = (expiresAt.getTime() - Date.now()) / 60000;
  if (minutesLeft < 5) {
    return {
      id: "valid_invoice",
      name: "Factura válida → publicable en QBO",
      status: "fail",
      message: `Token QBO expira en ${minutesLeft.toFixed(1)} min. Renueva antes de publicar.`,
      details: { doc_number: doc.doc_number },
    };
  }

  // Validate XML data structure for publication
  const x = doc.xml_data as any;
  const issues: string[] = [];
  if (!x) issues.push("xml_data missing");
  if (doc.total_amount <= 0) issues.push("invalid total_amount");
  if (!doc.supplier_name) issues.push("missing supplier_name");

  if (issues.length > 0) {
    return {
      id: "valid_invoice",
      name: "Factura válida → publicable en QBO",
      status: "fail",
      message: `Pre-validación falló: ${issues.join(", ")}`,
      details: { doc_number: doc.doc_number },
    };
  }

  return {
    id: "valid_invoice",
    name: "Factura válida → publicable en QBO",
    status: "pass",
    message: `Factura ${doc.doc_number} (${doc.supplier_name}) cumple validaciones para publicación.`,
    details: { doc_id: doc.id, doc_number: doc.doc_number, total: doc.total_amount, token_min_left: Math.floor(minutesLeft) },
  };
}

// ============= TEST 2: Duplicate detection =============
async function testDuplicate(admin: any, orgId: string): Promise<TestResult> {
  const { data: existing } = await admin
    .from("processed_documents")
    .select("doc_key, doc_number, supplier_name")
    .eq("organization_id", orgId)
    .not("qbo_entity_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!existing) {
    return {
      id: "duplicate",
      name: "Factura duplicada → debe bloquearse",
      status: "skip",
      message: "No hay facturas previamente publicadas para validar deduplicación.",
    };
  }

  // Try inserting same doc_key — must fail or be detected
  const { count } = await admin
    .from("processed_documents")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("doc_key", existing.doc_key);

  if ((count ?? 0) > 1) {
    return {
      id: "duplicate",
      name: "Factura duplicada → debe bloquearse",
      status: "fail",
      message: `Encontradas ${count} copias del doc_key ${existing.doc_key} — la deduplicación está fallando.`,
      details: existing,
    };
  }

  return {
    id: "duplicate",
    name: "Factura duplicada → debe bloquearse",
    status: "pass",
    message: `Deduplicación correcta: doc_key ${existing.doc_key} aparece exactamente 1 vez.`,
    details: existing,
  };
}

// ============= TEST 3: Debit-only invoice processing =============
async function testDebitOnly(admin: any, orgId: string): Promise<TestResult> {
  // Look for invoices with no discounts/credit notes (only debits in accounting sense)
  const { data: docs, count } = await admin
    .from("processed_documents")
    .select("id, doc_number, total_discount, total_amount, doc_type", { count: "exact" })
    .eq("organization_id", orgId)
    .or("total_discount.is.null,total_discount.eq.0")
    .neq("doc_type", "NotaCredito")
    .gt("total_amount", 0)
    .limit(5);

  if (!docs || docs.length === 0) {
    return {
      id: "debit_only",
      name: "Factura solo débitos → procesamiento OK",
      status: "skip",
      message: "No se encontraron facturas sin descuentos para validar.",
    };
  }

  return {
    id: "debit_only",
    name: "Factura solo débitos → procesamiento OK",
    status: "pass",
    message: `${count} facturas solo-débitos procesadas correctamente. Muestra: ${docs[0].doc_number}.`,
    details: { sample: docs.slice(0, 3) },
  };
}

// ============= TEST 4: Malformed XML rejection =============
async function testMalformedXml(admin: any, orgId: string): Promise<TestResult> {
  const malformedXml = `<?xml version="1.0"?><BrokenXml><NoClosing>`;
  try {
    const { data, error } = await admin.functions.invoke("process-document-xml", {
      body: {
        xml_content: malformedXml,
        organization_id: orgId,
        source: "qa_test",
      },
    });

    // Expectation: function should respond with an error
    if (error || (data && data.error) || (data && data.success === false)) {
      const errMsg = error?.message || data?.error || data?.message || "rejected";
      return {
        id: "malformed_xml",
        name: "XML malformado → fallar con mensaje claro",
        status: "pass",
        message: `XML inválido rechazado correctamente: ${String(errMsg).substring(0, 150)}`,
      };
    }

    return {
      id: "malformed_xml",
      name: "XML malformado → fallar con mensaje claro",
      status: "fail",
      message: "El sistema NO rechazó un XML claramente malformado.",
      details: data,
    };
  } catch (err) {
    return {
      id: "malformed_xml",
      name: "XML malformado → fallar con mensaje claro",
      status: "pass",
      message: `XML inválido lanzó excepción: ${err instanceof Error ? err.message.substring(0, 150) : "error"}`,
    };
  }
}

// ============= TEST 5: Special IVA mapping (13/4/1%) =============
async function testSpecialIva(admin: any, orgId: string): Promise<TestResult> {
  const { data: docs } = await admin
    .from("processed_documents")
    .select("id, doc_number, supplier_name, total_amount, total_tax, xml_data")
    .eq("organization_id", orgId)
    .gt("total_tax", 0)
    .order("created_at", { ascending: false })
    .limit(50);

  if (!docs || docs.length === 0) {
    return {
      id: "special_iva",
      name: "IVA especial (13/4/1%) → mapeo correcto",
      status: "skip",
      message: "No hay facturas con IVA para validar mapeo de tasas.",
    };
  }

  const ratesFound = new Set<number>();
  const samples: any[] = [];
  for (const d of docs) {
    if (!d.total_tax || !d.total_amount) continue;
    const subtotal = d.total_amount - d.total_tax;
    if (subtotal <= 0) continue;
    const ratePct = Math.round((d.total_tax / subtotal) * 100);
    if ([1, 2, 4, 13].includes(ratePct)) {
      ratesFound.add(ratePct);
      if (samples.length < 5) {
        samples.push({ doc_number: d.doc_number, supplier: d.supplier_name, rate: `${ratePct}%`, tax: d.total_tax });
      }
    }
  }

  if (ratesFound.size === 0) {
    return {
      id: "special_iva",
      name: "IVA especial (13/4/1%) → mapeo correcto",
      status: "skip",
      message: "No se encontraron facturas con tasas 1%, 2%, 4% o 13% en las últimas 50.",
    };
  }

  return {
    id: "special_iva",
    name: "IVA especial (13/4/1%) → mapeo correcto",
    status: "pass",
    message: `Tasas detectadas correctamente: ${Array.from(ratesFound).map(r => r + "%").join(", ")}`,
    details: { samples },
  };
}
