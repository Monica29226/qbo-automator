import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { HelpCircle, Link as LinkIcon, CheckCircle2, XCircle, Loader2, Settings } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { OAuthCredentialsDialog } from "./OAuthCredentialsDialog";

export const AppHeader = () => {
  const { activeOrganization } = useAuth();
  const { settings, setSettings, companyId, setCompanyId, gmailStatus, qboStatus, setGmailStatus, setQboStatus, addToLog } = useAppStore();
  const [isTesting, setIsTesting] = useState(false);
  const [isConnecting, setIsConnecting] = useState<'gmail' | 'qbo' | null>(null);
  const [hasGoogleCreds, setHasGoogleCreds] = useState(false);
  const [hasQBCreds, setHasQBCreds] = useState(false);
  const [credentialsDialogOpen, setCredentialsDialogOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<'google' | 'quickbooks'>('google');

  useEffect(() => {
    if (activeOrganization) {
      checkCredentials();
    }
  }, [activeOrganization]);

  const checkCredentials = async () => {
    if (!activeOrganization) return;

    try {
      const { data: googleCreds } = await supabase
        .from('oauth_credentials')
        .select('id')
        .eq('organization_id', activeOrganization)
        .eq('provider', 'google')
        .maybeSingle();

      const { data: qbCreds } = await supabase
        .from('oauth_credentials')
        .select('id')
        .eq('organization_id', activeOrganization)
        .eq('provider', 'quickbooks')
        .maybeSingle();

      setHasGoogleCreds(!!googleCreds);
      setHasQBCreds(!!qbCreds);
    } catch (error) {
      console.error('Error checking credentials:', error);
    }
  };

  const handleConnectGmail = async () => {
    if (!activeOrganization) {
      toast.error("No hay organización activa");
      return;
    }

    if (!hasGoogleCreds) {
      toast.error("Primero debes configurar las credenciales OAuth de Google");
      setSelectedProvider('google');
      setCredentialsDialogOpen(true);
      return;
    }

    setIsConnecting('gmail');
    addToLog({ level: 'INFO', message: 'Iniciando conexión con Gmail...' });

    try {
      const { data, error } = await supabase.functions.invoke('oauth-google-init', {
        body: { organization_id: activeOrganization }
      });

      if (error) throw error;

      if (data?.auth_url) {
        window.location.href = data.auth_url;
      }
    } catch (error) {
      console.error('Error connecting Gmail:', error);
      toast.error('Error al iniciar conexión con Gmail');
      addToLog({ level: 'ERROR', message: `Error Gmail: ${error}` });
    } finally {
      setIsConnecting(null);
    }
  };

  const handleConnectQuickBooks = async () => {
    if (!activeOrganization) {
      toast.error("No hay organización activa");
      return;
    }

    if (!companyId.trim()) {
      toast.error("Debe ingresar el Company ID primero");
      return;
    }

    if (!hasQBCreds) {
      toast.error("Primero debes configurar las credenciales OAuth de QuickBooks");
      setSelectedProvider('quickbooks');
      setCredentialsDialogOpen(true);
      return;
    }

    setIsConnecting('qbo');
    addToLog({ level: 'INFO', message: 'Iniciando conexión con QuickBooks...' });

    try {
      const { data, error } = await supabase.functions.invoke('oauth-quickbooks-init', {
        body: { organization_id: activeOrganization }
      });

      if (error) throw error;

      if (data?.auth_url) {
        window.location.href = data.auth_url;
      }
    } catch (error) {
      console.error('Error connecting QuickBooks:', error);
      toast.error('Error al iniciar conexión con QuickBooks');
      addToLog({ level: 'ERROR', message: `Error QuickBooks: ${error}` });
    } finally {
      setIsConnecting(null);
    }
  };

  const handleTestConnections = async () => {
    if (!activeOrganization) return;

    setIsTesting(true);
    addToLog({ level: 'INFO', message: 'Probando conexiones...' });

    try {
      // Verificar Gmail
      const { data: gmailData } = await supabase
        .from('integration_accounts')
        .select('account_email, is_active')
        .eq('organization_id', activeOrganization)
        .eq('service_type', 'gmail')
        .maybeSingle();

      // Verificar QuickBooks
      const { data: qboData } = await supabase
        .from('organizations')
        .select('quickbooks_connected, qbo_realm_id')
        .eq('id', activeOrganization)
        .single();

      const gmailOk = gmailData?.is_active === true;
      const qboOk = qboData?.quickbooks_connected === true;
      const companyIdOk = companyId.trim().length > 0 && /^\d+$/.test(companyId);

      if (gmailData) {
        setGmailStatus({ connected: gmailOk, accountEmail: gmailData.account_email || '' });
      }

      if (qboData) {
        setQboStatus({ 
          connected: qboOk, 
          realmId: qboData.qbo_realm_id || '', 
          companyName: qboOk ? 'Conectado' : '' 
        });
      }

      const results = [
        { service: 'Gmail', ok: gmailOk },
        { service: 'QuickBooks', ok: qboOk },
        { service: 'Company ID', ok: companyIdOk }
      ];

      addToLog({
        level: results.every(r => r.ok) ? 'INFO' : 'WARN',
        message: `Prueba de conexiones: ${results.map(r => `${r.service} ${r.ok ? '✓' : '✗'}`).join(', ')}`
      });

      toast.success('Prueba completada', {
        description: results.map(r => `${r.ok ? '✓' : '✗'} ${r.service}`).join(', ')
      });
    } catch (error) {
      console.error('Error testing connections:', error);
      addToLog({ level: 'ERROR', message: `Error al probar conexiones: ${error}` });
      toast.error('Error al probar conexiones');
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveCompanyId = async () => {
    if (!activeOrganization || !companyId.trim()) {
      toast.error("Ingrese un Company ID válido");
      return;
    }

    if (!/^\d+$/.test(companyId)) {
      toast.error("Company ID debe contener solo dígitos");
      return;
    }

    try {
      const { error } = await supabase
        .from('system_settings')
        .update({ value: companyId })
        .eq('organization_id', activeOrganization)
        .eq('key', 'qbo_company_id');

      if (error) throw error;

      toast.success('Company ID guardado');
      addToLog({ level: 'INFO', message: `Company ID actualizado: ${companyId}` });
    } catch (error) {
      console.error('Error saving company ID:', error);
      toast.error('Error al guardar Company ID');
    }
  };

  return (
    <header className="border-b bg-card sticky top-0 z-10">
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">ACL – Conector Gmail ⇄ QuickBooks</h1>
            <p className="text-sm text-muted-foreground">Multi-empresa · Automatización Contable</p>
          </div>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSettings({ showHelp: !settings.showHelp })}
          >
            <HelpCircle className="h-4 w-4 mr-2" />
            ¿Qué necesito para conectar?
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="flex gap-2">
            <Button
              onClick={handleConnectGmail}
              disabled={isConnecting !== null}
              variant={gmailStatus.connected ? "secondary" : "default"}
              className="flex-1 justify-start"
            >
              {isConnecting === 'gmail' ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : gmailStatus.connected ? (
                <CheckCircle2 className="h-4 w-4 mr-2 text-success" />
              ) : (
                <LinkIcon className="h-4 w-4 mr-2" />
              )}
              {gmailStatus.connected ? `Gmail: ${gmailStatus.accountEmail}` : 'Conectar Gmail'}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                setSelectedProvider('google');
                setCredentialsDialogOpen(true);
              }}
              title="Configurar credenciales OAuth"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleConnectQuickBooks}
              disabled={isConnecting !== null || !companyId.trim()}
              variant={qboStatus.connected ? "secondary" : "default"}
              className="flex-1 justify-start"
            >
              {isConnecting === 'qbo' ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : qboStatus.connected ? (
                <CheckCircle2 className="h-4 w-4 mr-2 text-success" />
              ) : (
                <LinkIcon className="h-4 w-4 mr-2" />
              )}
              {qboStatus.connected ? `QBO: ${qboStatus.realmId}` : 'Conectar QuickBooks'}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                setSelectedProvider('quickbooks');
                setCredentialsDialogOpen(true);
              }}
              title="Configurar credenciales OAuth"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                placeholder="Company ID (Realm ID)"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className="h-10"
              />
            </div>
            <Button onClick={handleSaveCompanyId} size="sm" variant="ghost">
              Guardar
            </Button>
          </div>

          <Button onClick={handleTestConnections} disabled={isTesting} variant="outline">
            {isTesting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-2" />
            )}
            Probar conexiones
          </Button>
        </div>

        {(!companyId.trim() || !/^\d+$/.test(companyId)) && (
          <div className="mt-3 p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
            <p className="text-sm text-destructive font-medium">
              ⚠️ Company ID requerido y debe contener solo dígitos
            </p>
          </div>
        )}

        {(!hasGoogleCreds || !hasQBCreds) && (
          <div className="mt-3 p-3 bg-warning/10 border border-warning/30 rounded-lg">
            <p className="text-sm font-medium mb-1">
              ⚙️ Configuración OAuth pendiente
            </p>
            <p className="text-xs text-muted-foreground">
              {!hasGoogleCreds && !hasQBCreds && 'Configura las credenciales OAuth de Gmail y QuickBooks usando los botones ⚙️'}
              {!hasGoogleCreds && hasQBCreds && 'Configura las credenciales OAuth de Gmail usando el botón ⚙️'}
              {hasGoogleCreds && !hasQBCreds && 'Configura las credenciales OAuth de QuickBooks usando el botón ⚙️'}
            </p>
          </div>
        )}
      </div>

      <OAuthCredentialsDialog
        open={credentialsDialogOpen}
        onOpenChange={setCredentialsDialogOpen}
        provider={selectedProvider}
        organizationId={activeOrganization || ''}
        onSuccess={checkCredentials}
      />
    </header>
  );
};
