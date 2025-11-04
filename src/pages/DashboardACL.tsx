import { useEffect } from "react";
import { AppHeader } from "@/components/acl/AppHeader";
import { HelpPanel } from "@/components/acl/HelpPanel";
import { ExcelUploader } from "@/components/acl/ExcelUploader";
import { ProcessingLogs } from "@/components/acl/ProcessingLogs";
import { InboxViewer } from "@/components/acl/InboxViewer";
import { PreviewTable } from "@/components/acl/PreviewTable";
import { useAppStore } from "@/store/appStore";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const DashboardACL = () => {
  const { user, activeOrganization } = useAuth();
  const { 
    setGmailStatus, 
    setQboStatus, 
    setCompanyId, 
    providerMap,
    inboxItems, 
    previewItems 
  } = useAppStore();

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

        <div className="space-y-6 mb-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <ExcelUploader />
            </div>

            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">📊 Estadísticas</h2>
              <div className="space-y-3">
                <StatItem 
                  label="Proveedores mapeados" 
                  value={providerMap.length.toString()} 
                />
                <StatItem 
                  label="Correos en bandeja" 
                  value={inboxItems.length.toString()} 
                />
                <StatItem 
                  label="En previsualización" 
                  value={previewItems.length.toString()} 
                />
              </div>
            </Card>
          </div>

          <InboxViewer />

          <PreviewTable />
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
