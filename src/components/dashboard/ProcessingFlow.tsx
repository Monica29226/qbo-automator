import { cn } from "@/lib/utils";
import { Mail, FileSearch, Database, CheckCircle, ArrowRight, AlertCircle, Activity, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { EmailListModal } from "./EmailListModal";
import { PublishQBOModal } from "./PublishQBOModal";
import { PendingDocumentsList } from "./PendingDocumentsList";

interface StepStats {
  total: number;
  success: number;
  errors: number;
  pending: number;
}

export const ProcessingFlow = () => {
  const { activeOrganization } = useAuth();
  const [stats, setStats] = useState<StepStats>({
    total: 0,
    success: 0,
    errors: 0,
    pending: 0,
  });
  const [connections, setConnections] = useState({
    email: false,
    emailProvider: null as null | "gmail" | "outlook" | "bluehost" | "hostinger",
    emailAccount: null as string | null,
    quickbooks: false,
  });
  const [rulesCount, setRulesCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);

  useEffect(() => {
    if (activeOrganization) {
      fetchFlowData();

      // Subscribe to real-time updates
      const channel = supabase
        .channel('processing_flow_changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'processed_documents',
            filter: `organization_id=eq.${activeOrganization}`
          },
          () => {
            console.log('Processing flow: Document changed, updating stats...');
            fetchFlowData();
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'vendor_categories',
            filter: `organization_id=eq.${activeOrganization}`
          },
          () => {
            console.log('Processing flow: Vendor rules changed, updating stats...');
            fetchFlowData();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [activeOrganization]);

  const fetchFlowData = async () => {
    if (!activeOrganization) return;
    
    setIsLoading(true);

    // Fetch document stats — honest success requires real qbo_entity_id confirmation.
    const { data: docs } = await supabase
      .from("processed_documents")
      .select("status, error_message, created_at, qbo_entity_id")
      .eq("organization_id", activeOrganization)
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    if (docs) {
      // Success = confirmed in QuickBooks (status='published' AND qbo_entity_id present).
      const success = docs.filter(d => d.status === "published" && !!d.qbo_entity_id).length;
      const pending = docs.filter(d => d.status === "pending" || d.status === "processed" || d.status === "waiting_for_qbo").length;
      const review = docs.filter(d => d.status === "review" || d.status === "pending_config").length;
      const errors = docs.filter(d => d.status === "error").length;
      // Documents marked published but missing qbo_entity_id are not real successes — count as errors.
      const fakePublished = docs.filter(d => d.status === "published" && !d.qbo_entity_id).length;
      
      setStats({
        total: docs.length,
        success,
        errors: errors + fakePublished,
        pending: pending + review,
      });
    }

    // Fetch connections — detect active email provider dynamically
    const { data: accounts } = await supabase
      .from("integration_accounts")
      .select("service_type, account_email")
      .eq("organization_id", activeOrganization)
      .eq("is_active", true);

    if (accounts) {
      // Priority order: gmail > outlook > bluehost > hostinger (matches auto-sync-invoices)
      const providerPriority: Array<"gmail" | "outlook" | "bluehost" | "hostinger"> = [
        "gmail", "outlook", "bluehost", "hostinger",
      ];
      let emailProvider: typeof providerPriority[number] | null = null;
      let emailAccount: string | null = null;
      for (const p of providerPriority) {
        const acc = accounts.find(a => a.service_type === p);
        if (acc) {
          emailProvider = p;
          emailAccount = acc.account_email ?? null;
          break;
        }
      }
      setConnections({
        email: emailProvider !== null,
        emailProvider,
        emailAccount,
        quickbooks: accounts.some(a => a.service_type === "quickbooks"),
      });
    }

    // Fetch rules count from vendor_categories
    const { count } = await supabase
      .from("vendor_categories")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", activeOrganization)
      .eq("is_active", true);

    setRulesCount(count || 0);
    setIsLoading(false);
  };

  const providerLabels: Record<string, string> = {
    gmail: "Gmail",
    outlook: "Outlook",
    bluehost: "Email (IMAP)",
    hostinger: "Hostinger (IMAP)",
  };
  const emailDescription = connections.emailProvider
    ? `${providerLabels[connections.emailProvider]}${connections.emailAccount ? ` — ${connections.emailAccount}` : ""}`
    : "Sin proveedor";

  const steps = [
    {
      icon: Mail,
      label: "Recibir Correo",
      description: emailDescription,
      status: connections.email ? "connected" : "disconnected",
      action: "/integrations",
      actionLabel: connections.email ? "Configurado" : "Conectar",
    },
    {
      icon: FileSearch,
      label: "Extraer XML",
      description: "Parser CR v4.x",
      status: stats.total > 0 ? "active" : "idle",
      stats: `${stats.total} docs (7d)`,
    },
    {
      icon: Database,
      label: "Clasificar",
      description: "Catálogo proveedores",
      status: rulesCount > 0 ? "configured" : "needs-setup",
      action: "/vendor-rules",
      actionLabel: `${rulesCount} reglas`,
      stats: stats.errors > 0 ? `⚠ ${stats.errors} errores` : undefined,
    },
    {
      icon: CheckCircle,
      label: "Publicar QBO",
      description: "Bill/VendorCredit",
      status: connections.quickbooks ? "connected" : "disconnected",
      action: "/integrations",
      actionLabel: connections.quickbooks ? "Configurado" : "Conectar",
      stats: `✓ ${stats.success} confirmadas en QuickBooks`,
    },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Activity className="h-6 w-6 animate-pulse text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3 bg-muted rounded-lg">
          <p className="text-xs text-muted-foreground">Total (7 días)</p>
          <p className="text-2xl font-bold">{stats.total}</p>
        </div>
        <div className="p-3 bg-success/10 rounded-lg">
          <p className="text-xs text-muted-foreground">Procesados</p>
          <p className="text-2xl font-bold text-success">{stats.success}</p>
        </div>
        <div className="p-3 bg-warning/10 rounded-lg">
          <p className="text-xs text-muted-foreground">Pendientes</p>
          <p className="text-2xl font-bold text-warning">{stats.pending}</p>
        </div>
        <div className="p-3 bg-destructive/10 rounded-lg">
          <p className="text-xs text-muted-foreground">Errores</p>
          <p className="text-2xl font-bold text-destructive">{stats.errors}</p>
        </div>
      </div>

      {/* Processing Flow */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {steps.map((step, index) => (
          <div key={step.label} className="flex items-center gap-4">
            <div className="flex flex-col items-center gap-3 flex-1">
              <div className="relative">
                <div
                  className={cn(
                    "h-16 w-16 rounded-xl flex items-center justify-center transition-all",
                    step.status === "connected" || step.status === "active" || step.status === "configured"
                      ? "bg-primary text-primary-foreground shadow-lg" 
                      : step.status === "needs-setup"
                      ? "bg-warning/20 text-warning border-2 border-warning"
                      : "bg-muted text-muted-foreground border-2 border-dashed border-border",
                    (step.label === "Recibir Correo" || step.label === "Publicar QBO") && "cursor-pointer hover:scale-105"
                  )}
                  onClick={() => {
                    if (step.label === "Recibir Correo") {
                      setShowEmailModal(true);
                    } else if (step.label === "Publicar QBO") {
                      setShowPublishModal(true);
                    }
                  }}
                >
                  <step.icon className="h-8 w-8" />
                </div>
                {(step.status === "disconnected" || step.status === "needs-setup") && (
                  <div className="absolute -top-1 -right-1 h-5 w-5 bg-destructive rounded-full flex items-center justify-center">
                    <AlertCircle className="h-3 w-3 text-destructive-foreground" />
                  </div>
                )}
              </div>
              <div className="text-center">
                <p className="font-semibold text-sm text-foreground">{step.label}</p>
                <p className="text-xs text-muted-foreground">{step.description}</p>
                {step.stats && (
                  <p className="text-xs font-medium mt-1">{step.stats}</p>
                )}
                {step.action && (
                  <Button 
                    variant={step.status === "disconnected" || step.status === "needs-setup" ? "destructive" : "outline"}
                    size="sm" 
                    className="mt-2 text-xs h-7"
                    asChild
                  >
                    <Link to={step.action}>
                      <Settings className="h-3 w-3 mr-1" />
                      {step.actionLabel}
                    </Link>
                  </Button>
                )}
                {step.label === "Clasificar" && stats.pending > 0 && (
                  <div className="mt-2">
                    <PendingDocumentsList />
                  </div>
                )}
              </div>
            </div>
            {index < steps.length - 1 && (
              <ArrowRight className="h-6 w-6 text-muted-foreground flex-shrink-0 mt-[-30px]" />
            )}
          </div>
        ))}
      </div>

      {/* Warnings */}
      {(!connections.email || !connections.quickbooks || rulesCount === 0) && (
        <div className="p-4 bg-warning/10 border border-warning/30 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-sm text-foreground mb-2">Configuración Incompleta</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                {!connections.email && (
                  <li>• <strong>Sin proveedor de correo conectado</strong> - No se recibirán facturas automáticamente</li>
                )}
                {!connections.quickbooks && (
                  <li>• <strong>QuickBooks no conectado</strong> - No se publicarán facturas</li>
                )}
                {rulesCount === 0 && (
                  <li>• <strong>Sin reglas de clasificación</strong> - Todas las facturas irán a revisión manual</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Email List Modal */}
      <EmailListModal open={showEmailModal} onOpenChange={setShowEmailModal} />
      
      {/* Publish QBO Modal */}
      <PublishQBOModal open={showPublishModal} onOpenChange={setShowPublishModal} />
    </div>
  );
};
