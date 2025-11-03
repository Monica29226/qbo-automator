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
      .select("gmail_connected, gmail_email, quickbooks_connected, quickbooks_realm_id, google_drive_connected, google_drive_folder_id")
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

  const services = [
    {
      id: "gmail",
      name: "Gmail",
      icon: Mail,
      connected: orgData?.gmail_connected || false,
      accounts: accounts.filter((a) => a.service_type === "gmail"),
      description: "Recibir facturas por correo electrónico",
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
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
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
    </div>
  );
};

export default Integrations;
