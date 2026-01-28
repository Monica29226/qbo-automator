import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TaxRateInvoice {
  id: string;
  doc_number: string;
  doc_key: string;
  supplier_name: string;
  supplier_tax_id: string | null;
  issue_date: string;
  total_amount: number;
  total_tax: number | null;
  total_discount: number | null;
  currency: string;
  exchange_rate: number | null;
  qbo_entity_id: string | null;
  processed_at: string | null;
  xml_data: any;
}

export interface TaxRateSummary {
  taxRate: number;
  taxRateLabel: string;
  invoices: TaxRateInvoice[];
  totalSubtotal: number;
  totalTax: number;
  totalAmount: number;
  count: number;
}

// Función para extraer la tasa de impuesto del XML
const extractTaxRate = (xmlData: any): number => {
  if (!xmlData) return 0;
  
  // Buscar en detalles/líneas
  const detalles = xmlData?.detalles || xmlData?.DetalleServicio?.LineaDetalle || [];
  const lines = Array.isArray(detalles) ? detalles : [detalles];
  
  for (const line of lines) {
    // Formato GTI
    if (line?.impuesto?.tarifa) {
      return parseFloat(line.impuesto.tarifa) || 0;
    }
    // Formato estándar Hacienda
    if (line?.Impuesto?.Tarifa) {
      return parseFloat(line.Impuesto.Tarifa) || 0;
    }
    // Array de impuestos
    if (Array.isArray(line?.Impuesto)) {
      for (const imp of line.Impuesto) {
        if (imp?.Tarifa) return parseFloat(imp.Tarifa) || 0;
      }
    }
  }
  
  // Buscar en resumen de impuestos
  const resumenImpuesto = xmlData?.ResumenFactura?.TotalImpuesto;
  if (resumenImpuesto) {
    const impuestos = Array.isArray(resumenImpuesto) ? resumenImpuesto : [resumenImpuesto];
    for (const imp of impuestos) {
      if (imp?.Tarifa) return parseFloat(imp.Tarifa) || 0;
    }
  }
  
  return 0;
};

// Función para calcular subtotal
const calculateSubtotal = (invoice: TaxRateInvoice): number => {
  const tax = invoice.total_tax || 0;
  const discount = invoice.total_discount || 0;
  return invoice.total_amount - tax + discount;
};

export const useTaxRateReport = (
  organizationId: string | null,
  startDate: string | null,
  endDate: string | null
) => {
  return useQuery({
    queryKey: ["tax-rate-report", organizationId, startDate, endDate],
    queryFn: async (): Promise<TaxRateSummary[]> => {
      if (!organizationId) return [];

      let query = supabase
        .from("processed_documents")
        .select(`
          id,
          doc_number,
          doc_key,
          supplier_name,
          supplier_tax_id,
          issue_date,
          total_amount,
          total_tax,
          total_discount,
          currency,
          exchange_rate,
          qbo_entity_id,
          processed_at,
          xml_data
        `)
        .eq("organization_id", organizationId)
        .eq("status", "published")
        .not("qbo_entity_id", "is", null)
        .order("issue_date", { ascending: false });

      if (startDate) {
        query = query.gte("issue_date", startDate);
      }
      if (endDate) {
        query = query.lte("issue_date", endDate);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Agrupar por tasa de impuesto
      const taxRateGroups: Record<number, TaxRateInvoice[]> = {};

      for (const doc of data || []) {
        const taxRate = extractTaxRate(doc.xml_data);
        if (!taxRateGroups[taxRate]) {
          taxRateGroups[taxRate] = [];
        }
        taxRateGroups[taxRate].push(doc as TaxRateInvoice);
      }

      // Crear resúmenes
      const summaries: TaxRateSummary[] = Object.entries(taxRateGroups)
        .map(([rate, invoices]) => {
          const taxRate = parseFloat(rate);
          let totalSubtotal = 0;
          let totalTax = 0;
          let totalAmount = 0;

          for (const inv of invoices) {
            totalSubtotal += calculateSubtotal(inv);
            totalTax += inv.total_tax || 0;
            totalAmount += inv.total_amount;
          }

          return {
            taxRate,
            taxRateLabel: taxRate === 0 ? "Exento (0%)" : `IVA ${taxRate}%`,
            invoices,
            totalSubtotal,
            totalTax,
            totalAmount,
            count: invoices.length,
          };
        })
        .sort((a, b) => b.taxRate - a.taxRate); // Mayor a menor

      return summaries;
    },
    enabled: !!organizationId,
  });
};
