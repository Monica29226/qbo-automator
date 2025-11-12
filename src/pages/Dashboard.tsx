import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, CheckCircle, AlertCircle, Clock, Settings, Database, LogOut, Users, Upload, Eye, Plug, FileSpreadsheet, Mail, RefreshCw, Send, Shield, FileCheck } from "lucide-react";
import { StatsCard } from "@/components/dashboard/StatsCard";
import { RecentDocuments } from "@/components/dashboard/RecentDocuments";
import { ProcessingFlow } from "@/components/dashboard/ProcessingFlow";
import { CronMonitor } from "@/components/dashboard/CronMonitor";
import { MonthSync } from "@/components/dashboard/MonthSync";
import { AICreditsMonitor } from "@/components/dashboard/AICreditsMonitor";
import { QBOAccountsDiagnostic } from "@/components/dashboard/QBOAccountsDiagnostic";
import { ErrorLogsViewer } from "@/components/dashboard/ErrorLogsViewer";
import { OrganizationSwitcher } from "@/components/OrganizationSwitcher";
import { useAuth } from "@/hooks/useAuth";
import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

const Dashboard = () => {
  const { user, isAdmin, activeOrganization, signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [stats, setStats] = useState({
    processed: 0,
    review: 0,
    pending: 0,
    total: 0,
    errors: 0,
    published: 0,
  });
  const [isFetchingEmails, setIsFetchingEmails] = useState(false);
  const [isAutoSyncing, setIsAutoSyncing] = useState(false);
  const [isRetryingErrors, setIsRetryingErrors] = useState(false);
  const [connections, setConnections] = useState({
    gmail: false,
    quickbooks: false,
  });

  useEffect(() => {
    if (activeOrganization) {
      fetchStats();
      fetchConnections();

      // Subscribe to real-time updates for stats
      const channel = supabase
        .channel('dashboard_stats_changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'processed_documents'
          },
          () => {
            console.log('Document changed, updating stats...');
            fetchStats();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [activeOrganization]);

  const fetchStats = async () => {
    if (!activeOrganization) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("processed_documents")
      .select("status, created_at")
      .eq("organization_id", activeOrganization);

    if (!error && data) {
      const todayDocs = data.filter(
        (doc) => new Date(doc.created_at) >= today
      );
      const thisMonth = data.filter(
        (doc) =>
          new Date(doc.created_at).getMonth() === new Date().getMonth()
      );

      setStats({
        processed: todayDocs.filter((d) => d.status === "processed").length,
        review: data.filter((d) => d.status === "review").length,
        pending: data.filter((d) => d.status === "pending").length,
        total: thisMonth.length,
        errors: data.filter((d) => d.status === "error").length,
        published: data.filter((d) => d.status === "published").length,
      });
    }
  };

  const fetchConnections = async () => {
    if (!activeOrganization) return;

    const { data: accounts } = await supabase
      .from("integration_accounts")
      .select("service_type, is_active")
      .eq("organization_id", activeOrganization)
      .eq("is_active", true);

    setConnections({
      gmail: accounts?.some(a => a.service_type === "gmail") || false,
      quickbooks: accounts?.some(a => a.service_type === "quickbooks") || false,
    });
  };

  const handleFetchGmailInvoices = async (month?: number, year?: number) => {
    if (!activeOrganization) return;

    // Check if Gmail is connected first
    const { data: accounts } = await supabase
      .from("integration_accounts")
      .select("id")
      .eq("organization_id", activeOrganization)
      .eq("service_type", "gmail")
      .eq("is_active", true)
      .limit(1);

    if (!accounts || accounts.length === 0) {
      toast.error("Primero debes conectar Gmail desde Integraciones", {
        action: {
          label: "Ir a Integraciones",
          onClick: () => navigate("/integrations"),
        },
      });
      return;
    }

    setIsFetchingEmails(true);
    const dateInfo = month && year ? ` de ${getMonthName(month)} ${year}` : '';
    toast.info(`Buscando facturas${dateInfo} en Gmail...`);

    try {
      const body: any = { organization_id: activeOrganization };
      if (month && year) {
        body.month = month;
        body.year = year;
      }

      const { data, error } = await supabase.functions.invoke("gmail-fetch-invoices", {
        body,
      });

      if (error) throw error;

      const processed = data.invoices_processed || 0;
      const failed = data.invoices_failed || 0;
      const total = data.messages_found || 0;

      if (processed > 0) {
        toast.success(
          `✓ ${processed} factura${processed !== 1 ? 's' : ''} procesada${processed !== 1 ? 's' : ''} de ${total} correos${failed > 0 ? ` (${failed} fallidas)` : ''}`
        );
      } else if (total > 0) {
        toast.warning(`No se encontraron facturas nuevas en ${total} correos`);
      } else {
        toast.info("No se encontraron correos con facturas");
      }

      // Refrescar stats y documentos
      fetchStats();
      queryClient.invalidateQueries({ queryKey: ["recent-documents"] });
    } catch (error) {
      console.error("Error fetching Gmail invoices:", error);
      toast.error("Error al obtener facturas de Gmail");
    } finally {
      setIsFetchingEmails(false);
    }
  };

  const getMonthName = (month: number) => {
    const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return months[month - 1];
  };

  const handleSyncOctober = async () => {
    await handleFetchGmailInvoices(10, 2025);
    
    // Esperar un momento y luego publicar automáticamente a QuickBooks
    setTimeout(async () => {
      toast.info("Publicando facturas de octubre a QuickBooks...");
      await handlePublishToQuickBooks();
    }, 2000);
  };

  const handleSyncNovember = async () => {
    await handleFetchGmailInvoices(11, 2025);
    
    // Esperar un momento y luego publicar automáticamente a QuickBooks
    setTimeout(async () => {
      toast.info("Publicando facturas de noviembre a QuickBooks...");
      await handlePublishToQuickBooks();
    }, 2000);
  };

  const handleAutoSync = async () => {
    if (!activeOrganization) return;

    setIsAutoSyncing(true);
    toast.info("Ejecutando sincronización automática...");

    try {
      const { data, error } = await supabase.functions.invoke("auto-sync-invoices");

      if (error) throw error;

      const result = data.results?.[0];
      if (result) {
        if (result.status === "success") {
          toast.success(
            `✓ Sincronización completa: ${result.gmail_processed} facturas procesadas, ${result.qbo_published} publicadas a QuickBooks`
          );
        } else if (result.status === "no_new_invoices") {
          toast.info("No hay facturas nuevas para procesar");
        } else {
          toast.error(`Error en sincronización: ${result.error}`);
        }
      }

      fetchStats();
      queryClient.invalidateQueries({ queryKey: ["recent-documents"] });
    } catch (error) {
      console.error("Error in auto-sync:", error);
      toast.error("Error al ejecutar sincronización automática");
    } finally {
      setIsAutoSyncing(false);
    }
  };

  const handleForceResync = async () => {
    if (!activeOrganization) return;
    
    setIsFetchingEmails(true);
    toast.info("Forzando resincronización de facturas de hoy...");
    
    try {
      const today = new Date();
      const { data, error } = await supabase.functions.invoke("gmail-fetch-invoices", {
        body: { 
          organization_id: activeOrganization,
          month: today.getMonth() + 1,
          year: today.getFullYear(),
          force_resync: true,
        },
      });
      
      if (error) throw error;
      
      const processed = data.invoices_processed || 0;
      const failed = data.invoices_failed || 0;
      
      toast.success(`✓ ${processed} facturas reprocesadas${failed > 0 ? ` (${failed} fallidas)` : ''}`);
      
      fetchStats();
      queryClient.invalidateQueries({ queryKey: ["recent-documents"] });
    } catch (error: any) {
      console.error("Error in force resync:", error);
      toast.error(`Error al forzar sincronización: ${error.message}`);
    } finally {
      setIsFetchingEmails(false);
    }
  };

  const handlePublishToQuickBooks = async () => {
    if (!activeOrganization) return;

    // Check if QuickBooks is connected first
    const { data: accounts } = await supabase
      .from("integration_accounts")
      .select("id")
      .eq("organization_id", activeOrganization)
      .eq("service_type", "quickbooks")
      .eq("is_active", true)
      .limit(1);

    if (!accounts || accounts.length === 0) {
      toast.error("Primero debes conectar QuickBooks desde Integraciones", {
        action: {
          label: "Ir a Integraciones",
          onClick: () => navigate("/integrations"),
        },
      });
      return;
    }

    setIsFetchingEmails(true);
    toast.info("Publicando facturas a QuickBooks...");

    try {
      const { data, error } = await supabase.functions.invoke("publish-to-quickbooks", {
        body: { organization_id: activeOrganization },
      });

      if (error) throw error;

      const published = data.published || 0;
      const failed = data.failed || 0;

      if (published > 0) {
        toast.success(
          `✓ ${published} factura${published !== 1 ? 's' : ''} publicada${published !== 1 ? 's' : ''} en QuickBooks${failed > 0 ? ` (${failed} fallidas)` : ''}`
        );
      } else if (failed > 0) {
        toast.error(`No se pudo publicar ninguna factura (${failed} errores)`);
      } else {
        toast.info("No hay facturas pendientes para publicar");
      }

      // Refrescar stats y documentos
      fetchStats();
      queryClient.invalidateQueries({ queryKey: ["recent-documents"] });
    } catch (error) {
      console.error("Error publishing to QuickBooks:", error);
      toast.error("Error al publicar en QuickBooks");
    } finally {
      setIsFetchingEmails(false);
    }
  };

  const handleRetryAllErrors = async () => {
    if (!activeOrganization) return;

    setIsRetryingErrors(true);
    toast.info("Reintentando facturas con errores...");

    try {
      const { data, error } = await supabase.functions.invoke("retry-error-documents", {
        body: { organization_id: activeOrganization },
      });

      if (error) throw error;

      const fixed = data.fixed || 0;
      const published = data.published || 0;
      const failed = data.failed || 0;
      const skipped = data.skipped || 0;

      if (fixed > 0 || published > 0) {
        toast.success(
          `✓ ${fixed} corregidas, ${published} publicadas a QuickBooks${failed > 0 ? `, ${failed} fallidas` : ''}${skipped > 0 ? `, ${skipped} omitidas` : ''}`
        );
      } else if (failed > 0) {
        toast.error(`No se pudo reintentar ninguna factura (${failed} errores)`);
      } else {
        toast.info("No hay facturas con errores para reintentar");
      }

      // Refrescar stats y documentos
      fetchStats();
      queryClient.invalidateQueries({ queryKey: ["recent-documents"] });
    } catch (error) {
      console.error("Error retrying error documents:", error);
      toast.error("Error al reintentar facturas con errores");
    } finally {
      setIsRetryingErrors(false);
    }
  };

  if (!activeOrganization) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-muted-foreground">Cargando organización...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
              <FileText className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">FacturaFlow CR</h1>
              <p className="text-xs text-muted-foreground">Automatización de Facturas → QuickBooks</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <OrganizationSwitcher />
            <Button variant="outline" size="sm" asChild>
              <Link to="/upload">
                <Upload className="h-4 w-4 mr-2" />
                Cargar XML
              </Link>
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => handleFetchGmailInvoices()}
              disabled={isFetchingEmails}
            >
              {isFetchingEmails ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Obteniendo...
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4 mr-2" />
                  Obtener de Gmail
                </>
              )}
            </Button>
            <Button 
              variant="default" 
              size="sm" 
              onClick={handlePublishToQuickBooks}
              disabled={isFetchingEmails}
            >
              {isFetchingEmails ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Publicando...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Publicar a QuickBooks
                </>
              )}
            </Button>
            {stats.errors > 0 && (
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={handleRetryAllErrors}
                disabled={isRetryingErrors}
                className="bg-red-600 hover:bg-red-700"
              >
                {isRetryingErrors ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Reintentando...
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-4 w-4 mr-2" />
                    Reintentar Errores ({stats.errors})
                  </>
                )}
              </Button>
            )}
            {isAdmin && stats.errors > 0 && (
              <ErrorLogsViewer />
            )}
            {isAdmin && (
              <QBOAccountsDiagnostic />
            )}
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={handleAutoSync}
              disabled={isAutoSyncing}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {isAutoSyncing ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Sincronizando...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Sincronizar Ahora
                </>
              )}
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleForceResync}
              disabled={isFetchingEmails}
              className="border-orange-500 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950"
            >
              {isFetchingEmails ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Reprocesando...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Forzar Resincronización Hoy
                </>
              )}
            </Button>
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={handleSyncOctober}
              disabled={isFetchingEmails}
            >
              {isFetchingEmails ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Procesando...
                </>
              ) : (
                <>
                  <Clock className="h-4 w-4 mr-2" />
                  Sincronizar Octubre
                </>
              )}
            </Button>
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={handleSyncNovember}
              disabled={isFetchingEmails}
            >
              {isFetchingEmails ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Procesando...
                </>
              ) : (
                <>
                  <Clock className="h-4 w-4 mr-2" />
                  Sincronizar Noviembre
                </>
              )}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/review-queue">
                <Eye className="h-4 w-4 mr-2" />
                Revisión ({stats.review})
              </Link>
            </Button>
            {isAdmin && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/integrations">
                  <Plug className="h-4 w-4 mr-2" />
                  Integraciones
                </Link>
              </Button>
            )}
            {isAdmin && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/vendors">
                  <Users className="h-4 w-4 mr-2" />
                  Proveedores
                </Link>
              </Button>
            )}
            {isAdmin && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/settings">
                  <Settings className="h-4 w-4 mr-2" />
                  Configuración
                </Link>
              </Button>
            )}
            {isAdmin && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/organization">
                  <Database className="h-4 w-4 mr-2" />
                  Empresa
                </Link>
              </Button>
            )}
            {isAdmin && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/vendor-rules">
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Reglas Proveedores
                </Link>
              </Button>
            )}
            {isAdmin && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/validation-rules">
                  <Shield className="h-4 w-4 mr-2" />
                  Validaciones
                </Link>
              </Button>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link to="/audit-report">
                <FileCheck className="h-4 w-4 mr-2" />
                Reporte Auditoría
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Salir
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <AICreditsMonitor organizationId={activeOrganization} />
        
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-foreground mb-2">Panel de Control</h2>
              <p className="text-muted-foreground">Monitoreo en tiempo real del procesamiento de facturas</p>
            </div>
            <Badge variant="default" className="h-fit">
              <Clock className="h-3 w-3 mr-1" />
              Sincronización Automática Activa (cada 30 min)
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatsCard
            title="Procesadas Hoy"
            value={stats.processed.toString()}
            change="+12%"
            icon={CheckCircle}
            variant="success"
          />
          <StatsCard
            title="En Revisión"
            value={stats.review.toString()}
            change="-2"
            icon={AlertCircle}
            variant="warning"
          />
          <Link to="/error-documents" className="block">
            <StatsCard
              title="Con Error"
              value={stats.errors.toString()}
              change="+3"
              icon={AlertCircle}
              variant="warning"
            />
          </Link>
          <Link to="/published-documents" className="block">
            <StatsCard
              title="Publicadas"
              value={stats.published.toString()}
              change="+QB"
              icon={CheckCircle}
              variant="default"
            />
          </Link>
          <StatsCard
            title="Pendientes"
            value={stats.pending.toString()}
            change="+5"
            icon={Clock}
            variant="default"
          />
          <StatsCard
            title="Total Mes"
            value={stats.total.toString()}
            change="+18%"
            icon={FileText}
            variant="primary"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <Card className="lg:col-span-2 p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Documentos Recientes
            </h3>
            <RecentDocuments />
          </Card>

          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              Conexiones
            </h3>
            <div className="space-y-4">
              <ConnectionStatus 
                service="Gmail" 
                status={connections.gmail ? "connected" : "disconnected"} 
                onClick={() => navigate("/integrations")}
              />
              <ConnectionStatus 
                service="QuickBooks Online" 
                status={connections.quickbooks ? "connected" : "disconnected"}
                onClick={() => navigate("/integrations")}
              />
              <ConnectionStatus 
                service="SharePoint" 
                status="disconnected"
                onClick={() => navigate("/integrations")}
              />
            </div>
          </Card>
        </div>

        <CronMonitor />

        <div className="mb-8">
          <MonthSync />
        </div>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Flujo de Procesamiento
            </h3>
            <Button variant="outline" size="sm" asChild>
              <Link to="/vendor-rules">
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Gestionar Reglas
              </Link>
            </Button>
          </div>
          <ProcessingFlow />
        </Card>
      </main>
    </div>
  );
};

const ConnectionStatus = ({ 
  service, 
  status, 
  onClick 
}: { 
  service: string; 
  status: "connected" | "disconnected";
  onClick?: () => void;
}) => {
  return (
    <button 
      className="w-full flex items-center justify-between p-3 rounded-lg border bg-muted/30 hover:bg-muted/50 hover:border-primary cursor-pointer transition-all"
      onClick={onClick}
      type="button"
    >
      <span className="text-sm font-medium">{service}</span>
      <Badge variant={status === "connected" ? "default" : "secondary"} className="text-xs">
        {status === "connected" ? "Conectado" : "Desconectado"}
      </Badge>
    </button>
  );
};

export default Dashboard;
