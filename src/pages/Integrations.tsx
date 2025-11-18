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
import { ArrowLeft, Plus, Plug, Check, X, Mail, Building2, HardDrive, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { OrganizationSwitcher } from "@/components/OrganizationSwitcher";

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

  useEffect(() => {
    if (activeOrganization) {
      fetchData();
    }
  }, [activeOrganization]);

  const fetchData = async () => {
    if (!activeOrganization) return;

    setIsLoading(true);

    // Fetch organization data
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("gmail_connected, gmail_email, outlook_connected, outlook_email, quickbooks_connected, quickbooks_realm_id, google_drive_connected, google_drive_folder_id")
      .eq("id", activeOrganization)
      .single();

    if (orgError) {
      console.error("Error fetching organization:", orgError);
      toast.error("Error al cargar organización");
    } else {
      setOrgData(org);
    }

    // Fetch integration accounts
    const { data: accountsData, error: accountsError } = await supabase
      .from("integration_accounts")
      .select("*")
      .eq("organization_id", activeOrganization)
      .eq("is_active", true)
      .order("service_type");

    if (accountsError) {
      console.error("Error fetching accounts:", accountsError);
    } else {
      setAccounts(accountsData || []);
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

    // QuickBooks requires OAuth flow
    if (selectedService === "quickbooks") {
      handleQuickBooksOAuth();
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

  const handleGmailOAuth = async () => {
    console.log("handleGmailOAuth called");
    
    if (!activeOrganization) {
      console.error("No active organization");
      toast.error("No hay organización activa");
      return;
    }

    try {
      console.log("Getting current user...");
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error("No user found");
        toast.error("Usuario no autenticado");
        return;
      }

      console.log("User found, showing toast...");
      toast.info("Iniciando conexión con Gmail...");

      // Create state with organization and user info
      const state = btoa(JSON.stringify({
        organization_id: activeOrganization,
        user_id: user.id,
      }));

      console.log("Calling gmail-oauth-init function...");
      // Call init function to get OAuth URL
      const { data, error } = await supabase.functions.invoke("gmail-oauth-init", {
        body: { state },
      });

      console.log("Response from gmail-oauth-init:", { data, error });

      if (error) {
        console.error("Error from gmail-oauth-init:", error);
        toast.error(`Error de función: ${JSON.stringify(error)}`);
        throw error;
      }

      if (!data?.authUrl) {
        console.error("No authUrl in response:", data);
        throw new Error("No se recibió URL de autenticación");
      }

      console.log("Opening OAuth popup with URL:", data.authUrl);
      // Open OAuth window
      const width = 500;
      const height = 600;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;

      const popup = window.open(
        data.authUrl,
        "Gmail OAuth",
        `width=${width},height=${height},left=${left},top=${top}`
      );

      if (!popup) {
        console.error("Popup blocked");
        toast.error("Bloqueador de ventanas emergentes detectado. Por favor permite ventanas emergentes.");
        return;
      }

      console.log("Popup opened successfully");

      // Listen for OAuth completion
      const messageHandler = (event: MessageEvent) => {
        console.log("Message received:", event.data);
        if (event.data.type === "gmail-connected") {
          toast.success(`Gmail conectado: ${event.data.email}`);
          setIsDialogOpen(false);
          fetchData();
          window.removeEventListener("message", messageHandler);
        }
      };

      window.addEventListener("message", messageHandler);

      // Check if popup was closed
      const checkPopup = setInterval(() => {
        if (popup?.closed) {
          console.log("Popup closed");
          clearInterval(checkPopup);
          window.removeEventListener("message", messageHandler);
        }
      }, 500);
    } catch (error) {
      console.error("Error starting OAuth:", error);
      toast.error("Error al iniciar conexión con Gmail: " + (error instanceof Error ? error.message : "Error desconocido"));
    }
  };

  const handleQuickBooksOAuth = async () => {
    console.log("handleQuickBooksOAuth called");
    
    if (!activeOrganization) {
      console.error("No active organization");
      toast.error("No hay organización activa");
      return;
    }

    try {
      console.log("Getting current user...");
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error("No user found");
        toast.error("Usuario no autenticado");
        return;
      }

      console.log("User found, showing toast...");
      toast.info("Iniciando conexión con QuickBooks...");

      // Create state with organization and user info
      const state = btoa(JSON.stringify({
        organization_id: activeOrganization,
        user_id: user.id,
      }));

      console.log("Calling quickbooks-oauth-init function...");
      // Call init function to get OAuth URL
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
      // Open OAuth window
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

      // Listen for OAuth completion
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

      // Check if popup was closed
      const checkPopup = setInterval(() => {
        if (popup?.closed) {
          console.log("Popup closed - refreshing data");
          clearInterval(checkPopup);
          window.removeEventListener("message", messageHandler);
          // Refresh data when popup closes as fallback
          setTimeout(() => {
            fetchData();
            setIsDialogOpen(false);
          }, 500);
        }
      }, 500);
    } catch (error) {
      console.error("Error starting QuickBooks OAuth:", error);
      toast.error("Error al iniciar conexión con QuickBooks: " + (error instanceof Error ? error.message : "Error desconocido"));
    }
  };

  const handleRemoveAccount = async (accountId: string) => {
    if (!confirm("¿Está seguro de remover esta cuenta?")) return;

    const { error } = await supabase
      .from("integration_accounts")
      .update({ is_active: false })
      .eq("id", accountId);

    if (error) {
      toast.error("Error al remover cuenta");
      console.error(error);
    } else {
      toast.success("Cuenta removida");
      fetchData();
    }
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
      name: "Outlook",
      icon: Mail,
      connected: orgData?.outlook_connected || false,
      accounts: accounts.filter((a) => a.service_type === "outlook"),
      description: "Recibir facturas por correo Outlook",
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

                  <Button
                    onClick={() => {
                      setSelectedService(service.id);
                      setIsDialogOpen(true);
                    }}
                    size="sm"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Agregar cuenta
                  </Button>
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

          {selectedService === "gmail" || selectedService === "quickbooks" ? (
            <div className="space-y-4">
              <div className="bg-muted p-4 rounded-lg border border-border">
                <p className="text-sm text-foreground mb-2">
                  <strong>Conexión segura con {services.find((s) => s.id === selectedService)?.name}</strong>
                </p>
                <p className="text-xs text-muted-foreground mb-2">
                  {selectedService === "gmail" 
                    ? "Se abrirá una ventana de Google para que autorices el acceso de forma segura."
                    : "Se abrirá una ventana de QuickBooks para que autorices el acceso de forma segura."
                  }
                  {" "}No necesitas ingresar tu contraseña aquí.
                </p>
                <p className="text-xs text-primary font-medium mt-2">
                  ✓ Esta conexión será exclusiva para la empresa actual
                </p>
              </div>
              
              {selectedService === "gmail" && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 p-4 rounded-lg">
                  <p className="text-sm font-semibold text-yellow-700 dark:text-yellow-400 mb-2">
                    ⚠️ Importante: Selección de cuenta
                  </p>
                  <p className="text-xs text-yellow-700/90 dark:text-yellow-400/90">
                    En la ventana de Google, asegúrate de <strong>seleccionar la cuenta de Gmail correcta</strong> para esta empresa. 
                    Si ves una cuenta diferente preseleccionada, haz clic en "Usar otra cuenta" o cambia de cuenta.
                  </p>
                </div>
              )}
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
            >
              {isLoading && selectedService !== "gmail" && selectedService !== "quickbooks" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Agregando...
                </>
              ) : (
                selectedService === "gmail" || selectedService === "quickbooks" 
                  ? `Conectar con ${services.find((s) => s.id === selectedService)?.name}` 
                  : "Agregar Cuenta"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Integrations;
