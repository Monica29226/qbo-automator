import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { FileText, Receipt, AlertTriangle, Clock4 } from "lucide-react";
import { formatCRCCompact, tabularNums } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MonthlyKpisProps {
  organizationId: string | null;
  pendingReviewCount: number;
}

/**
 * KPIs ACL del mes: Facturas, Monto IVA, Por validar, Tiempo ahorrado.
 * Tiempo ahorrado = facturas procesadas × 8 min estimados de digitación.
 */
export function MonthlyKpis({ organizationId, pendingReviewCount }: MonthlyKpisProps) {
  const { data } = useQuery({
    queryKey: ["monthly-kpis", organizationId],
    enabled: !!organizationId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const start = new Date();
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      const startIso = start.toISOString();

      const prevStart = new Date(start);
      prevStart.setMonth(prevStart.getMonth() - 1);
      const prevStartIso = prevStart.toISOString();
      const prevEndIso = start.toISOString();

      const [currMonth, prevMonth] = await Promise.all([
        supabase
          .from("processed_documents")
          .select("total_tax, currency", { count: "exact" })
          .eq("organization_id", organizationId!)
          .gte("issue_date", start.toISOString().slice(0, 10)),
        supabase
          .from("processed_documents")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId!)
          .gte("created_at", prevStartIso)
          .lt("created_at", prevEndIso),
      ]);

      const rows = (currMonth.data ?? []) as Array<{ total_tax: number | null; currency: string | null }>;
      const totalInvoices = currMonth.count ?? rows.length;
      // Sumamos IVA solo de facturas CRC para que la cifra sea consistente con "₡".
      const totalIva = rows
        .filter((r) => (r.currency ?? "CRC") === "CRC")
        .reduce((acc, r) => acc + (Number(r.total_tax) || 0), 0);

      const prevCount = prevMonth.count ?? 0;
      const growth =
        prevCount > 0 ? ((totalInvoices - prevCount) / prevCount) * 100 : null;

      return { totalInvoices, totalIva, growth };
    },
  });

  const totalInvoices = data?.totalInvoices ?? 0;
  const totalIva = data?.totalIva ?? 0;
  const growth = data?.growth ?? null;
  const minutesSaved = totalInvoices * 8;
  const hoursSaved = Math.round(minutesSaved / 60);

  const cards = [
    {
      label: "Facturas del mes",
      value: totalInvoices.toLocaleString("es-CR"),
      hint:
        growth !== null
          ? `${growth >= 0 ? "+" : ""}${growth.toFixed(0)}% vs mes anterior`
          : "Primer mes con datos",
      hintTone: growth !== null && growth >= 0 ? "text-[hsl(var(--success))]" : "text-muted-foreground",
      icon: FileText,
      to: "/all-invoices",
    },
    {
      label: "Monto IVA",
      value: formatCRCCompact(totalIva),
      hint: "Crédito fiscal CRC acumulado",
      hintTone: "text-muted-foreground",
      icon: Receipt,
      to: "/tax-rate-report",
    },
    {
      label: "Por validar",
      value: pendingReviewCount.toLocaleString("es-CR"),
      hint: pendingReviewCount > 0 ? "Requieren revisión" : "Sin pendientes",
      hintTone:
        pendingReviewCount > 0 ? "text-[hsl(var(--warning))]" : "text-[hsl(var(--success))]",
      icon: AlertTriangle,
      to: "/invoices-pending-log",
    },
    {
      label: "Tiempo ahorrado",
      value: `${hoursSaved.toLocaleString("es-CR")}h`,
      hint: "Estimado 8 min por factura",
      hintTone: "text-muted-foreground",
      icon: Clock4,
      to: "/all-invoices",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {cards.map((card) => (
        <Link
          key={card.label}
          to={card.to}
          className="group rounded-xl border bg-card p-5 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
        >
          <div className="flex items-start justify-between mb-3">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {card.label}
            </span>
            <card.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <div className={cn("text-3xl font-heading font-semibold leading-tight", tabularNums)}>
            {card.value}
          </div>
          <p className={cn("text-xs mt-2", card.hintTone)}>{card.hint}</p>
        </Link>
      ))}
    </div>
  );
}
