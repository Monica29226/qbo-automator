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
import { ArrowLeft, Plus, Plug, Check, X, Mail, Building2, HardDrive, Loader2, HelpCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

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
  const [isConnecting, setIsConnecting] = useState(false);
  const [isFetchingGmail, setIsFetchingGmail] = useState(false);
  const [isSyncingQB, setIsSyncingQB] = useState(false);
  const [isCredentialsDialogOpen, setIsCredentialsDialogOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<"google" | "quickbooks" | "">("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [hasGoogleCreds, setHasGoogleCreds] = useState(false);
  const [hasQuickBooksCreds, setHasQuickBooksCreds] = useState(false);

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

    // Check for OAuth credentials
    const { data: googleCreds } = await supabase
      .from("oauth_credentials")
      .select("id")
      .eq("organization_id", activeOrganization)
      .eq("provider", "google")
      .single();
    
    setHasGoogleCreds(!!googleCreds);

    const { data: qbCreds } = await supabase
      .from("oauth_credentials")
      .select("id")
      .eq("organization_id", activeOrganization)
      .eq("provider", "quickbooks")
      .single();
    
    setHasQuickBooksCreds(!!qbCreds);

    setIsLoading(false);
  };

  const handleAddAccount = async () => {
    if (!accountEmail || !selectedService) {
      toast.error("Complete todos los campos");
      return;
    }

    if (!activeOrganization) return;

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

  const handleConnect = async (serviceId: string) => {
    if (!activeOrganization) {
      toast.error("No hay organización activa");
      return;
    }

    // Verificar si hay credenciales OAuth configuradas
    const needsGoogleCreds = serviceId === "gmail" && !hasGoogleCreds;
    const needsQBCreds = serviceId === "quickbooks" && !hasQuickBooksCreds;

    if (needsGoogleCreds || needsQBCreds) {
      // Abrir diálogo para configurar credenciales
      setSelectedProvider(serviceId === "gmail" ? "google" : "quickbooks");
      setIsCredentialsDialogOpen(true);
      toast.info("Primero debes configurar las credenciales OAuth");
      return;
    }

    setIsConnecting(true);

    try {
      let functionName = "";
      
      if (serviceId === "gmail") {
        functionName = "oauth-google-init";
      } else if (serviceId === "quickbooks") {
        functionName = "oauth-quickbooks-init";
      } else {
        toast.info(`La conexión de ${serviceId} estará disponible próximamente`);
        setIsConnecting(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke(functionName, {
        body: { organization_id: activeOrganization }
      });

      if (error) {
        console.error("Error initiating OAuth:", error);
        toast.error("Error al iniciar conexión. Verifica las credenciales OAuth.");
        setIsConnecting(false);
        return;
      }

      if (data?.auth_url) {
        // Redirigir a la URL de autorización
        window.location.href = data.auth_url;
      } else {
        toast.error("No se recibió URL de autorización");
        setIsConnecting(false);
      }
    } catch (error) {
      console.error("Error connecting service:", error);
      toast.error("Error al conectar servicio");
      setIsConnecting(false);
    }
  };

  const handleSaveCredentials = async () => {
    if (!clientId || !clientSecret || !selectedProvider) {
      toast.error("Complete todos los campos");
      return;
    }

    if (!activeOrganization) return;

    setIsLoading(true);

    const { error } = await supabase
      .from("oauth_credentials")
      .insert({
        organization_id: activeOrganization,
        provider: selectedProvider,
        client_id: clientId,
        client_secret: clientSecret,
      });

    setIsLoading(false);

    if (error) {
      if (error.message.includes("duplicate")) {
        toast.error("Ya existen credenciales para este proveedor");
      } else {
        toast.error("Error al guardar credenciales");
        console.error(error);
      }
    } else {
      toast.success("Credenciales guardadas exitosamente");
      setIsCredentialsDialogOpen(false);
      setClientId("");
      setClientSecret("");
      setSelectedProvider("");
      fetchData();
    }
  };

  const handleFetchGmailInvoices = async () => {
    if (!activeOrganization) return;

    setIsFetchingGmail(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-gmail-invoices", {
        body: { organization_id: activeOrganization },
      });

      if (error) {
        toast.error("Error al buscar facturas en Gmail");
        console.error(error);
      } else {
        toast.success(
          `Se encontraron ${data.messages_found} correos. Procesados: ${data.processed}`
        );
        fetchData();
      }
    } catch (error) {
      console.error("Error fetching Gmail invoices:", error);
      toast.error("Error al buscar facturas");
    } finally {
      setIsFetchingGmail(false);
    }
  };

  const handleSyncToQuickBooks = async () => {
    if (!activeOrganization) return;

    // Obtener documentos pendientes de sincronizar
    const { data: pendingDocs, error: docsError } = await supabase
      .from("processed_documents")
      .select("id")
      .eq("organization_id", activeOrganization)
      .eq("status", "review")
      .limit(5);

    if (docsError || !pendingDocs || pendingDocs.length === 0) {
      toast.info("No hay documentos pendientes de sincronizar");
      return;
    }

    setIsSyncingQB(true);
    let successCount = 0;
    let errorCount = 0;

    for (const doc of pendingDocs) {
      try {
        const { error } = await supabase.functions.invoke("sync-to-quickbooks", {
          body: {
            organization_id: activeOrganization,
            document_id: doc.id,
          },
        });

        if (error) {
          errorCount++;
        } else {
          successCount++;
        }
      } catch (error) {
        errorCount++;
      }
    }

    setIsSyncingQB(false);
    
    if (successCount > 0) {
      toast.success(`${successCount} facturas sincronizadas a QuickBooks`);
    }
    if (errorCount > 0) {
      toast.error(`${errorCount} facturas con errores`);
    }
    
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

  // Mostrar mensajes de éxito/error de OAuth
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const success = urlParams.get("success");
    const error = urlParams.get("error");

    if (success === "gmail_connected") {
      toast.success("Gmail conectado exitosamente");
      // Limpiar URL
      window.history.replaceState({}, "", "/integrations");
      fetchData();
    } else if (success === "quickbooks_connected") {
      toast.success("QuickBooks conectado exitosamente");
      window.history.replaceState({}, "", "/integrations");
      fetchData();
    } else if (error) {
      toast.error(`Error en la conexión: ${error}`);
      window.history.replaceState({}, "", "/integrations");
    }
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center justify-between w-full">
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
            <Button variant="outline" size="sm" asChild>
              <Link to="/connection-setup">
                <HelpCircle className="h-4 w-4 mr-2" />
                Guía de Configuración
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 max-w-4xl">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Acciones rápidas */}
            {(orgData?.gmail_connected || orgData?.quickbooks_connected) && (
              <Card className="p-6 bg-primary/5 border-primary/20">
                <h3 className="font-semibold mb-3">Acciones Rápidas</h3>
                <div className="flex flex-wrap gap-3">
                  {orgData?.gmail_connected && (
                    <Button
                      onClick={handleFetchGmailInvoices}
                      disabled={isFetchingGmail}
                      variant="default"
                    >
                      {isFetchingGmail ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Buscando...
                        </>
                      ) : (
                        <>
                          <Mail className="h-4 w-4 mr-2" />
                          Importar desde Gmail
                        </>
                      )}
                    </Button>
                  )}
                  {orgData?.quickbooks_connected && (
                    <Button
                      onClick={handleSyncToQuickBooks}
                      disabled={isSyncingQB}
                      variant="default"
                    >
                      {isSyncingQB ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Sincronizando...
                        </>
                      ) : (
                        <>
                          <Building2 className="h-4 w-4 mr-2" />
                          Sincronizar a QuickBooks
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </Card>
            )}

            {/* Servicios disponibles */}
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

                  {!service.connected ? (
                    <div className="flex flex-col gap-2">
                      {((service.id === "gmail" && !hasGoogleCreds) || 
                        (service.id === "quickbooks" && !hasQuickBooksCreds)) && (
                        <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 text-sm">
                          <p className="font-medium text-warning mb-1">⚙️ Configuración requerida</p>
                          <p className="text-xs text-muted-foreground mb-2">
                            Primero debes configurar las credenciales OAuth
                          </p>
                          <Button
                            onClick={() => {
                              setSelectedProvider(service.id === "gmail" ? "google" : "quickbooks");
                              setIsCredentialsDialogOpen(true);
                            }}
                            size="sm"
                            variant="default"
                            className="w-full"
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            Configurar Credenciales
                          </Button>
                        </div>
                      )}
                      {((service.id === "gmail" && hasGoogleCreds) || 
                        (service.id === "quickbooks" && hasQuickBooksCreds)) && (
                        <Button
                          onClick={() => handleConnect(service.id)}
                          size="sm"
                          variant="default"
                          disabled={isConnecting}
                          className="w-full"
                        >
                          {isConnecting ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Conectando...
                            </>
                          ) : (
                            <>
                              <Plug className="h-4 w-4 mr-2" />
                              Conectar con {service.name}
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  ) : (
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
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
        )}
      </main>

      {/* Dialog para agregar cuenta */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar Cuenta</DialogTitle>
            <DialogDescription>
              Conecta una nueva cuenta de {services.find((s) => s.id === selectedService)?.name}
            </DialogDescription>
          </DialogHeader>

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

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleAddAccount} disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Agregando...
                </>
              ) : (
                "Agregar Cuenta"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
        </Dialog>

        {/* Diálogo para credenciales OAuth */}
        <Dialog open={isCredentialsDialogOpen} onOpenChange={setIsCredentialsDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Configurar Credenciales OAuth - {selectedProvider === "google" ? "Google" : "QuickBooks"}
              </DialogTitle>
              <DialogDescription>
                Para conectar {selectedProvider === "google" ? "Gmail" : "QuickBooks"}, necesitas crear una aplicación OAuth y obtener las credenciales.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="client_id">Client ID</Label>
                <Input
                  id="client_id"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder={selectedProvider === "google" ? "123456789.apps.googleusercontent.com" : "ABxxxxxxxxxxxxxx"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client_secret">Client Secret</Label>
                <Input
                  id="client_secret"
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="GOCSPX-xxxxx o abcdefghijklmnop"
                />
              </div>
              <div className="text-sm text-muted-foreground bg-muted p-3 rounded-lg">
                <p className="font-semibold mb-2">📌 Instrucciones:</p>
                {selectedProvider === "google" ? (
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Ve a <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-primary underline">Google Cloud Console</a></li>
                    <li>Crea un proyecto OAuth</li>
                    <li>Agrega URI de redirección: <code className="bg-background px-1 text-xs break-all">{import.meta.env.VITE_SUPABASE_URL}/functions/v1/oauth-google-callback</code></li>
                    <li>Copia Client ID y Client Secret aquí</li>
                  </ol>
                ) : (
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Ve a <a href="https://developer.intuit.com/app/developer/myapps" target="_blank" rel="noopener noreferrer" className="text-primary underline">Intuit Developer</a></li>
                    <li>Crea una app QuickBooks Online</li>
                    <li>Agrega URI de redirección: <code className="bg-background px-1 text-xs break-all">{import.meta.env.VITE_SUPABASE_URL}/functions/v1/oauth-quickbooks-callback</code></li>
                    <li>Copia Client ID y Client Secret aquí</li>
                  </ol>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCredentialsDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSaveCredentials} disabled={isLoading || !clientId || !clientSecret}>
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  "Guardar Credenciales"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </div>
  );
};

export default Integrations;
