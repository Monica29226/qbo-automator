import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, CheckCircle, AlertCircle, Activity, RefreshCw, Pause, Play } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";

interface SyncLog {
  id: string;
  trigger_type: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  gmail_fetched: number;
  gmail_processed: number;
  gmail_failed: number;
  qbo_published: number;
  qbo_failed: number;
  execution_time_ms: number | null;
  error_message: string | null;
}

export const CronMonitor = () => {
  const { activeOrganization } = useAuth();
  const [lastSync, setLastSync] = useState<SyncLog | null>(null);
  const [recentLogs, setRecentLogs] = useState<SyncLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [cronEnabled, setCronEnabled] = useState(true);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (activeOrganization) {
      fetchSyncLogs();
      fetchCronStatus();
      
      // Suscribirse a cambios en tiempo real
      const channel = supabase
        .channel('sync-logs-changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'sync_logs',
            filter: `organization_id=eq.${activeOrganization}`,
          },
          () => {
            fetchSyncLogs();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [activeOrganization]);

  const fetchSyncLogs = async () => {
    if (!activeOrganization) return;

    setIsLoading(true);

    // Obtener último sync
    const { data: lastLog } = await supabase
      .from("sync_logs")
      .select("*")
      .eq("organization_id", activeOrganization)
      .order("started_at", { ascending: false })
      .limit(1)
      .single();

    if (lastLog) {
      setLastSync(lastLog);
    }

    // Obtener logs recientes
    const { data: logs } = await supabase
      .from("sync_logs")
      .select("*")
      .eq("organization_id", activeOrganization)
      .order("started_at", { ascending: false })
      .limit(5);

    if (logs) {
      setRecentLogs(logs);
    }

    setIsLoading(false);
  };

  const fetchCronStatus = async () => {
    if (!activeOrganization) return;

    const { data } = await supabase
      .from("system_settings")
      .select("value")
      .eq("organization_id", activeOrganization)
      .eq("key", "cron_auto_sync_enabled")
      .maybeSingle();

    if (data) {
      setCronEnabled(data.value === "true");
    } else {
      // Si no existe, está habilitado por defecto
      setCronEnabled(true);
    }
  };

  const handleToggleCron = async () => {
    if (!activeOrganization) return;

    setIsUpdating(true);

    try {
      const newStatus = !cronEnabled;
      const { error } = await supabase
        .from("system_settings")
        .upsert({
          organization_id: activeOrganization,
          key: "cron_auto_sync_enabled",
          value: newStatus.toString(),
          description: "Control de sincronización automática",
        }, {
          onConflict: "organization_id,key"
        });

      if (error) throw error;

      setCronEnabled(newStatus);
      toast.success(
        newStatus 
          ? "Sincronización automática reanudada" 
          : "Sincronización automática pausada"
      );
    } catch (error) {
      console.error("Error toggling cron:", error);
      toast.error("Error al cambiar el estado de la sincronización");
    } finally {
      setIsUpdating(false);
      setShowConfirmDialog(false);
    }
  };

  const getNextSyncTime = () => {
    if (!lastSync?.started_at) return "Calculando...";
    
    const lastSyncDate = new Date(lastSync.started_at);
    const nextSync = new Date(lastSyncDate.getTime() + 30 * 60 * 1000); // +30 minutos
    
    if (nextSync > new Date()) {
      return formatDistanceToNow(nextSync, { locale: es, addSuffix: true });
    }
    
    return "Próximamente";
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-600" />;
      case "running":
        return <RefreshCw className="h-4 w-4 text-blue-600 animate-spin" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive"> = {
      success: "default",
      error: "destructive",
      running: "secondary",
    };
    
    const labels: Record<string, string> = {
      success: "Exitoso",
      error: "Error",
      running: "En curso",
    };

    return (
      <Badge variant={variants[status] || "secondary"}>
        {labels[status] || status}
      </Badge>
    );
  };

  const getTriggerLabel = (trigger: string) => {
    const labels: Record<string, string> = {
      cron: "Automático",
      manual: "Manual",
      button: "Botón",
    };
    return labels[trigger] || trigger;
  };

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-5 w-5 text-primary animate-pulse" />
          <h3 className="text-lg font-semibold">Monitor de Sincronización</h3>
        </div>
        <p className="text-sm text-muted-foreground">Cargando datos...</p>
      </Card>
    );
  }

  return (
    <>
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold">Monitor de Sincronización Automática</h3>
            {!cronEnabled && (
              <Badge variant="secondary" className="ml-2">
                Pausado
              </Badge>
            )}
          </div>
          <Button
            variant={cronEnabled ? "outline" : "default"}
            size="sm"
            onClick={() => setShowConfirmDialog(true)}
            disabled={isUpdating}
          >
            {cronEnabled ? (
              <>
                <Pause className="h-4 w-4 mr-2" />
                Pausar
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Reanudar
              </>
            )}
          </Button>
        </div>

      {/* Estadísticas principales */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="p-4 rounded-lg border bg-muted/30">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs text-muted-foreground font-medium">Última Ejecución</p>
          </div>
          {lastSync ? (
            <>
              <p className="text-lg font-bold">
                {formatDistanceToNow(new Date(lastSync.started_at), { locale: es, addSuffix: true })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {new Date(lastSync.started_at).toLocaleString('es-ES')}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Sin ejecuciones</p>
          )}
        </div>

        <div className="p-4 rounded-lg border bg-muted/30">
          <div className="flex items-center gap-2 mb-2">
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs text-muted-foreground font-medium">Próxima Ejecución</p>
          </div>
          <p className="text-lg font-bold">{getNextSyncTime()}</p>
          <p className="text-xs text-muted-foreground mt-1">Cada 30 minutos</p>
        </div>

        <div className="p-4 rounded-lg border bg-muted/30">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs text-muted-foreground font-medium">Última Sincronización</p>
          </div>
          {lastSync && lastSync.status === "success" ? (
            <>
              <p className="text-lg font-bold">
                {lastSync.gmail_processed} procesadas
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {lastSync.qbo_published} publicadas en QB
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {lastSync?.status === "error" ? "Error" : "Sin datos"}
            </p>
          )}
        </div>
      </div>

      {/* Historial reciente */}
      <div>
        <h4 className="text-sm font-semibold mb-3">Historial Reciente</h4>
        <div className="space-y-2">
          {recentLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No hay registros de sincronización
            </p>
          ) : (
            recentLogs.map((log) => (
              <div
                key={log.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-3 flex-1">
                  {getStatusIcon(log.status)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {getStatusBadge(log.status)}
                      <Badge variant="outline" className="text-xs">
                        {getTriggerLabel(log.trigger_type)}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(log.started_at), { locale: es, addSuffix: true })}
                    </p>
                    {log.error_message && (
                      <p className="text-xs text-destructive mt-1 truncate">
                        {log.error_message}
                      </p>
                    )}
                  </div>
                </div>
                
                {log.status === "success" && (
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <div className="text-right">
                      <p className="font-medium text-foreground">{log.gmail_processed}</p>
                      <p>Procesadas</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-foreground">{log.qbo_published}</p>
                      <p>Publicadas</p>
                    </div>
                    {log.execution_time_ms && (
                      <div className="text-right">
                        <p className="font-medium text-foreground">
                          {(log.execution_time_ms / 1000).toFixed(1)}s
                        </p>
                        <p>Duración</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
      </Card>

      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {cronEnabled ? "¿Pausar sincronización automática?" : "¿Reanudar sincronización automática?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {cronEnabled ? (
                <>
                  La sincronización automática dejará de ejecutarse cada 30 minutos.
                  Las facturas no se procesarán automáticamente hasta que la reanudes.
                </>
              ) : (
                <>
                  La sincronización automática se ejecutará cada 30 minutos nuevamente.
                  Las facturas comenzarán a procesarse automáticamente desde Gmail a QuickBooks.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleToggleCron} disabled={isUpdating}>
              {isUpdating ? "Procesando..." : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
