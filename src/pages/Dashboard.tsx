import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, CheckCircle, AlertCircle, Clock, Settings, Database, LogOut, Users, Upload, Eye, Plug, FileSpreadsheet, Mail, RefreshCw } from "lucide-react";
import { StatsCard } from "@/components/dashboard/StatsCard";
import { RecentDocuments } from "@/components/dashboard/RecentDocuments";
import { ProcessingFlow } from "@/components/dashboard/ProcessingFlow";
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
  });
  const [isFetchingEmails, setIsFetchingEmails] = useState(false);
  const [connections, setConnections] = useState({
    gmail: false,
    quickbooks: false,
  });

  useEffect(() => {
    if (activeOrganization) {
      fetchStats();
      fetchConnections();
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

  const handleFetchGmailInvoices = async () => {
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
    toast.info("Buscando facturas en Gmail...");

    try {
      const { data, error } = await supabase.functions.invoke("gmail-fetch-invoices", {
        body: { organization_id: activeOrganization },
      });

      if (error) throw error;

      toast.success(
        `Se encontraron ${data.invoices_extracted} facturas de ${data.messages_found} correos`
      );

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
              onClick={handleFetchGmailInvoices}
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
                  Reglas
                </Link>
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Salir
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-foreground mb-2">Panel de Control</h2>
          <p className="text-muted-foreground">Monitoreo en tiempo real del procesamiento de facturas</p>
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

        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Flujo de Procesamiento
          </h3>
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
    <div 
      className="flex items-center justify-between p-3 rounded-lg border bg-muted/30 hover:bg-muted/50 cursor-pointer transition-colors"
      onClick={onClick}
    >
      <span className="text-sm font-medium">{service}</span>
      <Badge variant={status === "connected" ? "default" : "secondary"} className="text-xs">
        {status === "connected" ? "Conectado" : "Desconectado"}
      </Badge>
    </div>
  );
};

export default Dashboard;
