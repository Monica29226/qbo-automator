import { useEffect } from "react";
import { AppHeader } from "@/components/acl/AppHeader";
import { HelpPanel } from "@/components/acl/HelpPanel";
import { ExcelUploader } from "@/components/acl/ExcelUploader";
import { ProcessingLogs } from "@/components/acl/ProcessingLogs";
import { useAppStore } from "@/store/appStore";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Database, FileSearch, Send } from "lucide-react";

const DashboardACL = () => {
  const { user, activeOrganization } = useAuth();
  const { setGmailStatus, setQboStatus, setCompanyId, settings, setSettings, addToLog } = useAppStore();

  useEffect(() => {
    if (activeOrganization) {
      loadConnectionStatus();
      loadCompanyId();
    }
  }, [activeOrganization]);

  const loadConnectionStatus = async () => {
    if (!activeOrganization) return;

    try {
      // Check Gmail
      const { data: gmailData } = await supabase
        .from('integration_accounts')
        .select('account_email, is_active')
        .eq('organization_id', activeOrganization)
        .eq('service_type', 'gmail')
        .maybeSingle();

      if (gmailData) {
        setGmailStatus({
          connected: gmailData.is_active === true,
          accountEmail: gmailData.account_email || ''
        });
      }

      // Check QuickBooks
      const { data: orgData } = await supabase
        .from('organizations')
        .select('quickbooks_connected, qbo_realm_id, qbo_company_id')
        .eq('id', activeOrganization)
        .single();

      if (orgData) {
        setQboStatus({
          connected: orgData.quickbooks_connected || false,
          realmId: orgData.qbo_realm_id || '',
          companyName: orgData.quickbooks_connected ? 'Conectado' : ''
        });
      }
    } catch (error) {
      console.error('Error loading connection status:', error);
    }
  };

  const loadCompanyId = async () => {
    if (!activeOrganization) return;

    try {
      const { data } = await supabase
        .from('system_settings')
        .select('value')
        .eq('organization_id', activeOrganization)
        .eq('key', 'qbo_company_id')
        .single();

      if (data?.value) {
        setCompanyId(data.value);
      }
    } catch (error) {
      console.error('Error loading company ID:', error);
    }
  };

  if (!user || !activeOrganization) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main className="container mx-auto px-6 py-8">
        <HelpPanel />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-2 space-y-6">
            <ExcelUploader />

            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Mail className="h-5 w-5" />
                📧 Filtros de Correo (Gmail)
              </h2>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="query-gmail">Query de búsqueda Gmail</Label>
                  <Input
                    id="query-gmail"
                    value={settings.queryGmail}
                    onChange={(e) => setSettings({ queryGmail: e.target.value })}
                    placeholder="has:attachment (filename:xml OR filename:pdf) newer_than:30d"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Filtro para buscar correos con facturas electrónicas
                  </p>
                </div>

                <div>
                  <Label htmlFor="label-to-apply">Etiqueta a aplicar (opcional)</Label>
                  <Input
                    id="label-to-apply"
                    value={settings.labelToApply}
                    onChange={(e) => setSettings({ labelToApply: e.target.value })}
                    placeholder="Procesado"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Si concediste gmail.modify, se aplicará esta etiqueta
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <FileSearch className="h-5 w-5" />
                📨 Lectura de Comprobantes desde Gmail
              </h2>
              <div className="space-y-4">
                <div className="bg-muted/50 p-4 rounded-lg">
                  <p className="text-sm mb-2">
                    Esta sección permite buscar correos en Gmail que coincidan con el filtro definido,
                    leer los adjuntos XML/PDF y extraer la información de facturas electrónicas de Hacienda CR.
                  </p>
                  <Badge variant="secondary" className="text-xs">
                    Requiere Gmail conectado
                  </Badge>
                </div>

                <Button className="w-full" size="lg">
                  <Mail className="h-5 w-5 mr-2" />
                  Buscar correos con XML/PDF
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                  Los resultados se mostrarán en la sección de Previsualización
                </p>
              </div>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">📊 Estadísticas</h2>
              <div className="space-y-3">
                <StatItem label="Proveedores mapeados" value="0" />
                <StatItem label="Items en previsualización" value="0" />
                <StatItem label="Documentos creados hoy" value="0" />
              </div>
            </Card>

            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">🚀 Acciones Rápidas</h2>
              <div className="space-y-2">
                <Button variant="outline" className="w-full justify-start" disabled>
                  <FileSearch className="h-4 w-4 mr-2" />
                  Aplicar mapeo a seleccionados
                </Button>
                <Button variant="outline" className="w-full justify-start" disabled>
                  <Send className="h-4 w-4 mr-2" />
                  Crear en QBO (Bills/NC)
                </Button>
                <Button variant="outline" className="w-full justify-start">
                  <Database className="h-4 w-4 mr-2" />
                  Ver registro completo
                </Button>
              </div>
            </Card>
          </div>
        </div>

        <ProcessingLogs />
      </main>
    </div>
  );
};

const StatItem = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
    <span className="text-sm text-muted-foreground">{label}</span>
    <span className="text-lg font-bold">{value}</span>
  </div>
);

export default DashboardACL;
