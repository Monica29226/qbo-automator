import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Plus, Plug, Check, X, Mail, Building2, HardDrive, Loader2, Server, RefreshCw, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { OrganizationSwitcher } from "@/components/OrganizationSwitcher";
import { OutlookImapConnectDialog } from "@/components/OutlookImapConnectDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface IntegrationAccount {
  id: string;
  service_type: string;
  account_email: string | null;
  account_name: string | null;
  is_active: boolean;
}

interface Organization {
  gmail_connected: boolean;
  gmail_email: string | null;
  outlook_connected: boolean;
  outlook_email: string | null;
  quickbooks_connected: boolean;
  quickbooks_realm_id: string | null;
  google_drive_connected: boolean;
  google_drive_folder_id: string | null;
  bluehost_connected: boolean;
  bluehost_email: string | null;
  hostinger_connected: boolean;
  hostinger_email: string | null;
}

const Integrations = () => {
  const { activeOrganization } = useAuth();
  const [orgData, setOrgData] = useState<Organization | null>(null);
  const [accounts, setAccounts] = useState<IntegrationAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<string>("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountName, setAccountName] = useState("");
  const [bluehostPassword, setBluehostPassword] = useState("");
  const [bluehostHost, setBluehostHost] = useState("mail.cemsacr.com");
  const [bluehostPort, setBluehostPort] = useState("993");
  const [hostingerPassword, setHostingerPassword] = useState("");
  const [hostingerHost, setHostingerHost] = useState("imap.hostinger.com");
  const [hostingerPort, setHostingerPort] = useState("993");
  const [isConnecting, setIsConnecting] = useState(false);
  const [imapDialogOpen, setImapDialogOpen] = useState(false);
  const [outlookError, setOutlookError] = useState<{ code: string; message: string } | null>(null);

  useEffect(() => {
    if (activeOrganization) {
      fetchData();
    }
  }, [activeOrganization]);

  const fetchData = async () => {
    if (!activeOrganization) return;

    setIsLoading(true);

    // Fetch both queries in parallel for better performance
    const [orgResult, accountsResult] = await Promise.all([
      supabase
        .from("organizations")
        .select("gmail_connected, gmail_email, outlook_connected, outlook_email, quickbooks_connected, quickbooks_realm_id, google_drive_connected, google_drive_folder_id, bluehost_connected, bluehost_email, hostinger_connected, hostinger_email")
        .eq("id", activeOrganization)
        .single(),
      supabase
        .from("integration_accounts")
        .select("id, service_type, account_email, account_name, is_active")
        .eq("organization_id", activeOrganization)
        .eq("is_active", true)
        .order("service_type")
    ]);

    if (orgResult.error) {
      console.error("Error fetching organization:", orgResult.error);
    } else {
      setOrgData(orgResult.data);
    }

    if (accountsResult.error) {
      console.error("Error fetching accounts:", accountsResult.error);
    } else {
      setAccounts(accountsResult.data || []);
    }

    setIsLoading(false);
  };

  const handleAddAccount = async () => {
    if (!selectedService || !activeOrganization) {
      toast.error("Seleccione un servicio");
      return;
    }

    // Gmail requires OAuth flow
    if (selectedService === "gmail") {
      handleGmailOAuth();
      return;
    }

    // Outlook requires OAuth flow
    if (selectedService === "outlook") {
      handleOutlookOAuth();
      return;
    }

    // QuickBooks requires OAuth flow
    if (selectedService === "quickbooks") {
      handleQuickBooksOAuth();
      return;
    }

    // Google Drive requires OAuth flow
    if (selectedService === "google_drive") {
      handleGoogleDriveOAuth();
      return;
    }

    // Bluehost requires IMAP credentials
    if (selectedService === "bluehost") {
      handleBluehostConnect();
      return;
    }

    // Hostinger requires IMAP credentials
    if (selectedService === "hostinger") {
      handleHostingerConnect();
      return;
    }

    // For other services, keep the manual flow
    if (!accountEmail) {
      toast.error("Complete todos los campos");
      return;
    }

    setIsLoading(true);

    const { error } = await supabase
      .from("integration_accounts")
      .insert([
        {
          organization_id: activeOrganization,
          service_type: selectedService,
          account_email: accountEmail,
          account_name: accountName || accountEmail,
        },
      ]);

    setIsLoading(false);

    if (error) {
      if (error.message.includes("duplicate")) {
        toast.error("Esta cuenta ya está agregada");
      } else {
        toast.error("Error al agregar cuenta");
        console.error(error);
      }
    } else {
      toast.success("Cuenta agregada exitosamente");
      setIsDialogOpen(false);
      setAccountEmail("");
      setAccountName("");
      setSelectedService("");
      fetchData();
    }
  };

  const handleBluehostConnect = async () => {
    if (!activeOrganization) {
      toast.error("No hay organización activa");
      return;
    }

    if (!accountEmail || !bluehostPassword) {
      toast.error("Ingrese email y contraseña");
      return;
    }

    try {
      setIsConnecting(true);
      toast.info("Conectando con Bluehost...");

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Usuario no autenticado");
        return;
      }

      const { data, error } = await supabase.functions.invoke("bluehost-connect", {
        body: {
          organization_id: activeOrganization,
          user_id: user.id,
          email: accountEmail,
          password: bluehostPassword,
          imap_host: bluehostHost,
          imap_port: parseInt(bluehostPort),
        },
      });

      if (error) {
        throw error;
      }

      toast.success(`Bluehost conectado: ${data.email}`);
      setIsDialogOpen(false);
      setAccountEmail("");
      setBluehostPassword("");
      setBluehostHost("mail.cemsacr.com");
      setBluehostPort("993");
      setSelectedService("");
      fetchData();
    } catch (error) {
      console.error("Error connecting Bluehost:", error);
      toast.error("Error al conectar con Bluehost: " + (error instanceof Error ? error.message : "Error desconocido"));
    } finally {
      setIsConnecting(false);
    }
  };

  const handleHostingerConnect = async () => {
    if (!activeOrganization) {
      toast.error("No hay organización activa");
      return;
    }

    if (!accountEmail || !hostingerPassword) {
      toast.error("Ingrese email y contraseña");
      return;
    }

    try {
      setIsConnecting(true);
      toast.info("Conectando con Hostinger...");

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Usuario no autenticado");
        return;
      }

      const { data, error } = await supabase.functions.invoke("hostinger-connect", {
        body: {
          organization_id: activeOrganization,
          user_id: user.id,
          email: accountEmail,
          password: hostingerPassword,
          imap_host: hostingerHost,
          imap_port: parseInt(hostingerPort),
        },
      });

      if (error) {
        throw error;
      }

      if (data?.success === false) {
        toast.error(data.message || "No se pudo conectar con Hostinger");
        return;
      }

      toast.success(`Hostinger conectado: ${data.email || accountEmail}`);
      setIsDialogOpen(false);
      setAccountEmail("");
      setHostingerPassword("");
      setHostingerHost("imap.hostinger.com");
      setHostingerPort("993");
      setSelectedService("");
      fetchData();
    } catch (error) {
      console.error("Error connecting Hostinger:", error);
      toast.error("Error al conectar con Hostinger: " + (error instanceof Error ? error.message : "Error desconocido"));
    } finally {
      setIsConnecting(false);
    }
  };

  const handleGmailOAuth = async () => {
    console.log("handleGmailOAuth called");

    if (isConnecting) return;
    if (!activeOrganization) {
      toast.error("No hay organización activa");
      return;
    }

    // CRITICAL: open popup SYNCHRONOUSLY in the click handler to preserve user gesture.
    // Any await before window.open causes browsers to block the popup.
    const width = 500;
    const height = 600;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;
    const popup = window.open(
      "about:blank",
      "Gmail OAuth",
      `width=${width},height=${height},left=${left},top=${top}`
    );

    if (!popup) {
      toast.error("Bloqueador de ventanas emergentes detectado. Por favor permite ventanas emergentes.");
      return;
    }

    try {
      popup.document.write("<p style='font-family:sans-serif;padding:20px'>Cargando autorización de Gmail…</p>");
    } catch {}

    setIsConnecting(true);
    toast.info("Iniciando conexión con Gmail...");

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        popup.close();
        toast.error("Usuario no autenticado");
        return;
      }

      const state = btoa(JSON.stringify({
        organization_id: activeOrganization,
        user_id: user.id,
      }));

      const { data, error } = await supabase.functions.invoke("gmail-oauth-init", {
        body: { state },
      });

      if (error || !data?.authUrl) {
        popup.close();
        toast.error(`Error de función: ${error ? JSON.stringify(error) : "sin authUrl"}`);
        return;
      }

      popup.location.href = data.authUrl;

      const messageHandler = (event: MessageEvent) => {
        if (event.data?.type === "gmail-connected") {
          toast.success(`Gmail conectado: ${event.data.email}`);
          setIsDialogOpen(false);
          fetchData();
          window.removeEventListener("message", messageHandler);
        }
      };
      window.addEventListener("message", messageHandler);

      const checkPopup = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkPopup);
          window.removeEventListener("message", messageHandler);
          setIsConnecting(false);
        }
      }, 500);
    } catch (error) {
      console.error("Error starting OAuth:", error);
      popup.close();
      toast.error("Error al iniciar conexión con Gmail: " + (error instanceof Error ? error.message : "Error desconocido"));
    } finally {
      setTimeout(() => setIsConnecting(false), 1000);
    }
  };

  const handleOutlookOAuth = async () => {
    console.log("handleOutlookOAuth called");
    
    if (!activeOrganization) {
      console.error("No active organization");
      toast.error("No hay organización activa");
      return;
    }

    try {
      console.log("Getting current user...");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error("No user found");
        toast.error("Usuario no autenticado");
        return;
      }

      console.log("User found, showing toast...");
      toast.info("Iniciando conexión con Outlook...");

      const state = btoa(JSON.stringify({
        organization_id: activeOrganization,
        user_id: user.id,
      }));

      console.log("Calling outlook-oauth-init function...");
      const { data, error } = await supabase.functions.invoke("outlook-oauth-init", {
        body: { state },
      });

      console.log("Response from outlook-oauth-init:", { data, error });

      if (error) {
        console.error("Error from outlook-oauth-init:", error);
        toast.error(`Error de función: ${JSON.stringify(error)}`);
        throw error;
      }

      if (!data?.authUrl) {
        console.error("No authUrl in response:", data);
        throw new Error("No se recibió URL de autenticación");
      }

      console.log("Opening OAuth popup with URL:", data.authUrl);
      const width = 500;
      const height = 600;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;

      const popup = window.open(
        data.authUrl,
        "Outlook OAuth",
        `width=${width},height=${height},left=${left},top=${top}`
      );

      if (!popup) {
        console.error("Popup blocked");
        toast.error("Bloqueador de ventanas emergentes detectado. Por favor permite ventanas emergentes.");
        return;
      }

      console.log("Popup opened successfully");

      const messageHandler = (event: MessageEvent) => {
        console.log("Message received:", event.data);
        if (event.data?.type === "outlook-connected") {
          setOutlookError(null);
          toast.success(`Outlook conectado: ${event.data.email}`);
          setIsDialogOpen(false);
          fetchData();
          window.removeEventListener("message", messageHandler);
        } else if (event.data?.type === "outlook-error") {
          setOutlookError({ code: event.data.code || "oauth_error", message: event.data.message || "Error desconocido" });
          toast.error(`OAuth de Outlook falló: ${event.data.message || event.data.code}`, { duration: 10000 });
          window.removeEventListener("message", messageHandler);
        }
      };

      window.addEventListener("message", messageHandler);

      const checkPopup = setInterval(() => {
        if (popup?.closed) {
          console.log("Popup closed");
          clearInterval(checkPopup);
          window.removeEventListener("message", messageHandler);
          setTimeout(() => {
            fetchData();
            setIsDialogOpen(false);
          }, 500);
        }
      }, 500);
    } catch (error) {
      console.error("Error starting Outlook OAuth:", error);
      toast.error("Error al iniciar conexión con Outlook: " + (error instanceof Error ? error.message : "Error desconocido"));
    }
  };

  const handleGoogleDriveOAuth = async () => {
    console.log("handleGoogleDriveOAuth called");
    
    if (!activeOrganization) {
      console.error("No active organization");
      toast.error("No hay organización activa");
      return;
    }

    try {
      console.log("Getting current user...");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error("No user found");
        toast.error("Usuario no autenticado");
        return;
      }

      console.log("User found, showing toast...");
      toast.info("Iniciando conexión con Google Drive...");

      const state = btoa(JSON.stringify({
        organization_id: activeOrganization,
        user_id: user.id,
      }));

      console.log("Calling google-drive-oauth-init function...");
      const { data, error } = await supabase.functions.invoke("google-drive-oauth-init", {
        body: { state },
      });

      console.log("Response from google-drive-oauth-init:", { data, error });

      if (error) {
        console.error("Error from google-drive-oauth-init:", error);
        toast.error(`Error de función: ${JSON.stringify(error)}`);
        throw error;
      }

      if (!data?.authUrl) {
        console.error("No authUrl in response:", data);
        throw new Error("No se recibió URL de autenticación");
      }

      console.log("Opening OAuth popup with URL:", data.authUrl);
      const width = 500;
      const height = 600;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;

      const popup = window.open(
        data.authUrl,
        "Google Drive OAuth",
        `width=${width},height=${height},left=${left},top=${top}`
      );

      if (!popup) {
        console.error("Popup blocked");
        toast.error("Bloqueador de ventanas emergentes detectado. Por favor permite ventanas emergentes.");
        return;
      }

      console.log("Popup opened successfully");

      const messageHandler = (event: MessageEvent) => {
        console.log("Message received:", event.data);
        if (event.data.type === "google-drive-connected") {
          toast.success(`Google Drive conectado: ${event.data.email}`);
          setIsDialogOpen(false);
          fetchData();
          window.removeEventListener("message", messageHandler);
        }
      };

      window.addEventListener("message", messageHandler);

      const checkPopup = setInterval(() => {
        if (popup?.closed) {
          console.log("Popup closed");
          clearInterval(checkPopup);
          window.removeEventListener("message", messageHandler);
        }
      }, 500);
    } catch (error) {
      console.error("Error starting Google Drive OAuth:", error);
      toast.error("Error al iniciar conexión con Google Drive: " + (error instanceof Error ? error.message : "Error desconocido"));
    }
  };

  const handleQuickBooksOAuth = async () => {
    console.log("handleQuickBooksOAuth called");
    
    if (isConnecting) {
      console.log("Already connecting, ignoring click");
      return;
    }
    
    if (!activeOrganization) {
      console.error("No active organization");
      toast.error("No hay organización activa");
      return;
    }

    setIsConnecting(true);

    try {
      console.log("Getting current user...");
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      
      if (userError) {
        console.error("Error getting user:", userError);
        toast.error("Error de autenticación");
        setIsConnecting(false);
        return;
      }
      
      if (!user) {
        console.error("No user found");
        toast.error("Usuario no autenticado");
        setIsConnecting(false);
        return;
      }

      console.log("User found:", user.email);
      toast.info("Iniciando conexión con QuickBooks...");

      const state = btoa(JSON.stringify({
        organization_id: activeOrganization,
        user_id: user.id,
      }));

      console.log("Calling quickbooks-oauth-init function...");
      const { data, error } = await supabase.functions.invoke("quickbooks-oauth-init", {
        body: { state },
      });

      console.log("Response from quickbooks-oauth-init:", { data, error });

      if (error) {
        console.error("Error from quickbooks-oauth-init:", error);
        toast.error(`Error de función: ${JSON.stringify(error)}`);
        throw error;
      }

      if (!data?.authUrl) {
        console.error("No authUrl in response:", data);
        throw new Error("No se recibió URL de autenticación");
      }

      console.log("Opening OAuth popup with URL:", data.authUrl);
      const width = 800;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;

      const popup = window.open(
        data.authUrl,
        "QuickBooks OAuth",
        `width=${width},height=${height},left=${left},top=${top}`
      );

      if (!popup) {
        console.error("Popup blocked");
        toast.error("Bloqueador de ventanas emergentes detectado. Por favor permite ventanas emergentes.");
        return;
      }

      console.log("Popup opened successfully");

      const messageHandler = (event: MessageEvent) => {
        console.log("🟢 Message received from popup:", event.data);
        if (event.data.type === "quickbooks-connected") {
          console.log("✅ QuickBooks connection confirmed!");
          toast.success(`QuickBooks conectado: Realm ${event.data.realmId}`);
          setIsDialogOpen(false);
          fetchData();
          window.removeEventListener("message", messageHandler);
        }
      };

      window.addEventListener("message", messageHandler);

      const checkPopup = setInterval(() => {
        if (popup?.closed) {
          console.log("Popup closed - refreshing data");
          clearInterval(checkPopup);
          window.removeEventListener("message", messageHandler);
          setIsConnecting(false);
          setTimeout(() => {
            fetchData();
            setIsDialogOpen(false);
          }, 500);
        }
      }, 500);
    } catch (error) {
      console.error("Error starting QuickBooks OAuth:", error);
      toast.error("Error al iniciar conexión con QuickBooks: " + (error instanceof Error ? error.message : "Error desconocido"));
    } finally {
      setTimeout(() => setIsConnecting(false), 1000);
    }
  };

  const handleRemoveAccount = async (accountId: string) => {
    if (!confirm("¿Está seguro de remover esta cuenta?")) return;

    // Read service_type + organization_id before disabling so we can also
    // clear the matching connected flag on organizations (kept consistent).
    const { data: account, error: fetchError } = await supabase
      .from("integration_accounts")
      .select("service_type, organization_id")
      .eq("id", accountId)
      .maybeSingle();

    if (fetchError) {
      toast.error("Error al remover cuenta");
      console.error(fetchError);
      return;
    }

    const { error } = await supabase
      .from("integration_accounts")
      .update({ is_active: false })
      .eq("id", accountId);

    if (error) {
      toast.error("Error al remover cuenta");
      console.error(error);
      return;
    }

    if (account?.service_type && account?.organization_id) {
      const flagByService: Record<string, string> = {
        gmail: "gmail_connected",
        outlook: "outlook_connected",
        bluehost: "bluehost_connected",
        hostinger: "hostinger_connected",
        quickbooks: "quickbooks_connected",
        google_drive: "google_drive_connected",
      };

      const flag = flagByService[account.service_type];
      if (flag) {
        const { error: orgError } = await supabase
          .from("organizations")
          .update({ [flag]: false })
          .eq("id", account.organization_id);

        if (orgError) {
          console.error("Error clearing organization connected flag:", orgError);
        }
      }
    }

    toast.success("Cuenta removida");
    fetchData();
  };

  const services = [
    {
      id: "gmail",
      name: "Gmail",
      icon: Mail,
      connected: orgData?.gmail_connected || false,
      accounts: accounts.filter((a) => a.service_type === "gmail"),
      description: "Recibir facturas por correo Gmail",
    },
    {
      id: "outlook",
      name: "Outlook / Microsoft 365",
      icon: Mail,
      connected: orgData?.outlook_connected || false,
      accounts: accounts.filter((a) => a.service_type === "outlook" || a.service_type === "outlook_imap"),
      description: "Recibir facturas por correo Outlook (OAuth) o Microsoft 365 vía IMAP (avanzado)",
    },
    {
      id: "bluehost",
      name: "Bluehost",
      icon: Server,
      connected: orgData?.bluehost_connected || false,
      accounts: accounts.filter((a) => a.service_type === "bluehost"),
      description: "Recibir facturas por correo Bluehost (IMAP)",
    },
    {
      id: "hostinger",
      name: "Hostinger",
      icon: Server,
      connected: orgData?.hostinger_connected || false,
      accounts: accounts.filter((a) => a.service_type === "hostinger"),
      description: "Recibir facturas por correo Hostinger (IMAP)",
    },
    {
      id: "quickbooks",
      name: "QuickBooks Online",
      icon: Building2,
      connected: orgData?.quickbooks_connected || false,
      accounts: accounts.filter((a) => a.service_type === "quickbooks"),
      description: "Sincronizar facturas y proveedores",
    },
    {
      id: "google_drive",
      name: "Google Drive",
      icon: HardDrive,
      connected: orgData?.google_drive_connected || false,
      accounts: accounts.filter((a) => a.service_type === "google_drive"),
      description: "Almacenar documentos en la nube",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" asChild>
                <Link to="/dashboard">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Volver
                </Link>
              </Button>
              <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
                <Plug className="h-6 w-6 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">Conexiones</h1>
                <p className="text-xs text-muted-foreground">Gestiona tus integraciones</p>
              </div>
            </div>
            <OrganizationSwitcher />
          </div>
          <div className="mt-3 p-3 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground">
              ℹ️ Las conexiones son específicas para cada empresa. Cada empresa debe conectar su propia cuenta de Gmail y QuickBooks independiente.
            </p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 max-w-4xl">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-4">
            {outlookError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Falla al conectar Outlook ({outlookError.code})</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>{outlookError.message}</p>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" onClick={() => { setOutlookError(null); handleOutlookOAuth(); }}>
                      Reintentar OAuth
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setOutlookError(null); setImapDialogOpen(true); }}>
                      Probar IMAP
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setOutlookError(null)}>Cerrar</Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}
            {services.map((service) => (
              <Card key={service.id} className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4 flex-1">
                    <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center">
                      <service.icon className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-lg font-semibold">{service.name}</h3>
                        {service.connected ? (
                          <Badge variant="default" className="gap-1">
                            <Check className="h-3 w-3" />
                            Conectado
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1">
                            <X className="h-3 w-3" />
                            Desconectado
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">
                        {service.description}
                      </p>

                      {service.accounts.length > 0 && (
                        <div className="space-y-2">
                          {service.accounts.map((account) => (
                            <div
                              key={account.id}
                              className="flex items-center justify-between bg-muted/50 rounded-lg p-3"
                            >
                              <div>
                                <p className="text-sm font-medium">
                                  {account.account_name || account.account_email}
                                </p>
                                {account.account_email && (
                                  <p className="text-xs text-muted-foreground">
                                    {account.account_email}
                                  </p>
                                )}
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveAccount(account.id)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    {service.id === "quickbooks" && service.connected && (
                      <Button
                        onClick={handleQuickBooksOAuth}
                        size="sm"
                        variant="outline"
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Reconectar
                      </Button>
                    )}
                    {service.id === "outlook" && (
                      <Button
                        onClick={() => setImapDialogOpen(true)}
                        size="sm"
                        variant="outline"
                        title="Para entornos donde el admin de TI bloquea OAuth de terceros"
                      >
                        <Server className="h-4 w-4 mr-2" />
                        Conectar con IMAP (avanzado)
                      </Button>
                    )}
                    <Button
                      onClick={() => {
                        setSelectedService(service.id);
                        setIsDialogOpen(true);
                      }}
                      size="sm"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      {service.id === "outlook" ? "Conectar con Microsoft (OAuth)" : "Agregar cuenta"}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Dialog para agregar cuenta */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar Cuenta</DialogTitle>
            <DialogDescription>
              Conecta una nueva cuenta de {services.find((s) => s.id === selectedService)?.name} para esta empresa
            </DialogDescription>
          </DialogHeader>

          {selectedService === "gmail" || selectedService === "outlook" || selectedService === "quickbooks" ? (
            <div className="space-y-4">
              <div className="bg-muted p-4 rounded-lg border border-border">
                <p className="text-sm text-foreground mb-2">
                  <strong>Conexión segura con {services.find((s) => s.id === selectedService)?.name}</strong>
                </p>
                <p className="text-xs text-muted-foreground mb-2">
                  {selectedService === "gmail" 
                    ? "Se abrirá una ventana de Google para que autorices el acceso de forma segura."
                    : selectedService === "outlook"
                    ? "Se abrirá una ventana de Microsoft para que autorices el acceso de forma segura."
                    : "Se abrirá una ventana de QuickBooks para que autorices el acceso de forma segura."
                  }
                  {" "}No necesitas ingresar tu contraseña aquí.
                </p>
                <p className="text-xs text-primary font-medium mt-2">
                  ✓ Esta conexión será exclusiva para la empresa actual
                </p>
              </div>
              
              {(selectedService === "gmail" || selectedService === "outlook") && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 p-4 rounded-lg">
                  <p className="text-sm font-semibold text-yellow-700 dark:text-yellow-400 mb-2">
                    ⚠️ Importante: Información sobre la conexión
                  </p>
                  <div className="space-y-2 text-xs text-yellow-700/90 dark:text-yellow-400/90">
                    <p>
                      <strong>1.</strong> La ventana de Google puede mostrar el nombre de otro desarrollador o aplicación. 
                      Esto es <strong>normal y NO es la cuenta que se va a conectar</strong>.
                    </p>
                    <p>
                      <strong>2.</strong> Debes <strong>seleccionar la cuenta de Gmail correcta</strong> para esta empresa cuando Google te lo pida. 
                      Si aparece otra cuenta preseleccionada, haz clic en "Usar otra cuenta" para cambiarla.
                    </p>
                    <p>
                      <strong>3.</strong> La cuenta que selecciones será exclusiva para <strong>esta empresa</strong>.
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : selectedService === "bluehost" ? (
            <div className="space-y-4">
              <div className="bg-muted p-4 rounded-lg border border-border">
                <p className="text-sm text-foreground mb-2">
                  <strong>Conexión IMAP con Bluehost</strong>
                </p>
                <p className="text-xs text-muted-foreground">
                  Ingresa tus credenciales de correo Bluehost para recibir facturas automáticamente.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="bluehost-email">
                  Correo electrónico <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="bluehost-email"
                  type="email"
                  value={accountEmail}
                  onChange={(e) => setAccountEmail(e.target.value)}
                  placeholder="facturas@tudominio.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="bluehost-password">
                  Contraseña <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="bluehost-password"
                  type="password"
                  value={bluehostPassword}
                  onChange={(e) => setBluehostPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="bluehost-host">Servidor IMAP</Label>
                  <Input
                    id="bluehost-host"
                    value={bluehostHost}
                    onChange={(e) => setBluehostHost(e.target.value)}
                    placeholder="mail.cemsacr.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bluehost-port">Puerto</Label>
                  <Input
                    id="bluehost-port"
                    value={bluehostPort}
                    onChange={(e) => setBluehostPort(e.target.value)}
                    placeholder="993"
                  />
                </div>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-lg">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  <strong>Nota:</strong> Tus credenciales se almacenan de forma segura y solo se usan para leer correos con facturas.
                </p>
              </div>
            </div>
          ) : selectedService === "hostinger" ? (
            <div className="space-y-4">
              <div className="bg-muted p-4 rounded-lg border border-border">
                <p className="text-sm text-foreground mb-2">
                  <strong>Conexión IMAP con Hostinger</strong>
                </p>
                <p className="text-xs text-muted-foreground">
                  Ingresa tus credenciales de correo Hostinger para recibir facturas automáticamente.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="hostinger-email">
                  Correo electrónico <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="hostinger-email"
                  type="email"
                  value={accountEmail}
                  onChange={(e) => setAccountEmail(e.target.value)}
                  placeholder="facturas@tudominio.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="hostinger-password">
                  Contraseña <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="hostinger-password"
                  type="password"
                  value={hostingerPassword}
                  onChange={(e) => setHostingerPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="hostinger-host">Servidor IMAP</Label>
                  <Input
                    id="hostinger-host"
                    value={hostingerHost}
                    onChange={(e) => setHostingerHost(e.target.value)}
                    placeholder="imap.hostinger.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hostinger-port">Puerto</Label>
                  <Input
                    id="hostinger-port"
                    value={hostingerPort}
                    onChange={(e) => setHostingerPort(e.target.value)}
                    placeholder="993"
                  />
                </div>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-lg">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  <strong>Nota:</strong> Usa la contraseña del <em>buzón</em> de correo (no la del panel). Si tienes 2FA, usa una contraseña de aplicación. Tus credenciales se almacenan de forma segura y solo se usan para leer correos con facturas.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="account-email">
                  Correo electrónico <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="account-email"
                  type="email"
                  value={accountEmail}
                  onChange={(e) => setAccountEmail(e.target.value)}
                  placeholder="ejemplo@gmail.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="account-name">Nombre de la cuenta (opcional)</Label>
                <Input
                  id="account-name"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="Mi cuenta principal"
                />
              </div>

              <div className="bg-muted p-3 rounded-lg">
                <p className="text-xs text-muted-foreground">
                  <strong>Nota:</strong> Para conectar esta cuenta necesitarás autorizar el acceso
                  en {services.find((s) => s.id === selectedService)?.name}. Actualmente esto debe
                  configurarse manualmente mediante OAuth.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={(e) => {
                console.log("🔴 BUTTON CLICKED - selectedService:", selectedService);
                e.preventDefault();
                e.stopPropagation();
                handleAddAccount();
              }}
              type="button"
              disabled={isConnecting}
            >
              {isConnecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Conectando...
                </>
              ) : isLoading && selectedService !== "gmail" && selectedService !== "outlook" && selectedService !== "quickbooks" && selectedService !== "bluehost" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Agregando...
                </>
              ) : (
                selectedService === "gmail" || selectedService === "outlook" || selectedService === "quickbooks" 
                  ? `Conectar con ${services.find((s) => s.id === selectedService)?.name}` 
                  : selectedService === "bluehost"
                  ? "Conectar Bluehost"
                  : "Agregar Cuenta"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OutlookImapConnectDialog
        open={imapDialogOpen}
        onOpenChange={setImapDialogOpen}
        onConnected={() => fetchData()}
      />
    </div>
  );
};

export default Integrations;
