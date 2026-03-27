import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  RefreshCw, 
  Mail, 
  Receipt, 
  Clock,
  Activity,
  Loader2,
  RotateCcw
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface ConnectionStatus {
  gmail: { connected: boolean; email: string | null };
  outlook: { connected: boolean; email: string | null };
  quickbooks: { connected: boolean; realmId: string | null };
  googleDrive: { connected: boolean; folderId: string | null };
}

interface SyncInfo {
  lastSync: string | null;
  status: string | null;
  gmailFetched: number;
  qboPublished: number;
  errors: number;
  errorMessage: string | null;
  errorDetail: string | null;
  errorCode: string | null;
}

const SystemStatusPanel = () => {
  const { activeOrganization } = useAuth();
  const [connections, setConnections] = useState<ConnectionStatus | null>(null);
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunningDiagnostic, setIsRunningDiagnostic] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    if (activeOrganization) {
      fetchStatus();
    }
  }, [activeOrganization]);

  const fetchStatus = async () => {
    if (!activeOrganization) return;
    setIsLoading(true);

    try {
      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .select("gmail_connected, gmail_email, outlook_connected, outlook_email, quickbooks_connected, qbo_realm_id, google_drive_connected, google_drive_folder_id")
        .eq("id", activeOrganization)
        .maybeSingle();

      if (orgError) throw orgError;

      if (org) {
        setConnections({
          gmail: { connected: org.gmail_connected || false, email: org.gmail_email },
          outlook: { connected: org.outlook_connected || false, email: org.outlook_email },
          quickbooks: { connected: org.quickbooks_connected || false, realmId: org.qbo_realm_id },
          googleDrive: { connected: org.google_drive_connected || false, folderId: org.google_drive_folder_id }
        });
      }

      const { data: syncLogs, error: syncError } = await supabase
        .from("sync_logs")
        .select("*")
        .eq("organization_id", activeOrganization)
        .order("created_at", { ascending: false })
        .limit(1);

      if (syncError) throw syncError;

      if (syncLogs && syncLogs.length > 0) {
        const lastLog = syncLogs[0] as any;
        setSyncInfo({
          lastSync: lastLog.completed_at || lastLog.started_at,
          status: lastLog.status,
          gmailFetched: lastLog.gmail_fetched || 0,
          qboPublished: lastLog.qbo_published || 0,
          errors: (lastLog.gmail_failed || 0) + (lastLog.qbo_failed || 0),
          errorMessage: lastLog.error_message || null,
          errorDetail: lastLog.error_detail || null,
          errorCode: lastLog.error_code || null,
        });
      } else {
        setSyncInfo(null);
      }
    } catch (error) {
      console.error("Error fetching system status:", error);
      toast.error("Error al cargar estado del sistema");
    } finally {
      setIsLoading(false);
    }
  };

  const handleReconnectOutlook = async () => {
    if (!activeOrganization) return;
    setIsReconnecting(true);
    
    try {
      const { data, error } = await supabase.functions.invoke("outlook-oauth-init", {
        body: { organization_id: activeOrganization },
      });

      if (error || data?.error) throw new Error(data?.error || error?.message);

      if (data?.url) {
        window.open(data.url, "_blank", "width=600,height=700");
        toast.info("Se abrió la ventana de reconexión de Outlook. Completa el proceso y luego actualiza.");
      }
    } catch (error: any) {
      toast.error(`Error al reconectar Outlook: ${error.message}`);
    } finally {
      setIsReconnecting(false);
    }
  };

  const runDiagnostic = async () => {
    if (!activeOrganization) return;
    setIsRunningDiagnostic(true);

    try {
      const results: string[] = [];

      const { data: org } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", activeOrganization)
        .maybeSingle();

      if (!org) {
        results.push("❌ No se encontró la organización");
      } else {
        results.push("✅ Organización encontrada: " + org.name);
        
        if (org.gmail_connected) {
          results.push("✅ Gmail conectado: " + org.gmail_email);
        } else if (org.outlook_connected) {
          results.push("✅ Outlook conectado: " + org.outlook_email);
        } else {
          results.push("⚠️ Sin correo conectado");
        }

        if (org.quickbooks_connected) {
          results.push("✅ QuickBooks conectado");
        } else {
          results.push("⚠️ QuickBooks no conectado");
        }
      }

      const { data: integrations } = await supabase
        .from("integration_accounts")
        .select("service_type, is_active, credentials")
        .eq("organization_id", activeOrganization);

      if (integrations) {
        for (const integration of integrations) {
          const hasCredentials = integration.credentials && 
            Object.keys(integration.credentials as object).length > 0;
          
          if (hasCredentials && integration.is_active) {
            results.push(`✅ ${integration.service_type}: Credenciales válidas`);
          } else if (!integration.is_active) {
            results.push(`⚠️ ${integration.service_type}: Inactivo`);
          } else {
            results.push(`❌ ${integration.service_type}: Sin credenciales`);
          }
        }
      }

      const { data: settings } = await supabase
        .from("system_settings")
        .select("key, value")
        .eq("organization_id", activeOrganization);

      const requiredSettings = ["qbo_company_id", "mail_provider"];
      const settingsMap = settings?.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {} as Record<string, string>) || {};
      
      for (const key of requiredSettings) {
        if (settingsMap[key] && settingsMap[key].trim() !== "") {
          results.push(`✅ Configuración ${key}: ${settingsMap[key]}`);
        } else {
          results.push(`⚠️ Configuración ${key}: No configurado`);
        }
      }

      const { count } = await supabase
        .from("processed_documents")
        .select("id", { count: "exact" })
        .eq("organization_id", activeOrganization)
        .eq("status", "error")
        .limit(1);

      if (count && count > 0) {
        results.push(`⚠️ ${count} documento(s) con error pendientes`);
      } else {
        results.push("✅ Sin documentos con error");
      }

      toast.success(
        <div className="space-y-1">
          <p className="font-semibold">Diagnóstico completado</p>
          {results.map((r, i) => (
            <p key={i} className="text-sm">{r}</p>
          ))}
        </div>,
        { duration: 10000 }
      );
    } catch (error) {
      console.error("Diagnostic error:", error);
      toast.error("Error al ejecutar diagnóstico");
    } finally {
      setIsRunningDiagnostic(false);
    }
  };

  const getStatusBadge = (connected: boolean) => {
    if (connected) {
      return (
        <Badge variant="default" className="bg-green-500/20 text-green-700 border-green-500/30">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Conectado
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="bg-muted text-muted-foreground">
        <XCircle className="h-3 w-3 mr-1" />
        No conectado
      </Badge>
    );
  };

  const getSyncStatusBadge = (status: string | null) => {
    if (!status) return null;
    
    switch (status) {
      case "success":
      case "completed":
        return (
          <Badge variant="default" className="bg-green-500/20 text-green-700 border-green-500/30">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Completado
          </Badge>
        );
      case "error":
      case "failed":
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            Error
          </Badge>
        );
      case "running":
        return (
          <Badge variant="secondary" className="bg-blue-500/20 text-blue-700 border-blue-500/30">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            En proceso
          </Badge>
        );
      case "partial":
        return (
          <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-700 border-yellow-500/30">
            <AlertCircle className="h-3 w-3 mr-1" />
            Parcial
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary">
            <AlertCircle className="h-3 w-3 mr-1" />
            {status}
          </Badge>
        );
    }
  };

  const getErrorDescription = (): string | null => {
    if (!syncInfo) return null;
    if (syncInfo.status !== "error") return null;
    
    if (syncInfo.errorCode === "token_expired") {
      return "Token expirado — reconectar el proveedor de correo";
    }
    if (syncInfo.errorCode === "permissions_error") {
      return "Permisos insuficientes — verificar configuración en Azure/Google";
    }
    if (syncInfo.errorDetail) return syncInfo.errorDetail;
    if (syncInfo.errorMessage) return syncInfo.errorMessage;
    return "Error desconocido durante la sincronización";
  };

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </Card>
    );
  }

  const errorDescription = getErrorDescription();
  const showReconnectButton = syncInfo?.errorCode === "token_expired" && connections?.outlook.connected === false;

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Estado del Sistema</h2>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchStatus}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Actualizar
          </Button>
          <Button 
            size="sm" 
            onClick={runDiagnostic}
            disabled={isRunningDiagnostic}
          >
            {isRunningDiagnostic ? (
              <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Ejecutando...</>
            ) : (
              <><Activity className="h-4 w-4 mr-1" />Diagnóstico</>
            )}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Email Connections */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Conexiones de Correo
          </h3>
          
          <div className="space-y-2">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
              <div>
                <p className="font-medium text-sm">Gmail</p>
                {connections?.gmail.email && (
                  <p className="text-xs text-muted-foreground">{connections.gmail.email}</p>
                )}
              </div>
              {getStatusBadge(connections?.gmail.connected || false)}
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
              <div>
                <p className="font-medium text-sm">Outlook</p>
                {connections?.outlook.email && (
                  <p className="text-xs text-muted-foreground">{connections.outlook.email}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {getStatusBadge(connections?.outlook.connected || false)}
                {showReconnectButton && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleReconnectOutlook}
                    disabled={isReconnecting}
                    className="text-xs border-orange-500/50 text-orange-700 hover:bg-orange-500/10"
                  >
                    {isReconnecting ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <><RotateCcw className="h-3 w-3 mr-1" />Reconectar</>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* QuickBooks & Drive */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Receipt className="h-4 w-4" />
            Integraciones
          </h3>
          
          <div className="space-y-2">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
              <div>
                <p className="font-medium text-sm">QuickBooks</p>
                {connections?.quickbooks.realmId && (
                  <p className="text-xs text-muted-foreground">Realm: {connections.quickbooks.realmId}</p>
                )}
              </div>
              {getStatusBadge(connections?.quickbooks.connected || false)}
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
              <div>
                <p className="font-medium text-sm">Google Drive</p>
                {connections?.googleDrive.folderId && (
                  <p className="text-xs text-muted-foreground truncate max-w-[150px]">
                    Folder: {connections.googleDrive.folderId}
                  </p>
                )}
              </div>
              {getStatusBadge(connections?.googleDrive.connected || false)}
            </div>
          </div>
        </div>
      </div>

      {/* Last Sync Info */}
      <div className="mt-6 pt-4 border-t">
        <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2 mb-3">
          <Clock className="h-4 w-4" />
          Última Sincronización
        </h3>

        {syncInfo ? (
          <div className="p-4 rounded-lg bg-muted/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">
                {syncInfo.lastSync && format(new Date(syncInfo.lastSync), "dd/MM/yyyy HH:mm", { locale: es })}
              </span>
              {getSyncStatusBadge(syncInfo.status)}
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              {syncInfo.lastSync && formatDistanceToNow(new Date(syncInfo.lastSync), { locale: es, addSuffix: true })}
            </p>
            
            {/* Error detail */}
            {errorDescription && (
              <div className="mb-3 p-2 rounded bg-destructive/10 border border-destructive/20">
                <p className="text-xs text-destructive font-medium">{errorDescription}</p>
                {syncInfo.errorCode && (
                  <p className="text-xs text-destructive/70 mt-0.5">Código: {syncInfo.errorCode}</p>
                )}
              </div>
            )}

            <div className="flex gap-4 text-xs">
              <span className="text-muted-foreground">
                📧 Correos: <span className="font-medium text-foreground">{syncInfo.gmailFetched}</span>
              </span>
              <span className="text-muted-foreground">
                📤 Publicados: <span className="font-medium text-foreground">{syncInfo.qboPublished}</span>
              </span>
              {syncInfo.errors > 0 && (
                <span className="text-destructive">
                  ⚠️ Errores: <span className="font-medium">{syncInfo.errors}</span>
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-lg bg-muted/30 text-center">
            <p className="text-sm text-muted-foreground">No hay sincronizaciones registradas</p>
          </div>
        )}
      </div>
    </Card>
  );
};

export default SystemStatusPanel;
