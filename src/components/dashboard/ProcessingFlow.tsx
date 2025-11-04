import { cn } from "@/lib/utils";
import { Mail, FileSearch, Database, CheckCircle, ArrowRight, AlertCircle, Activity, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "react-router-dom";
import { toast } from "sonner";

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
    gmail: false,
    quickbooks: false,
  });
  const [rulesCount, setRulesCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (activeOrganization) {
      fetchFlowData();
    }
  }, [activeOrganization]);

  const fetchFlowData = async () => {
    if (!activeOrganization) return;
    
    setIsLoading(true);

    // Fetch document stats
    const { data: docs } = await supabase
      .from("processed_documents")
      .select("status, error_message, created_at")
      .eq("organization_id", activeOrganization)
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    if (docs) {
      setStats({
        total: docs.length,
        success: docs.filter(d => d.status === "processed").length,
        errors: docs.filter(d => d.error_message).length,
        pending: docs.filter(d => d.status === "pending" || d.status === "review").length,
      });
    }

    // Fetch connections
    const { data: accounts } = await supabase
      .from("integration_accounts")
      .select("service_type")
      .eq("organization_id", activeOrganization)
      .eq("is_active", true);

    if (accounts) {
      setConnections({
        gmail: accounts.some(a => a.service_type === "gmail"),
        quickbooks: accounts.some(a => a.service_type === "quickbooks"),
      });
    }

    // Fetch rules count
    const { count } = await supabase
      .from("vendor_classification_rules")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", activeOrganization)
      .eq("is_active", true);

    setRulesCount(count || 0);
    setIsLoading(false);
  };

  const steps = [
    {
      icon: Mail,
      label: "Recibir Correo",
      description: "Gmail/Outlook",
      status: connections.gmail ? "connected" : "disconnected",
      action: "/integrations",
      actionLabel: connections.gmail ? "Configurado" : "Conectar",
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
      stats: `✓ ${stats.success} exitosos`,
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
                      : "bg-muted text-muted-foreground border-2 border-dashed border-border"
                  )}
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
              </div>
            </div>
            {index < steps.length - 1 && (
              <ArrowRight className="h-6 w-6 text-muted-foreground flex-shrink-0 mt-[-30px]" />
            )}
          </div>
        ))}
      </div>

      {/* Warnings */}
      {(!connections.gmail || !connections.quickbooks || rulesCount === 0) && (
        <div className="p-4 bg-warning/10 border border-warning/30 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-sm text-foreground mb-2">Configuración Incompleta</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                {!connections.gmail && (
                  <li>• <strong>Gmail no conectado</strong> - No se recibirán facturas automáticamente</li>
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
    </div>
  );
};
