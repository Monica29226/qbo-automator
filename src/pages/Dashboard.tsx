import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, CheckCircle, AlertCircle, Clock, RefreshCw, Send, Building2, Database } from "lucide-react";
import { StatsCard } from "@/components/dashboard/StatsCard";
import { OrganizationSwitcher } from "@/components/OrganizationSwitcher";
import { GmailTokenAlert } from "@/components/dashboard/GmailTokenAlert";
import { QuickBooksTokenAlert } from "@/components/dashboard/QuickBooksTokenAlert";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/useAuth";
import { Link, useNavigate } from "react-router-dom";
import { useState, useCallback, lazy, Suspense } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useDashboardStats, useOrganizationConnections } from "@/hooks/useDashboardStats";
import { ImportBatchDialog } from "@/components/dashboard/ImportBatchDialog";
import { SearchInvoiceDialog } from "@/components/dashboard/SearchInvoiceDialog";

// Lazy load componentes pesados
const RecentDocuments = lazy(() => import("@/components/dashboard/RecentDocuments").then(m => ({ default: m.RecentDocuments })));
const CronMonitor = lazy(() => import("@/components/dashboard/CronMonitor").then(m => ({ default: m.CronMonitor })));
const AICreditsMonitor = lazy(() => import("@/components/dashboard/AICreditsMonitor").then(m => ({ default: m.AICreditsMonitor })));
const ErrorLogsViewer = lazy(() => import("@/components/dashboard/ErrorLogsViewer").then(m => ({ default: m.ErrorLogsViewer })));
const ErrorDocumentsModal = lazy(() => import("@/components/dashboard/ErrorDocumentsModal").then(m => ({ default: m.ErrorDocumentsModal })));
const TotalsValidationTest = lazy(() => import("@/components/dashboard/TotalsValidationTest").then(m => ({ default: m.TotalsValidationTest })));
const TodayProcessingReport = lazy(() => import("@/components/dashboard/TodayProcessingReport").then(m => ({ default: m.TodayProcessingReport })));
const PendingVendorConfiguration = lazy(() => import("@/components/dashboard/PendingVendorConfiguration").then(m => ({ default: m.PendingVendorConfiguration })));
const AutoPublishConfiguredInvoices = lazy(() => import("@/components/dashboard/AutoPublishConfiguredInvoices").then(m => ({ default: m.AutoPublishConfiguredInvoices })));
const PendingDocumentsLog = lazy(() => import("@/components/dashboard/PendingDocumentsLog").then(m => ({ default: m.PendingDocumentsLog })));
const VendorsWithoutRules = lazy(() => import("@/components/dashboard/VendorsWithoutRules").then(m => ({ default: m.VendorsWithoutRules })));
const IVAModeIndicator = lazy(() => import("@/components/dashboard/IVAModeIndicator").then(m => ({ default: m.IVAModeIndicator })));
const QBOConnectionDiagnostic = lazy(() => import("@/components/dashboard/QBOConnectionDiagnostic").then(m => ({ default: m.QBOConnectionDiagnostic })));
const MissingTaxIdAlert = lazy(() => import("@/components/dashboard/MissingTaxIdAlert").then(m => ({ default: m.MissingTaxIdAlert })));

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
  const { data: connections = { gmail: false, quickbooks: false, outlook: false, hostinger: false, bluehost: false }, isLoading: connectionsLoading } = useOrganizationConnections(activeOrganization);

  const [isFetchingEmails, setIsFetchingEmails] = useState(false);
  const [isRetryingErrors, setIsRetryingErrors] = useState(false);
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false);

  // Helper to refresh data after actions
  const refreshData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    queryClient.invalidateQueries({ queryKey: ["recent-documents"] });
    queryClient.invalidateQueries({ queryKey: ["organization-connections"] });
  }, [queryClient]);


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

  // Mostrar loader solo mientras auth está cargando (máximo 10 segundos)
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/5 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
          <p className="text-muted-foreground">Cargando...</p>
        </div>
      </div>
    );
  }

  // Si no hay usuario, redirigir a login
  if (!user) {
    navigate("/");
    return null;
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

            {/* Quick Actions Section - FIRST, most visible */}
            <Card className="mb-6">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Acciones Rápidas</CardTitle>
                <CardDescription>Gestión y sincronización de facturas</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Row 1: Import + Search (50/50) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <ImportBatchDialog onSuccess={refreshData} />
                  <SearchInvoiceDialog />
                </div>

                {/* Row 2: Publish + Diagnostic + Error Log */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Button
                    variant="default"
                    className="w-full h-10"
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

                  <Suspense fallback={<div className="h-10 bg-muted animate-pulse rounded" />}>
                    <QBOConnectionDiagnostic />
                  </Suspense>

                  <Suspense fallback={<div className="h-10 bg-muted animate-pulse rounded" />}>
                    <ErrorLogsViewer />
                  </Suspense>
                </div>
              </CardContent>
            </Card>

            {/* Alerts after quick actions */}
            <Suspense fallback={<LazyFallback />}>
              <AICreditsMonitor organizationId={activeOrganization} />
            </Suspense>
            <Suspense fallback={null}>
              <MissingTaxIdAlert organizationId={activeOrganization} />
            </Suspense>
            <GmailTokenAlert />
            <QuickBooksTokenAlert />
        
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
                service="Bluehost" 
                status={connections.bluehost ? "connected" : "disconnected"}
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
