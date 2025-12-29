import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Clock, 
  CheckCircle, 
  AlertCircle, 
  Activity, 
  RefreshCw, 
  Pause, 
  Play,
  Mail,
  AlertTriangle,
  FileWarning,
  Settings
} from "lucide-react";
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
  const navigate = useNavigate();
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
      case "partial":
        return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-600" />;
      case "running":
        return <RefreshCw className="h-4 w-4 text-blue-600 animate-spin" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      success: "default",
      partial: "outline",
      error: "destructive",
      running: "secondary",
    };
    
    const labels: Record<string, string> = {
      success: "Exitoso",
      partial: "Parcial",
      error: "Error",
      running: "En curso",
    };

    return (
      <Badge 
        variant={variants[status] || "secondary"}
        className={status === "partial" ? "border-yellow-500 text-yellow-600" : ""}
      >
        {labels[status] || status}
      </Badge>
    );
  };

  const getTriggerLabel = (trigger: string) => {
    const labels: Record<string, string> = {
      cron: "Automático",
      manual: "Manual",
      button: "Botón",
      scheduled: "Automático",
    };
    return labels[trigger] || trigger;
  };

  const getFriendlyErrorMessage = (errorMessage: string | null): string | null => {
    if (!errorMessage) return null;
    
    // Extraer el número de facturas con errores si existe
    const match = errorMessage.match(/(\d+) facturas? con errores? reales?/i);
    if (match) {
      return `${match[1]} requieren configuración`;
    }
    
    if (errorMessage.includes('Account not found')) {
      return 'Cuenta QBO no existe';
    }
    if (errorMessage.includes('duplicate')) {
      return 'Duplicado en QBO';
    }
    if (errorMessage.includes('token')) {
      return 'Token expirado';
    }
    
    // Truncar mensajes muy largos
    return errorMessage.length > 40 ? errorMessage.substring(0, 37) + '...' : errorMessage;
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
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold">Monitor de Sincronización</h3>
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

        {/* Resumen de última sincronización - Mejorado */}
        {lastSync && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 bg-muted/50 rounded-lg mb-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">
                {lastSync.gmail_fetched || 0}
              </div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <Mail className="h-3 w-3" />
                Obtenidas
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {lastSync.gmail_processed || 0}
              </div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <CheckCircle className="h-3 w-3" />
                Procesadas
              </div>
            </div>
            <div className="text-center">
              <div className={`text-2xl font-bold ${(lastSync.gmail_failed || 0) > 0 ? 'text-yellow-600' : 'text-muted-foreground'}`}>
                {lastSync.gmail_failed || 0}
              </div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Requieren Atención
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {lastSync.qbo_published || 0}
              </div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <CheckCircle className="h-3 w-3" />
                Publicadas QBO
              </div>
            </div>
          </div>
        )}

        {/* Estadísticas de tiempo */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground font-medium">Última Ejecución</p>
            </div>
            {lastSync ? (
              <p className="text-sm font-medium">
                {formatDistanceToNow(new Date(lastSync.started_at), { locale: es, addSuffix: true })}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Sin ejecuciones</p>
            )}
          </div>

          <div className="p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-2 mb-1">
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground font-medium">Próxima Ejecución</p>
            </div>
            <p className="text-sm font-medium">
              {cronEnabled ? getNextSyncTime() : 'Pausado'}
            </p>
          </div>
        </div>

        {/* Acciones rápidas cuando hay errores */}
        {lastSync && (lastSync.gmail_failed || 0) > 0 && (
          <div className="flex gap-2 flex-wrap mb-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/error-documents')}
              className="text-yellow-600 border-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-950"
            >
              <FileWarning className="h-4 w-4 mr-1" />
              Ver Errores
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/vendors')}
            >
              <Settings className="h-4 w-4 mr-1" />
              Configurar Proveedores
            </Button>
          </div>
        )}

        {/* Historial reciente - Mejorado */}
        <div>
          <h4 className="text-sm font-semibold mb-3">Historial Reciente</h4>
          <div className="space-y-2">
            {recentLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No hay registros de sincronización
              </p>
            ) : (
              recentLogs.filter(log => {
                if (log.status === 'error' && log.error_message) {
                  const patterns = ['Gmail fetch failed', 'FunctionsHttpError', 'Gateway Timeout', '504'];
                  return !patterns.some(p => log.error_message?.includes(p));
                }
                return true;
              }).map((log) => (
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
                      {log.error_message && (
                        <p className="text-xs text-yellow-600 mt-1">
                          {getFriendlyErrorMessage(log.error_message)}
                        </p>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <div className="text-right flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      <span className="font-medium">{log.gmail_fetched || 0}</span>
                      {(log.gmail_failed || 0) > 0 && (
                        <span className="text-yellow-600">
                          ({log.gmail_failed} ⚠)
                        </span>
                      )}
                    </div>
                    {log.execution_time_ms && (
                      <div className="text-right">
                        <span className="font-medium">
                          {(log.execution_time_ms / 1000).toFixed(1)}s
                        </span>
                      </div>
                    )}
                  </div>
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