import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  ExternalLink,
  Check,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface RawAlertRow {
  id: string;
  organization_id: string;
  alert_type: "critical" | "warning" | "info";
  sent_at: string;
  resolved: boolean;
  issues_data: any;
}

interface FlatAlert {
  rowId: string;
  sent_at: string;
  severity: "critical" | "warning" | "info";
  code?: string;
  title: string;
  description?: string;
  action?: string;
  action_link?: string;
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

// `issues_data` can be an array of issues or a single object — normalize.
const flattenAlerts = (rows: RawAlertRow[]): FlatAlert[] => {
  const out: FlatAlert[] = [];
  for (const r of rows) {
    const items = Array.isArray(r.issues_data)
      ? r.issues_data
      : r.issues_data
      ? [r.issues_data]
      : [];
    for (const it of items) {
      const sev = (it?.type as FlatAlert["severity"]) || r.alert_type;
      out.push({
        rowId: r.id,
        sent_at: r.sent_at,
        severity: sev,
        code: it?.code,
        title: it?.title || "Alerta",
        description: it?.description,
        action: it?.action || it?.actionRequired,
        action_link: it?.action_link,
      });
    }
  }
  return out;
};

// Deduplicate by code/title — keep the most recent occurrence.
const dedupAlerts = (alerts: FlatAlert[]): FlatAlert[] => {
  const map = new Map<string, FlatAlert>();
  for (const a of alerts) {
    const key = a.code || a.title;
    const existing = map.get(key);
    if (!existing || new Date(a.sent_at) > new Date(existing.sent_at)) {
      map.set(key, a);
    }
  }
  const order = { critical: 0, warning: 1, info: 2 } as const;
  return [...map.values()].sort(
    (a, b) =>
      (order[a.severity] ?? 3) - (order[b.severity] ?? 3) ||
      new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime()
  );
};

export const SystemAlertsPanel = ({ organizationId }: Props) => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [resolving, setResolving] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const queryKey = ["system-alerts", organizationId];

  const { data: rawAlerts = [], isLoading } = useQuery({
    queryKey,
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alert_history")
        .select("id, organization_id, alert_type, sent_at, resolved, issues_data")
        .eq("organization_id", organizationId!)
        .eq("resolved", false)
        .order("sent_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as RawAlertRow[];
    },
    refetchInterval: 60_000,
  });

  // Real health signals — so the green "all good" state actually reflects
  // QuickBooks connectivity and the document backlog, not merely the absence
  // of rows in alert_history.
  const { data: health, isError: healthError } = useQuery({
    queryKey: ["system-health-signals", organizationId],
    enabled: !!organizationId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const [qboRes, errRes, pendRes] = await Promise.all([
        supabase.rpc("has_active_integration", {
          _org_id: organizationId!,
          _service_type: "quickbooks",
        }),
        supabase
          .from("processed_documents")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId!)
          .eq("status", "error"),
        supabase
          .from("processed_documents")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId!)
          .in("status", ["pending", "review"]),
      ]);
      if (qboRes.error) throw qboRes.error;
      return {
        qboConnected: !!qboRes.data,
        errorCount: errRes.count ?? 0,
        pendingCount: pendRes.count ?? 0,
      };
    },
  });

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

  const alerts = useMemo(() => dedupAlerts(flattenAlerts(rawAlerts)), [rawAlerts]);

  const counts = useMemo(
    () =>
      alerts.reduce(
        (acc, a) => {
          acc[a.severity] = (acc[a.severity] || 0) + 1;
          return acc;
        },
        { critical: 0, warning: 0, info: 0 } as Record<string, number>
      ),
    [alerts]
  );

  const handleResolve = async (rowId: string) => {
    setResolving(rowId);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("alert_history")
        .update({
          resolved: true,
          resolved_at: new Date().toISOString(),
          resolved_by: userData.user?.id ?? null,
        })
        .eq("id", rowId);
      if (error) throw error;
      qc.invalidateQueries({ queryKey });
      toast.success("Alerta marcada como resuelta");
    } catch (e: any) {
      toast.error(`No se pudo resolver: ${e.message}`);
    } finally {
      setResolving(null);
    }
  };

  const handleResolveAll = async () => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("alert_history")
        .update({
          resolved: true,
          resolved_at: new Date().toISOString(),
          resolved_by: userData.user?.id ?? null,
        })
        .eq("organization_id", organizationId!)
        .eq("resolved", false);
      if (error) throw error;
      qc.invalidateQueries({ queryKey });
      toast.success("Todas las alertas marcadas como resueltas");
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
    }
  };

  const handleAction = (link?: string) => {
    if (!link) return;
    if (link.startsWith("/")) navigate(link);
    else window.open(link, "_blank");
  };

  if (!organizationId) return null;

  const total = alerts.length;
  const isCollapsed = total > 5 && !expanded;
  const visible = isCollapsed ? alerts.slice(0, 3) : alerts;

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-lg flex-wrap">
            <AlertCircle className="h-5 w-5 text-destructive" />
            Alertas del Sistema
            {counts.critical > 0 && (
              <Badge variant="destructive">{counts.critical} críticas</Badge>
            )}
            {counts.warning > 0 && (
              <Badge variant="outline" className="border-yellow-500/60 text-yellow-700 dark:text-yellow-400">
                {counts.warning} advertencias
              </Badge>
            )}
            {counts.info > 0 && <Badge variant="outline">{counts.info} info</Badge>}
          </CardTitle>
          {total > 0 && (
            <div className="flex items-center gap-2">
              {total > 5 && (
                <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)}>
                  {expanded ? (
                    <>
                      <ChevronUp className="h-3.5 w-3.5 mr-1" /> Colapsar
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3.5 w-3.5 mr-1" /> Ver todas
                    </>
                  )}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={handleResolveAll}>
                <Check className="h-3.5 w-3.5 mr-1" /> Resolver todas
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="animate-pulse h-16 bg-muted rounded-md" />
        ) : total === 0 ? (
          healthError || !health ? (
            <div className="flex items-center gap-3 p-4 rounded-md bg-muted border">
              <Info className="h-5 w-5 text-muted-foreground" />
              <p className="text-sm">
                No hay alertas registradas. No se pudo verificar el estado de las integraciones.
              </p>
            </div>
          ) : health.qboConnected && health.errorCount === 0 && health.pendingCount === 0 ? (
            <div className="flex items-center gap-3 p-4 rounded-md bg-green-500/5 border border-green-500/30">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              <p className="text-sm font-medium">
                Sistema saludable — QuickBooks conectado, sin errores ni pendientes.
              </p>
            </div>
          ) : (
            <div className="space-y-2 p-4 rounded-md bg-yellow-500/5 border border-yellow-500/30">
              <p className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-500" />
                Sin alertas registradas, pero hay cosas por revisar:
              </p>
              <ul className="text-sm text-muted-foreground space-y-1 pl-6 list-disc">
                {!health.qboConnected && <li>QuickBooks no está conectado.</li>}
                {health.errorCount > 0 && (
                  <li>
                    <button className="underline hover:text-foreground" onClick={() => navigate("/error-documents")}>
                      {health.errorCount} documento(s) con error
                    </button>
                  </li>
                )}
                {health.pendingCount > 0 && (
                  <li>
                    <button className="underline hover:text-foreground" onClick={() => navigate("/invoices-pending-log")}>
                      {health.pendingCount} pendiente(s) sin publicar
                    </button>
                  </li>
                )}
              </ul>
            </div>
          )
        ) : (
          <div className="space-y-3">
            {visible.map((a, idx) => (
              <div
                key={`${a.rowId}-${a.code || idx}`}
                className={`flex items-start gap-3 p-4 rounded-md border ${severityRing(a.severity)}`}
              >
                <div className="mt-0.5">{severityIcon(a.severity)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <h4 className="font-semibold text-sm">{a.title}</h4>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(new Date(a.sent_at), { addSuffix: true, locale: es })}
                    </span>
                  </div>
                  {a.description && (
                    <p className="text-sm text-muted-foreground mt-1">{a.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    {a.action_link && a.action && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAction(a.action_link)}
                      >
                        <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                        {a.action}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={resolving === a.rowId}
                      onClick={() => handleResolve(a.rowId)}
                    >
                      <Check className="h-3.5 w-3.5 mr-1.5" />
                      Marcar como resuelta
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            {isCollapsed && (
              <button
                onClick={() => setExpanded(true)}
                className="w-full text-sm text-muted-foreground hover:text-foreground py-2"
              >
                Ver {total - 3} alertas adicionales...
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
