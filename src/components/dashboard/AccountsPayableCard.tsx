import { Card } from "@/components/ui/card";
import { Wallet, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { usePaymentStats } from "@/hooks/usePaymentStats";

interface Props {
  organizationId: string | null;
}

const fmt = (v: number, currency: string) =>
  new Intl.NumberFormat("es-CR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(v);

export function AccountsPayableCard({ organizationId }: Props) {
  const { data, isLoading } = usePaymentStats(organizationId);
  const stats = data || { pendingCount: 0, pendingTotalCRC: 0, pendingTotalUSD: 0, overdueCount: 0 };

  return (
    <Link to="/admin-payments/pending" className="block">
      <Card className="p-6 hover:bg-accent/50 transition-colors h-full">
        <div className="flex items-start justify-between mb-3">
          <div className="rounded-md bg-primary/10 p-2">
            <Wallet className="h-5 w-5 text-primary" />
          </div>
          {stats.overdueCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-destructive font-medium">
              <AlertTriangle className="h-3 w-3" />
              {stats.overdueCount} vencidas
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">Cuentas por Pagar</p>
        <p className="text-2xl font-bold">{isLoading ? "…" : stats.pendingCount}</p>
        <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          {stats.pendingTotalCRC > 0 && <div>{fmt(stats.pendingTotalCRC, "CRC")}</div>}
          {stats.pendingTotalUSD > 0 && <div>{fmt(stats.pendingTotalUSD, "USD")}</div>}
          {stats.pendingTotalCRC === 0 && stats.pendingTotalUSD === 0 && (
            <div>Sin facturas pendientes</div>
          )}
        </div>
      </Card>
    </Link>
  );
}
