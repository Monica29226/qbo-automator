import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Coins } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

interface Props {
  organizationId: string | null;
}

export default function CurrencyMismatchPanel({ organizationId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["currency-mismatch", organizationId],
    enabled: !!organizationId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("processed_documents")
        .select("id, doc_number, supplier_name, currency, total_amount, issue_date")
        .eq("organization_id", organizationId!)
        .eq("status", "currency_mismatch")
        .order("issue_date", { ascending: false })
        .limit(20);
      if (error) throw error;
      const total = (data || []).reduce((s, d: any) => s + Number(d.total_amount || 0), 0);
      return { count: data?.length || 0, total, rows: data || [] };
    },
  });

  if (!organizationId || isLoading || !data || data.count === 0) return null;

  return (
    <Card className="border-yellow-500/40 bg-yellow-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Coins className="h-5 w-5 text-yellow-600 dark:text-yellow-500" />
          Divisa incompatible
          <Badge variant="secondary">{data.count}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="text-muted-foreground">
          {data.count} factura(s) no se pueden publicar porque la moneda no coincide con la divisa base de QuickBooks (multi-currency desactivado).
          Habilita multi-currency en QBO o registra la factura manualmente.
        </div>
        <ul className="text-xs space-y-1 max-h-40 overflow-auto">
          {data.rows.map((r: any) => (
            <li key={r.id} className="flex justify-between gap-3 border-b border-border/40 py-1">
              <span className="truncate">{r.doc_number} · {r.supplier_name}</span>
              <span className="font-medium">{r.currency} {Number(r.total_amount || 0).toLocaleString("es-CR", { minimumFractionDigits: 2 })}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
