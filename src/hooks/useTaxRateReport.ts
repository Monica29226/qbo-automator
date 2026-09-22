import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Fuente única de verdad: public.compras_formato_gti.
 * La función SQL ya calcula la tarifa por línea, convierte a colones con el
 * tipo de cambio del propio XML, excluye tiquetes y documentos no aceptados,
 * y registra las notas de crédito en negativo. No se recalcula nada aquí.
 */
export interface ComprasRow {
  organization_id: string;
  empresa: string;
  cedula_empresa: string | null;
  doc_key: string;
  consecutivo: string | null;
  issue_date: string;
  cedula_emisor: string | null;
  nombre_emisor: string | null;
  tipo: string;
  moneda: string;
  tipo_cambio: number;
  t1: number;
  t2: number;
  t4: number;
  t8: number;
  t13: number;
  iva_total: number;
  base_gravada: number;
  descuento: number;
  otros_cargos: number;
  total_comprobante: number;
  exento: number;
  revisar: boolean;
  status: string | null;
  qbo_entity_id: string | null;
}

/** Porción de un documento que corresponde a una tarifa concreta. */
export interface TaxRateInvoice {
  doc_key: string;
  consecutivo: string | null;
  issue_date: string;
  nombre_emisor: string | null;
  cedula_emisor: string | null;
  tipo: string;
  moneda: string;
  tipo_cambio: number;
  /** Base gravada a ESTA tarifa (para el grupo exento, el monto exento) */
  base: number;
  /** IVA a ESTA tarifa (0 en el grupo exento) */
  iva: number;
  /** Total del comprobante completo, en colones */
  total_comprobante: number;
  qbo_entity_id: string | null;
  revisar: boolean;
}

export interface TaxRateSummary {
  taxRate: number;
  taxRateLabel: string;
  invoices: TaxRateInvoice[];
  /** Base gravada del grupo = IVA / tarifa (exento: suma de la columna exento) */
  totalBase: number;
  /** IVA del grupo = suma de la columna de esa tarifa */
  totalTax: number;
  /** Total del grupo = base + IVA (siempre cuadra) */
  totalAmount: number;
  count: number;
}

export interface TaxRateReport {
  groups: TaxRateSummary[];
  /** Documentos distintos del período (contados una sola vez) */
  documentCount: number;
  totalBase: number;
  totalTax: number;
  totalAmount: number;
}

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** p_hasta es EXCLUSIVO en la función SQL: se suma un día al endDate inclusivo. */
const nextDay = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
};

const RATES: Array<{ pct: number; key: keyof ComprasRow; label: string }> = [
  { pct: 13, key: "t13", label: "IVA 13%" },
  { pct: 8, key: "t8", label: "IVA 8%" },
  { pct: 4, key: "t4", label: "IVA 4%" },
  { pct: 2, key: "t2", label: "IVA 2%" },
  { pct: 1, key: "t1", label: "IVA 1%" },
];

const EMPTY: TaxRateReport = {
  groups: [],
  documentCount: 0,
  totalBase: 0,
  totalTax: 0,
  totalAmount: 0,
};

export const useTaxRateReport = (
  organizationId: string | null,
  startDate: string | null,
  endDate: string | null,
) => {
  return useQuery({
    queryKey: ["tax-rate-report", organizationId, startDate, endDate],
    queryFn: async (): Promise<TaxRateReport> => {
      if (!organizationId || !startDate || !endDate) return EMPTY;

      const PAGE = 1000;
      const rows: ComprasRow[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .rpc("compras_formato_gti", {
            p_desde: startDate,
            p_hasta: nextDay(endDate),
            p_org: organizationId,
            p_solo_publicados: true,
          })
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        const page = (data ?? []) as unknown as ComprasRow[];
        rows.push(...page);
        if (page.length < PAGE) break;
      }

      const docs = rows.map((d) => ({
        ...d,
        t1: num(d.t1),
        t2: num(d.t2),
        t4: num(d.t4),
        t8: num(d.t8),
        t13: num(d.t13),
        iva_total: num(d.iva_total),
        base_gravada: num(d.base_gravada),
        total_comprobante: num(d.total_comprobante),
        exento: num(d.exento),
        tipo_cambio: num(d.tipo_cambio),
      }));

      const base = (d: ComprasRow): Omit<TaxRateInvoice, "base" | "iva"> => ({
        doc_key: d.doc_key,
        consecutivo: d.consecutivo,
        issue_date: d.issue_date,
        nombre_emisor: d.nombre_emisor,
        cedula_emisor: d.cedula_emisor,
        tipo: d.tipo,
        moneda: d.moneda,
        tipo_cambio: d.tipo_cambio,
        total_comprobante: d.total_comprobante,
        qbo_entity_id: d.qbo_entity_id,
        revisar: d.revisar,
      });

      const groups: TaxRateSummary[] = [];

      for (const rate of RATES) {
        const invoices: TaxRateInvoice[] = [];
        let iva = 0;
        for (const d of docs) {
          const monto = num(d[rate.key]);
          if (monto === 0) continue;
          iva += monto;
          invoices.push({
            ...base(d),
            base: r2(monto / (rate.pct / 100)),
            iva: r2(monto),
          });
        }
        if (invoices.length === 0) continue;
        const totalTax = r2(iva);
        const totalBase = r2(totalTax / (rate.pct / 100));
        groups.push({
          taxRate: rate.pct,
          taxRateLabel: rate.label,
          invoices,
          totalBase,
          totalTax,
          totalAmount: r2(totalBase + totalTax),
          count: invoices.length,
        });
      }

      // Grupo exento: base = suma de la columna exento, IVA = 0
      const exentoInvoices: TaxRateInvoice[] = [];
      let exento = 0;
      for (const d of docs) {
        if (d.exento === 0) continue;
        exento += d.exento;
        exentoInvoices.push({ ...base(d), base: r2(d.exento), iva: 0 });
      }
      if (exentoInvoices.length > 0) {
        const totalBase = r2(exento);
        groups.push({
          taxRate: 0,
          taxRateLabel: "Exento",
          invoices: exentoInvoices,
          totalBase,
          totalTax: 0,
          totalAmount: totalBase,
          count: exentoInvoices.length,
        });
      }

      // Mayor a menor tarifa, Exento de último (ya queda al final por construcción)
      groups.sort((a, b) => {
        if (a.taxRate === 0) return 1;
        if (b.taxRate === 0) return -1;
        return b.taxRate - a.taxRate;
      });

      return {
        groups,
        documentCount: new Set(docs.map((d) => d.doc_key)).size,
        totalBase: r2(groups.reduce((acc, g) => acc + g.totalBase, 0)),
        totalTax: r2(groups.reduce((acc, g) => acc + g.totalTax, 0)),
        totalAmount: r2(groups.reduce((acc, g) => acc + g.totalAmount, 0)),
      };
    },
    enabled: !!organizationId && !!startDate && !!endDate,
  });
};
