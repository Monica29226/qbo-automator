import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, ExternalLink, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface AlertRow {
  id: string;
  organization_id: string;
  alert_type: "critical" | "warning" | "info";
  sent_at: string;
  resolved: boolean;
  issues_data: {
    code?: string;
    title?: string;
    description?: string;
    action?: string;
    action_link?: string;
    severity?: string;
  } | null;
}

interface Props {
  organizationId: string | null;
}

const severityIcon = (sev: string) => {
  if (sev === "critical") return <AlertCircle className="h-5 w-5 text-destructive" />;
  if (sev === "warning") return <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-500" />;
  return <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />;
};

const severityRing = (sev: string) => {
  if (sev === "critical") return "border-destructive/40 bg-destructive/5";
  if (sev === "warning") return "border-yellow-500/40 bg-yellow-500/5";
  return "border-blue-500/40 bg-blue-500/5";
};

export const SystemAlertsPanel = ({ organizationId }: Props) => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [resolving, setResolving] = useState<string | null>(null);

  const queryKey = ["system-alerts", organizationId];

  const { data: alerts = [], isLoading } = useQuery({
    queryKey,
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alert_history")
        .select("id, organization_id, alert_type, sent_at, resolved, issues_data")
        .eq("organization_id", organizationId!)
        .eq("resolved", false)
        .order("sent_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as AlertRow[];
    },
    refetchInterval: 60_000,
  });

  // Realtime
  useEffect(() => {
    if (!organizationId) return;
    const channel = supabase
      .channel(`alert-history-${organizationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alert_history", filter: `organization_id=eq.${organizationId}` },
        () => qc.invalidateQueries({ queryKey })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, qc]);

  const sorted = useMemo(() => {
    const order = { critical: 0, warning: 1, info: 2 } as const;
    return [...alerts].sort(
      (a, b) =>
        (order[a.alert_type] ?? 3) - (order[b.alert_type] ?? 3) ||
        new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime()
    );
  }, [alerts]);

  const handleResolve = async (id: string) => {
    setResolving(id);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("alert_history")
        .update({
          resolved: true,
          resolved_at: new Date().toISOString(),
          resolved_by: userData.user?.id ?? null,
        })
        .eq("id", id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey });
      toast.success("Alerta marcada como resuelta");
    } catch (e: any) {
      toast.error(`No se pudo resolver: ${e.message}`);
    } finally {
      setResolving(null);
    }
  };

  const handleAction = (link?: string) => {
    if (!link) return;
    if (link.startsWith("/")) navigate(link);
    else window.open(link, "_blank");
  };

  if (!organizationId) return null;

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <AlertCircle className="h-5 w-5 text-destructive" />
          Alertas del Sistema
          {sorted.length > 0 && (
            <Badge variant="destructive" className="ml-1">
              {sorted.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="animate-pulse h-16 bg-muted rounded-md" />
        ) : sorted.length === 0 ? (
          <div className="flex items-center gap-3 p-4 rounded-md bg-green-500/5 border border-green-500/30">
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            <p className="text-sm font-medium">Sistema saludable — todo funcionando correctamente</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sorted.map((a) => {
              const sev = a.alert_type;
              const data = a.issues_data || {};
              return (
                <div
                  key={a.id}
                  className={`flex items-start gap-3 p-4 rounded-md border ${severityRing(sev)}`}
                >
                  <div className="mt-0.5">{severityIcon(sev)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <h4 className="font-semibold text-sm">{data.title || "Alerta"}</h4>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(a.sent_at), { addSuffix: true, locale: es })}
                      </span>
                    </div>
                    {data.description && (
                      <p className="text-sm text-muted-foreground mt-1">{data.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      {data.action_link && data.action && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAction(data.action_link)}
                        >
                          <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                          {data.action}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={resolving === a.id}
                        onClick={() => handleResolve(a.id)}
                      >
                        <Check className="h-3.5 w-3.5 mr-1.5" />
                        Marcar como resuelta
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
