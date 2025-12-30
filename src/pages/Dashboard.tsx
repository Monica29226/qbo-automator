import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, CheckCircle, AlertCircle, Clock, Upload, Mail, RefreshCw, Send, FileCheck, Building2, Database } from "lucide-react";
import { StatsCard } from "@/components/dashboard/StatsCard";
import { OrganizationSwitcher } from "@/components/OrganizationSwitcher";
import { GmailFetchDialog } from "@/components/GmailFetchDialog";
import { OutlookFetchDialog } from "@/components/OutlookFetchDialog";
import { GmailTokenAlert } from "@/components/dashboard/GmailTokenAlert";
import { QuickBooksTokenAlert } from "@/components/dashboard/QuickBooksTokenAlert";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/useAuth";
import { Link, useNavigate } from "react-router-dom";
import { useState, useCallback, useMemo, lazy, Suspense } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useDashboardStats, useOrganizationConnections } from "@/hooks/useDashboardStats";

// Lazy load componentes pesados para mejorar tiempo de carga inicial
const RecentDocuments = lazy(() => import("@/components/dashboard/RecentDocuments").then(m => ({ default: m.RecentDocuments })));
const CronMonitor = lazy(() => import("@/components/dashboard/CronMonitor").then(m => ({ default: m.CronMonitor })));
const AICreditsMonitor = lazy(() => import("@/components/dashboard/AICreditsMonitor").then(m => ({ default: m.AICreditsMonitor })));
const QBOAccountsDiagnostic = lazy(() => import("@/components/dashboard/QBOAccountsDiagnostic").then(m => ({ default: m.QBOAccountsDiagnostic })));
const ErrorLogsViewer = lazy(() => import("@/components/dashboard/ErrorLogsViewer").then(m => ({ default: m.ErrorLogsViewer })));
const ErrorDocumentsModal = lazy(() => import("@/components/dashboard/ErrorDocumentsModal").then(m => ({ default: m.ErrorDocumentsModal })));
const TotalsValidationTest = lazy(() => import("@/components/dashboard/TotalsValidationTest").then(m => ({ default: m.TotalsValidationTest })));
const TodayProcessingReport = lazy(() => import("@/components/dashboard/TodayProcessingReport").then(m => ({ default: m.TodayProcessingReport })));
const PendingVendorConfiguration = lazy(() => import("@/components/dashboard/PendingVendorConfiguration").then(m => ({ default: m.PendingVendorConfiguration })));
const AutoPublishConfiguredInvoices = lazy(() => import("@/components/dashboard/AutoPublishConfiguredInvoices").then(m => ({ default: m.AutoPublishConfiguredInvoices })));
const VerifyBillButton = lazy(() => import("@/components/dashboard/VerifyBillButton").then(m => ({ default: m.VerifyBillButton })));
const SyncFromExcelDialog = lazy(() => import("@/components/SyncFromExcelDialog").then(m => ({ default: m.SyncFromExcelDialog })));
const TestAutoSyncFlow = lazy(() => import("@/components/dashboard/TestAutoSyncFlow").then(m => ({ default: m.TestAutoSyncFlow })));
const PendingDocumentsLog = lazy(() => import("@/components/dashboard/PendingDocumentsLog").then(m => ({ default: m.PendingDocumentsLog })));
const BatchUploadToDriveButton = lazy(() => import("@/components/dashboard/BatchUploadToDriveButton").then(m => ({ default: m.BatchUploadToDriveButton })));
const CleanIrrecoverableErrorsButton = lazy(() => import("@/components/dashboard/CleanIrrecoverableErrorsButton").then(m => ({ default: m.CleanIrrecoverableErrorsButton })));
const ProcessAllNowButton = lazy(() => import("@/components/dashboard/ProcessAllNowButton").then(m => ({ default: m.ProcessAllNowButton })));
const VendorsWithoutRules = lazy(() => import("@/components/dashboard/VendorsWithoutRules").then(m => ({ default: m.VendorsWithoutRules })));
const ErrorDiagnostic = lazy(() => import("@/components/dashboard/ErrorDiagnostic").then(m => ({ default: m.ErrorDiagnostic })));
const SearchImportInvoice = lazy(() => import("@/components/dashboard/SearchImportInvoice").then(m => ({ default: m.SearchImportInvoice })));
const BatchImportInvoices = lazy(() => import("@/components/dashboard/BatchImportInvoices").then(m => ({ default: m.BatchImportInvoices })));
const PublishOrphanedInvoices = lazy(() => import("@/components/dashboard/PublishOrphanedInvoices").then(m => ({ default: m.PublishOrphanedInvoices })));
const IVAModeIndicator = lazy(() => import("@/components/dashboard/IVAModeIndicator").then(m => ({ default: m.IVAModeIndicator })));
const BatchDownloadMissingPdfs = lazy(() => import("@/components/dashboard/BatchDownloadMissingPdfs").then(m => ({ default: m.BatchDownloadMissingPdfs })));
const QBOConnectionDiagnostic = lazy(() => import("@/components/dashboard/QBOConnectionDiagnostic").then(m => ({ default: m.QBOConnectionDiagnostic })));

// Componente de loading para lazy components
const LazyFallback = () => (
  <div className="animate-pulse bg-muted rounded-lg h-32 w-full" />
);

const Dashboard = () => {
  const { user, isAdmin, activeOrganization, signOut, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  // React Query hooks for cached data
  const { data: stats = { processed: 0, review: 0, pending: 0, total: 0, errors: 0, published: 0, pendingConfig: 0 }, isLoading: statsLoading } = useDashboardStats(activeOrganization);
  const { data: connections = { gmail: false, quickbooks: false, outlook: false }, isLoading: connectionsLoading } = useOrganizationConnections(activeOrganization);
  
  const [isFetchingEmails, setIsFetchingEmails] = useState(false);
  const [isAutoSyncing, setIsAutoSyncing] = useState(false);
  const [isRetryingErrors, setIsRetryingErrors] = useState(false);
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false);

  const getMonthName = useCallback((month: number) => {
    const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return months[month - 1];
  }, []);

  // Memoized connection status check
  const hasRequiredConnections = useMemo(() => ({
    gmail: connections.gmail,
    quickbooks: connections.quickbooks,
    outlook: connections.outlook,
    email: connections.gmail || connections.outlook,
    both: (connections.gmail || connections.outlook) && connections.quickbooks
  }), [connections.gmail, connections.quickbooks, connections.outlook]);
  
  // Helper to refresh data after actions
  const refreshData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    queryClient.invalidateQueries({ queryKey: ["recent-documents"] });
    queryClient.invalidateQueries({ queryKey: ["organization-connections"] });
  }, [queryClient]);

  const handleFetchGmailInvoices = useCallback(async (month?: number, year?: number) => {
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
      refreshData();
    } catch (error) {
      console.error("Error fetching Gmail invoices:", error);
      toast.error("Error al obtener facturas de Gmail");
    } finally {
      setIsFetchingEmails(false);
    }
  }, [activeOrganization, navigate, refreshData, getMonthName]);


  const handleAutoSync = useCallback(async () => {
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

      refreshData();
    } catch (error) {
      console.error("Error in auto-sync:", error);
      toast.error("Error al ejecutar sincronización automática");
    } finally {
      setIsAutoSyncing(false);
    }
  }, [activeOrganization, refreshData]);

  const handleForceResync = useCallback(async () => {
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
      
      refreshData();
    } catch (error: any) {
      console.error("Error in force resync:", error);
      toast.error(`Error al forzar sincronización: ${error.message}`);
    } finally {
      setIsFetchingEmails(false);
    }
  }, [activeOrganization, refreshData]);

  const handlePublishToQuickBooks = useCallback(async () => {
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
      refreshData();
    } catch (error) {
      console.error("Error publishing to QuickBooks:", error);
      toast.error("Error al publicar en QuickBooks");
    } finally {
      setIsFetchingEmails(false);
    }
  }, [activeOrganization, navigate, refreshData]);

  const handleRetryAllErrors = useCallback(async () => {
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
      refreshData();
    } catch (error) {
      console.error("Error retrying error documents:", error);
      toast.error("Error al reintentar facturas con errores");
    } finally {
      setIsRetryingErrors(false);
    }
  }, [activeOrganization, refreshData]);

  // Mostrar loader si auth está cargando o si acabamos de navegar pero no hay org aún
  if (authLoading || (!activeOrganization && !user)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/5 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
          <p className="text-muted-foreground">Cargando empresa...</p>
        </div>
      </div>
    );
  }

  if (!activeOrganization) {
    return (
      <SidebarProvider>
        <div className="min-h-screen flex w-full bg-background">
          <DashboardSidebar 
            isAdmin={isAdmin} 
            reviewCount={0} 
            onSignOut={signOut}
          />
          
          <SidebarInset className="flex-1">
            <header className="sticky top-0 z-10 border-b bg-card shadow-sm">
              <div className="flex h-14 items-center gap-4 px-6">
                <SidebarTrigger className="-ml-2" />
                <div className="flex items-center gap-2 ml-auto">
                  <OrganizationSwitcher />
                </div>
              </div>
            </header>

            <main className="flex-1 overflow-auto p-6">
              <div className="max-w-4xl mx-auto">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Building2 className="h-6 w-6" />
                      Sistema Multi-Empresa
                    </CardTitle>
                    <CardDescription>
                      Selecciona una organización para continuar o crea una nueva
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col gap-4 items-center">
                      <OrganizationSwitcher />
                      <Button variant="outline" onClick={() => navigate("/multi-tenant")} className="w-full">
                        Ver Guía Multi-Empresa
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </main>
          </SidebarInset>
        </div>
      </SidebarProvider>
    );
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <DashboardSidebar 
          isAdmin={isAdmin} 
          reviewCount={stats.pendingConfig} 
          onSignOut={signOut}
        />
        
        <SidebarInset className="flex-1">
          <header className="sticky top-0 z-10 border-b bg-card shadow-sm">
            <div className="flex h-14 items-center gap-4 px-6">
              <SidebarTrigger className="-ml-2" />
              
              <div className="flex items-center gap-2 ml-auto">
                <OrganizationSwitcher />
                <Button variant="outline" size="sm" asChild>
                  <Link to="/upload">
                    <Upload className="h-4 w-4 mr-2" />
                    Cargar XML
                  </Link>
                </Button>
                {hasRequiredConnections.gmail && (
                  <GmailFetchDialog 
                    onSuccess={() => {
                      refreshData();
                    }}
                  />
                )}
                {hasRequiredConnections.outlook && (
                  <OutlookFetchDialog 
                    onSuccess={() => {
                      refreshData();
                    }}
                  />
                )}
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
                  >
                    {isRetryingErrors ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Reintentando...
                      </>
                    ) : (
                      <>
                        <AlertCircle className="h-4 w-4 mr-2" />
                        Reintentar ({stats.errors})
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </header>

          <main className="p-6">
            <Suspense fallback={<LazyFallback />}>
              <AICreditsMonitor organizationId={activeOrganization} />
            </Suspense>
        
            <div className="mb-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-foreground">Panel de Control</h2>
                  <p className="text-sm text-muted-foreground">Monitoreo en tiempo real del procesamiento de facturas</p>
                </div>
                <div className="flex items-center gap-2">
                  <Suspense fallback={null}>
                    <IVAModeIndicator organizationId={activeOrganization} />
                  </Suspense>
                  <Badge variant="default" className="h-fit">
                    <Clock className="h-3 w-3 mr-1" />
                    Sincronización Automática Activa (cada 30 min)
                  </Badge>
                </div>
              </div>
            </div>

            <GmailTokenAlert />
            <QuickBooksTokenAlert />

            {/* Quick Actions Section */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="text-lg">Acciones Rápidas</CardTitle>
                <CardDescription>Gestión y sincronización de facturas</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  {isAdmin && (
                    <Suspense fallback={<div className="h-9 bg-muted animate-pulse rounded" />}>
                      <VerifyBillButton />
                    </Suspense>
                  )}
                  {isAdmin && (
                    <Suspense fallback={<div className="h-9 bg-muted animate-pulse rounded" />}>
                      <QBOConnectionDiagnostic />
                    </Suspense>
                  )}
                  <Button 
                    variant="secondary" 
                    size="sm" 
                    onClick={handleAutoSync}
                    disabled={isAutoSyncing}
                    className="bg-green-600 hover:bg-green-700 text-white w-full"
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
                    className="border-orange-500 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950 w-full"
                  >
                    {isFetchingEmails ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Reprocesando...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Forzar Resync Hoy
                      </>
                    )}
                  </Button>
                  <Suspense fallback={<div className="h-9 bg-muted animate-pulse rounded" />}>
                    <SyncFromExcelDialog />
                  </Suspense>
                  <Suspense fallback={<div className="h-9 bg-muted animate-pulse rounded" />}>
                    <SearchImportInvoice />
                  </Suspense>
                  <Suspense fallback={<div className="h-9 bg-muted animate-pulse rounded" />}>
                    <BatchImportInvoices />
                  </Suspense>
                  <Suspense fallback={<div className="h-9 bg-muted animate-pulse rounded" />}>
                    <PublishOrphanedInvoices />
                  </Suspense>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
                  <Suspense fallback={<div className="h-9 bg-muted animate-pulse rounded" />}>
                    <TestAutoSyncFlow />
                  </Suspense>
                  <Suspense fallback={<div className="h-9 bg-muted animate-pulse rounded" />}>
                    <PendingDocumentsLog />
                  </Suspense>
                  <Suspense fallback={<div className="h-9 bg-muted animate-pulse rounded" />}>
                    <BatchUploadToDriveButton />
                  </Suspense>
                  <Suspense fallback={<div className="h-9 bg-muted animate-pulse rounded" />}>
                    <BatchDownloadMissingPdfs onComplete={refreshData} />
                  </Suspense>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setIsErrorModalOpen(true)}
                    className="w-full"
                  >
                    <AlertCircle className="h-4 w-4 mr-2 text-destructive" />
                    Ver Facturas con Errores
                  </Button>
                  {stats.errors > 0 && (
                    <Suspense fallback={<div className="h-9 bg-muted animate-pulse rounded" />}>
                      <CleanIrrecoverableErrorsButton />
                    </Suspense>
                  )}
                  {isAdmin && stats.errors > 0 && (
                    <Suspense fallback={<div className="h-9 bg-muted animate-pulse rounded" />}>
                      <ErrorLogsViewer />
                    </Suspense>
                  )}
                  {isAdmin && (
                    <Suspense fallback={<div className="h-9 bg-muted animate-pulse rounded" />}>
                      <QBOAccountsDiagnostic />
                    </Suspense>
                  )}
                </div>
              </CardContent>
            </Card>
        
            <div className="mb-6">
              <Suspense fallback={<LazyFallback />}>
                <PendingVendorConfiguration />
              </Suspense>
            </div>
            
            {/* Auto-publish invoices with configured accounts */}
            <Suspense fallback={<LazyFallback />}>
              <AutoPublishConfiguredInvoices />
            </Suspense>
            
            <Suspense fallback={<LazyFallback />}>
              <TodayProcessingReport />
            </Suspense>

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
            onActionClick={() => navigate("/invoices-pending-log")}
            actionLabel="Ver Pendientes"
          />
          <StatsCard
            title="Total (7 días)"
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
            <Suspense fallback={<LazyFallback />}>
              <RecentDocuments />
            </Suspense>
          </Card>

          <Card className="p-6 space-y-4">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              Acciones Rápidas
            </h3>
            
            {(stats.errors > 0 || stats.review > 0) && (
              <div className="space-y-3">
                <Suspense fallback={<div className="h-9 bg-muted animate-pulse rounded" />}>
                  <ProcessAllNowButton />
                </Suspense>
                <p className="text-xs text-muted-foreground text-center">
                  Procesa automáticamente {stats.review} en revisión y {stats.errors} con error
                </p>
              </div>
            )}
            
            <h3 className="text-sm font-semibold mt-6 mb-3">Conexiones</h3>
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

        <div className="mb-8">
          <Suspense fallback={<LazyFallback />}>
            <VendorsWithoutRules />
          </Suspense>
        </div>

        <Suspense fallback={<LazyFallback />}>
          <CronMonitor />
        </Suspense>

        <div className="mb-8">
          <Suspense fallback={<LazyFallback />}>
            <TotalsValidationTest />
          </Suspense>
        </div>

        </main>

        <Suspense fallback={null}>
          <ErrorDocumentsModal
            open={isErrorModalOpen} 
            onOpenChange={setIsErrorModalOpen} 
          />
        </Suspense>
      </SidebarInset>
    </div>
  </SidebarProvider>
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
