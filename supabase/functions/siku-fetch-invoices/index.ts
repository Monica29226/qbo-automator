import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface SikuDoc {
  clave?: string;
  consecutivo?: string;
  tipo_documento?: string;
  fecha_emision?: string;
  receptor?: { nombre?: string; identificacion?: string; correo?: string };
  moneda?: string;
  tipo_cambio?: number;
  totales?: {
    total_gravado?: number;
    total_exento?: number;
    total_impuesto?: number;
    total_descuentos?: number;
    total_comprobante?: number;
  };
  xml_url?: string;
  pdf_url?: string;
  lineas?: unknown;
  detalles?: unknown;
}

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function fetchSikuPage(
  baseUrl: string,
  apiKey: string,
  fechaInicio: string,
  fechaFin: string,
  page: number,
): Promise<{ items: SikuDoc[]; hasMore: boolean; status: number; raw: any }> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/v1/documentos-emitidos?fecha_inicio=${encodeURIComponent(fechaInicio)}&fecha_fin=${encodeURIComponent(fechaFin)}&page=${page}&per_page=100`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const status = res.status;
  let raw: any = null;
  try {
    raw = await res.json();
  } catch {
    raw = null;
  }
  if (!res.ok) {
    return { items: [], hasMore: false, status, raw };
  }
  const items: SikuDoc[] = Array.isArray(raw)
    ? raw
    : raw?.data ?? raw?.results ?? raw?.documentos ?? raw?.items ?? [];
  const hasMore = Boolean(
    raw?.has_more ??
      (raw?.next_page != null) ??
      (typeof raw?.total_pages === "number" && page < raw.total_pages) ??
      false,
  );
  return { items, hasMore, status, raw };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const organization_id: string | undefined = body.organization_id;
    let fecha_inicio: string = body.fecha_inicio || todayISO(-30);
    let fecha_fin: string = body.fecha_fin || todayISO(0);

    if (!organization_id) {
      return new Response(
        JSON.stringify({ success: false, error: "organization_id requerido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: integ, error: integErr } = await supabase
      .from("integration_accounts")
      .select("id, credentials, is_active")
      .eq("organization_id", organization_id)
      .eq("service_type", "siku")
      .eq("is_active", true)
      .maybeSingle();

    if (integErr || !integ) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "API key no configurada",
          code: "no_credentials",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const creds = (integ.credentials || {}) as { api_key?: string; base_url?: string };
    const apiKey = creds.api_key;
    const baseUrl = creds.base_url || "https://app.siku.cr";

    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "API key no configurada", code: "no_credentials" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let fetched = 0;
    let inserted = 0;
    let skipped = 0;
    let errors = 0;
    const results: any[] = [];

    let page = 1;
    const MAX_PAGES = 50;

    while (page <= MAX_PAGES) {
      const { items, hasMore, status, raw } = await fetchSikuPage(
        baseUrl,
        apiKey,
        fecha_inicio,
        fecha_fin,
        page,
      );

      if (status === 401) {
        console.error("Siku 401");
        return new Response(
          JSON.stringify({
            success: false,
            error: "API key inválida o vencida",
            code: "unauthorized",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (status === 404) {
        console.error("Siku 404", baseUrl);
        return new Response(
          JSON.stringify({
            success: false,
            error: "Endpoint no encontrado, verificar base_url",
            code: "not_found",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (status < 200 || status >= 300) {
        console.error("Siku error status", status, raw);
        return new Response(
          JSON.stringify({
            success: false,
            error: `Error al consultar Siku (HTTP ${status})`,
            code: "siku_error",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (!items.length) break;
      fetched += items.length;

      // Preload customer_defaults map (lazy: only first iteration)
      const customerNames = Array.from(
        new Set(items.map((d) => d.receptor?.nombre).filter(Boolean) as string[]),
      );

      let defaultsByName = new Map<string, any>();
      if (customerNames.length) {
        const { data: defs } = await supabase
          .from("customer_defaults")
          .select("customer_name, default_income_account_ref, default_class_ref, payment_terms_ref")
          .eq("organization_id", organization_id)
          .in("customer_name", customerNames);
        for (const d of defs || []) {
          defaultsByName.set(d.customer_name, d);
        }
      }

      for (const doc of items) {
        const docKey = doc.clave;
        if (!docKey) {
          errors++;
          continue;
        }

        try {
          const { data: existing } = await supabase
            .from("sales_invoices")
            .select("id")
            .eq("organization_id", organization_id)
            .eq("doc_key", docKey)
            .maybeSingle();

          if (existing) {
            skipped++;
            continue;
          }

          const subtotal =
            n(doc.totales?.total_gravado) + n(doc.totales?.total_exento);
          const totalTax = n(doc.totales?.total_impuesto);
          const totalDiscount = n(doc.totales?.total_descuentos);
          const totalAmount = n(doc.totales?.total_comprobante);
          const customerName = doc.receptor?.nombre ?? "Sin nombre";
          const def = defaultsByName.get(customerName);

          const row: Record<string, unknown> = {
            organization_id,
            doc_key: docKey,
            doc_number: doc.consecutivo ?? docKey.slice(-20),
            doc_type: doc.tipo_documento ?? "01",
            issue_date: doc.fecha_emision ?? todayISO(0),
            customer_name: customerName,
            customer_tax_id: doc.receptor?.identificacion ?? null,
            customer_email: doc.receptor?.correo ?? null,
            currency: doc.moneda ?? "CRC",
            exchange_rate: doc.tipo_cambio ?? 1,
            subtotal,
            total_tax: totalTax,
            total_discount: totalDiscount,
            total_amount: totalAmount,
            xml_attachment_url: doc.xml_url ?? null,
            pdf_attachment_url: doc.pdf_url ?? null,
            xml_data: { lineas: doc.lineas ?? doc.detalles ?? [], source: "siku" },
            status: "pending",
            default_income_account_ref: def?.default_income_account_ref ?? null,
            default_class_ref: def?.default_class_ref ?? null,
            payment_terms_ref: def?.payment_terms_ref ?? null,
          };

          const { error: insErr } = await supabase
            .from("sales_invoices")
            .insert(row);

          if (insErr) {
            console.error("Insert error", docKey, insErr.message);
            errors++;
            results.push({ doc_key: docKey, ok: false, error: insErr.message });
          } else {
            inserted++;
            results.push({ doc_key: docKey, ok: true });
          }
        } catch (e) {
          console.error("Processing doc error", docKey, e);
          errors++;
        }
      }

      if (!hasMore) break;
      page++;
    }

    return new Response(
      JSON.stringify({
        success: true,
        fetched,
        inserted,
        skipped,
        errors,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("siku-fetch-invoices error", e);
    return new Response(
      JSON.stringify({ success: false, error: "Error interno", code: "internal" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
