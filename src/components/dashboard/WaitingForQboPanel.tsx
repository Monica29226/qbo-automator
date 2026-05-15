import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface Props {
  organizationId: string | null;
}

export default function WaitingForQboPanel({ organizationId }: Props) {
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["waiting-for-qbo", organizationId],
    enabled: !!organizationId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("processed_documents")
        .select("id, total_amount, currency, updated_at")
        .eq("organization_id", organizationId!)
        .eq("status", "waiting_for_qbo");
      if (error) throw error;
      const count = data?.length || 0;
      const total = (data || []).reduce((s, d: any) => s + Number(d.total_amount || 0), 0);
      const oldest = (data || [])
        .map((d: any) => new Date(d.updated_at).getTime())
        .sort((a, b) => a - b)[0];
      return { count, total, oldestMs: oldest };
    },
  });

  if (!organizationId || isLoading || !data || data.count === 0) return null;

  const handleRetry = async () => {
    if (!organizationId) return;
    setRetrying(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("retry-qbo-waiting", {
        body: { organization_id: organizationId },
      });
      if (error) throw error;
      const orgSummary = res?.summary?.[0];
      if (orgSummary?.qbo_ok) {
        toast.success(`QBO disponible. Se reenviaron ${orgSummary.retried} factura(s) a publicación.`);
      } else {
        toast.warning(
          `QBO sigue rechazando: ${orgSummary?.probe_error?.substring(0, 120) || "sin detalle"}. ` +
            `Se reintentará automáticamente en el próximo ciclo.`
        );
      }
      queryClient.invalidateQueries({ queryKey: ["waiting-for-qbo", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    } catch (e: any) {
      toast.error(`Error al reintentar: ${e.message || "desconocido"}`);
    } finally {
      setRetrying(false);
    }
  };

  const hoursWaiting = data.oldestMs ? Math.floor((Date.now() - data.oldestMs) / 3_600_000) : 0;
  const isCritical = data.count > 5 && hoursWaiting >= 48;

  return (
    <Card className={isCritical ? "border-destructive/40 bg-destructive/5" : "border-yellow-500/40 bg-yellow-500/5"}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className={`h-5 w-5 ${isCritical ? "text-destructive" : "text-yellow-600 dark:text-yellow-500"}`} />
          Esperando QBO
          <Badge variant={isCritical ? "destructive" : "secondary"}>{data.count}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm text-muted-foreground">
          <div>
            <span className="font-medium text-foreground">{data.count}</span> factura(s) esperando que QBO se desbloquee
            (suscripción suspendida o período cerrado).
          </div>
          <div>
            Monto total: <span className="font-medium text-foreground">₡{data.total.toLocaleString("es-CR", { minimumFractionDigits: 2 })}</span>
            {hoursWaiting > 0 && (
              <>
                {" · "}
                Más antigua: <span className="font-medium text-foreground">{hoursWaiting}h</span>
              </>
            )}
          </div>
          <div className="mt-1 text-xs">
            El sistema reintenta automáticamente cada 6 horas en cuanto QBO responde OK.
          </div>
        </div>
        <Button onClick={handleRetry} disabled={retrying} size="sm" variant={isCritical ? "destructive" : "default"}>
          <RefreshCw className={`h-4 w-4 mr-2 ${retrying ? "animate-spin" : ""}`} />
          {retrying ? "Reintentando..." : "Reintentar ahora"}
        </Button>
      </CardContent>
    </Card>
  );
}
