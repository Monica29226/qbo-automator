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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDashboardStats, useOrganizationConnections } from "@/hooks/useDashboardStats";
import { ImportBatchDialog } from "@/components/dashboard/ImportBatchDialog";
import { SearchInvoiceDialog } from "@/components/dashboard/SearchInvoiceDialog";
import { ReconcileXmlQboButton } from "@/components/dashboard/ReconcileXmlQboButton";
const AuditPublishedVsQBO = lazy(() => import("@/components/dashboard/AuditPublishedVsQBO").then(m => ({ default: m.AuditPublishedVsQBO })));
import { ImportHealthPanel } from "@/components/dashboard/ImportHealthPanel";

// Lazy load componentes pesados
const RecentDocuments = lazy(() => import("@/components/dashboard/RecentDocuments").then(m => ({ default: m.RecentDocuments })));
const CronMonitor = lazy(() => import("@/components/dashboard/CronMonitor").then(m => ({ default: m.CronMonitor })));
import { SyncEmailNowButton } from "@/components/dashboard/SyncEmailNowButton";
import { SyncFromExcelDialog } from "@/components/SyncFromExcelDialog";
import { RecoverBacklogButton } from "@/components/dashboard/RecoverBacklogButton";
import { SystemAlertsPanel } from "@/components/dashboard/SystemAlertsPanel";
import WaitingForQboPanel from "@/components/dashboard/WaitingForQboPanel";
import CurrencyMismatchPanel from "@/components/dashboard/CurrencyMismatchPanel";
import { StabilityScorePanel } from "@/components/dashboard/StabilityScorePanel";
import { SharePointKpiCard } from "@/components/dashboard/SharePointKpiCard";
import { AccountsPayableCard } from "@/components/dashboard/AccountsPayableCard";
import { OnboardingBanner } from "@/components/onboarding/OnboardingBanner";
const AICreditsMonitor = lazy(() => import("@/components/dashboard/AICreditsMonitor").then(m => ({ default: m.AICreditsMonitor })));
const ErrorLogsViewer = lazy(() => import("@/components/dashboard/ErrorLogsViewer").then(m => ({ default: m.ErrorLogsViewer })));
const ErrorDocumentsModal = lazy(() => import("@/components/dashboard/ErrorDocumentsModal").then(m => ({ default: m.ErrorDocumentsModal })));
const TotalsValidationTest = lazy(() => import("@/components/dashboard/TotalsValidationTest").then(m => ({ default: m.TotalsValidationTest })));
const TodayProcessingReport = lazy(() => import("@/components/dashboard/TodayProcessingReport").then(m => ({ default: m.TodayProcessingReport })));
const TokenRenewalMonitor = lazy(() => import("@/components/dashboard/TokenRenewalMonitor").then(m => ({ default: m.TokenRenewalMonitor })));
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

const CEMSAN_ORG_ID = "e06ff1bc-bcfc-4158-a10c-5dbc9c6b0c2f";
const CEMSAN_MARCH_TARGET = 50;
const CEMSAN_MARCH_DOC_NUMBERS = [
  "00100001010000000116", "00100001010000000117", "00200001010011922652", "00290094010104996431", "00100001010000004418",
  "00100001010000034707", "00100001010000000384", "00100001010000000221", "00200001010000328716", "00100001010000005237",
  "00200001010000001563", "00100002010000008579", "15000016010000050491", "00100002010000008586", "00100001010000001182",
  "00100111012600075860", "00100001010000000383", "00100001010000060238", "00100001010000142683", "00100001010000000692",
  "00100001010000001452", "00100001010000142279", "00100001030000016114", "68900209010000000964", "00100001010000000032",
  "00100001010000142177", "00100001010000129471", "00100001010000129872", "00100001010000000198", "00100001010000000005",
  "00100001010043494344", "00100002010000029243", "00100001010000370428", "02400001010000001231", "00100001010000000067",
  "00100001010000000157", "00100001010000000156", "00100001010000008978", "00100001010000000573", "00100001010000000572",
  "02600002010000050397", "00100001010000000381", "00100001010000001454", "00100001010000001451", "00100001010000261136",
  "22300041010000015461", "00100001010000001764", "00100001010000004321", "15000019010000059065", "00100001010000000956",
];

const Dashboard = () => {
  const { user, isAdmin, activeOrganization, signOut, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  // React Query hooks for cached data
  const { data: stats = { processed: 0, review: 0, pending: 0, total: 0, errors: 0, published: 0, pendingConfig: 0 }, isLoading: statsLoading } = useDashboardStats(activeOrganization);
  const { data: connections = { gmail: false, quickbooks: false, outlook: false, hostinger: false, bluehost: false }, isLoading: connectionsLoading } = useOrganizationConnections(activeOrganization);
  const { data: lastSyncAt } = useQuery({
    queryKey: ["dashboard-last-sync", activeOrganization],
    queryFn: async () => {
      if (!activeOrganization) return null;
      const { data } = await supabase
        .from("sync_logs")
        .select("started_at")
        .eq("organization_id", activeOrganization)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.started_at ?? null;
    },
    enabled: !!activeOrganization,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const { data: cemsanMarchCoverage } = useQuery({
    queryKey: ["dashboard-cemsan-march-gap", activeOrganization],
    queryFn: async () => {
      if (activeOrganization !== CEMSAN_ORG_ID) return null;

      const { data, error } = await supabase
        .from("processed_documents")
        .select("doc_number")
        .eq("organization_id", CEMSAN_ORG_ID)
        .gte("issue_date", "2026-03-01")
        .lt("issue_date", "2026-03-25")
        .in("doc_number", CEMSAN_MARCH_DOC_NUMBERS);

      if (error) throw error;

      const importedSet = new Set((data ?? []).map((row) => row.doc_number).filter(Boolean));
      const imported = importedSet.size;
      const missingDocNumbers = CEMSAN_MARCH_DOC_NUMBERS.filter((doc) => !importedSet.has(doc));

      return {
        imported,
        missing: Math.max(0, CEMSAN_MARCH_TARGET - imported),
        missingDocNumbers,
      };
    },
    enabled: !!activeOrganization,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const [isFetchingEmails, setIsFetchingEmails] = useState(false);
  const [isRetryingErrors, setIsRetryingErrors] = useState(false);
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false);

  const lastSyncDate = lastSyncAt ? new Date(lastSyncAt) : null;
  const lastSyncAgeMs = lastSyncDate ? Date.now() - lastSyncDate.getTime() : Number.POSITIVE_INFINITY;
  const isLastSyncFresh = lastSyncAgeMs <= 60 * 60 * 1000;
  const lastSyncLabel = lastSyncDate
    ? lastSyncDate.toLocaleString("es-CR", { dateStyle: "short", timeStyle: "short" })
    : "Sin registros";

  // Helper to refresh data after actions
  const refreshData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    queryClient.invalidateQueries({ queryKey: ["recent-documents"] });
    queryClient.invalidateQueries({ queryKey: ["organization-connections"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-cemsan-march-gap"] });
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
                  <Badge variant={isLastSyncFresh ? "default" : "destructive"} className="h-fit">
                    <Clock className="h-3 w-3 mr-1" />
                    Última sync: {lastSyncLabel}
                  </Badge>
                </div>
              </div>

              <div className="mb-4">
                <OnboardingBanner organizationId={activeOrganization} />
              </div>

              <div className="mb-4">
                <StabilityScorePanel organizationId={activeOrganization} />
              </div>

              {activeOrganization === CEMSAN_ORG_ID && cemsanMarchCoverage && (
                <Card className={`mb-4 border-l-4 ${cemsanMarchCoverage.missing <= 2 ? 'border-l-green-500' : 'border-l-destructive'}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Database className="h-4 w-4" />
                      Control ATV Marzo 2026 (CEMSAN)
                    </CardTitle>
                    <CardDescription>Meta oficial: 50 facturas aceptadas según Hacienda (1–24 marzo)</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="default" className="bg-green-600">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Importadas: {cemsanMarchCoverage.imported}/50
                      </Badge>
                      {cemsanMarchCoverage.missing > 0 ? (
                        <Badge variant="destructive">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          Faltantes: {cemsanMarchCoverage.missing}
                        </Badge>
                      ) : (
                        <Badge variant="default" className="bg-green-600">
                          ✓ Conciliación completa
                        </Badge>
                      )}
                    </div>
                    {cemsanMarchCoverage.missingDocNumbers.length > 0 && (
                      <div className="text-xs text-muted-foreground space-y-1">
                        <p className="font-medium">Consecutivos faltantes (no encontrados en correo):</p>
                        {cemsanMarchCoverage.missingDocNumbers.map(doc => (
                          <span key={doc} className="inline-block bg-muted px-2 py-0.5 rounded mr-1 mb-1 font-mono">{doc}</span>
                        ))}
                        <p className="text-yellow-600 mt-1">⚠ Estas facturas no llegaron al correo facturacion@cemsacr.com. Requieren importación manual vía XML.</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Import Health Panel - first signal of system status */}
            <ImportHealthPanel />

            {/* Quick Actions Section */}
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

                {/* Row 2: Publish + Diagnostic + Reconcile + Error Log */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
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

                  <ReconcileXmlQboButton />

                  <Suspense fallback={<div className="h-10 bg-muted animate-pulse rounded" />}>
                    <ErrorLogsViewer />
                  </Suspense>
                </div>
              </CardContent>
            </Card>

            <Suspense fallback={<LazyFallback />}>
              <AuditPublishedVsQBO />
            </Suspense>



            {/* Alerts after quick actions */}
            <Suspense fallback={<LazyFallback />}>
              <AICreditsMonitor organizationId={activeOrganization} />
            </Suspense>
            <Suspense fallback={null}>
              <MissingTaxIdAlert organizationId={activeOrganization} />
            </Suspense>
            <GmailTokenAlert />
            <QuickBooksTokenAlert />
            <Suspense fallback={null}>
              <TokenRenewalMonitor />
            </Suspense>
        
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
          <SharePointKpiCard organizationId={activeOrganization} />
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

        <SystemAlertsPanel organizationId={activeOrganization} />
        <WaitingForQboPanel organizationId={activeOrganization} />
        <CurrencyMismatchPanel organizationId={activeOrganization} />
        <div className="mb-4 flex justify-end gap-2 flex-wrap">
          <RecoverBacklogButton />
          <SyncEmailNowButton />
          <SyncFromExcelDialog />
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
