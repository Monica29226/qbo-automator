import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Building2, Loader2, Plus, Check, Settings } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { CreateOrganizationDialog } from "@/components/CreateOrganizationDialog";
import { getIdentificationLabel, formatIdentification } from "@/lib/identification-types";

interface Organization {
  id: string;
  name: string;
  tax_id: string | null;
  identification_type: string | null;
  identification_number: string | null;
  trade_name: string | null;
  legal_name: string | null;
  email: string | null;
  is_active: boolean;
  created_at: string;
}

const MyCompany = () => {
  const navigate = useNavigate();
  const { activeOrganization, switchOrganization, setActiveOrganizationLocal } = useAuth();
  const [allOrganizations, setAllOrganizations] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    fetchAllOrganizations();
  }, []);

  const fetchAllOrganizations = async () => {
    setIsLoading(true);

    const { data, error } = await supabase
      .from("organizations")
      .select("id, name, tax_id, identification_type, identification_number, trade_name, legal_name, email, is_active, created_at")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading organizations:", error);
      toast.error("Error al cargar empresas");
    } else {
      setAllOrganizations(data || []);
    }

    setIsLoading(false);
  };

  const handleOrganizationCreated = async (organizationId: string) => {
    // Update local state
    setActiveOrganizationLocal(organizationId);
    
    // Refresh the list
    fetchAllOrganizations();
  };

  const handleSelectOrganization = async (orgId: string) => {
    if (orgId === activeOrganization) return;
    
    await switchOrganization(orgId);
    toast.success("Empresa seleccionada");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Volver
            </Button>
            <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
              <Building2 className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Mi Empresa</h1>
              <p className="text-xs text-muted-foreground">
                Selecciona o crea empresas para gestionar
              </p>
            </div>
          </div>
          <Button onClick={() => setIsDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Nueva Empresa
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Current Organization Card */}
            {activeOrganization && (
              <Card className="border-primary">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CardTitle className="flex items-center gap-2">
                        <Building2 className="h-5 w-5" />
                        Empresa Activa
                      </CardTitle>
                      <Badge variant="default">Seleccionada</Badge>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate("/organization")}
                    >
                      <Settings className="h-4 w-4 mr-2" />
                      Configurar
                    </Button>
                  </div>
                  <CardDescription>
                    Esta es la empresa que estás gestionando actualmente
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {allOrganizations
                    .filter((org) => org.id === activeOrganization)
                    .map((org) => (
                      <div key={org.id} className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <p className="text-sm text-muted-foreground">Nombre</p>
                          <p className="text-lg font-semibold">{org.name}</p>
                        </div>
                        {org.trade_name && (
                          <div>
                            <p className="text-sm text-muted-foreground">Nombre Comercial</p>
                            <p className="font-medium">{org.trade_name}</p>
                          </div>
                        )}
                        {org.legal_name && (
                          <div>
                            <p className="text-sm text-muted-foreground">Razón Social</p>
                            <p className="font-medium">{org.legal_name}</p>
                          </div>
                        )}
                        {(org.identification_number || org.tax_id) && (
                          <div>
                            <p className="text-sm text-muted-foreground">
                              {getIdentificationLabel(org.identification_type)}
                            </p>
                            <p className="font-medium">
                              {formatIdentification(
                                org.identification_type,
                                org.identification_number || org.tax_id || "",
                              )}
                            </p>
                          </div>
                        )}
                        {org.email && (
                          <div>
                            <p className="text-sm text-muted-foreground">Correo</p>
                            <p className="font-medium">{org.email}</p>
                          </div>
                        )}
                      </div>
                    ))}
                </CardContent>
              </Card>
            )}

            {/* All Organizations List */}
            <Card>
              <CardHeader>
                <CardTitle>Todas las Empresas Disponibles</CardTitle>
                <CardDescription>
                  Selecciona una empresa para cambiar de contexto o crea una nueva
                </CardDescription>
              </CardHeader>
              <CardContent>
                {allOrganizations.length === 0 ? (
                  <div className="text-center py-8">
                    <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                    <p className="text-muted-foreground">No hay empresas disponibles</p>
                    <Button
                      className="mt-4"
                      onClick={() => setIsDialogOpen(true)}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Crear Primera Empresa
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {allOrganizations.map((org) => (
                      <Card
                        key={org.id}
                        className={`cursor-pointer transition-all hover:shadow-md ${
                          org.id === activeOrganization
                            ? "border-primary bg-primary/5"
                            : "hover:border-primary/50"
                        }`}
                        onClick={() => handleSelectOrganization(org.id)}
                      >
                        <CardContent className="pt-6">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                                <Building2 className="h-4 w-4 text-primary" />
                              </div>
                              {org.id === activeOrganization && (
                                <Check className="h-5 w-5 text-primary" />
                              )}
                            </div>
                          </div>
                          <h3 className="font-semibold text-lg mb-2">{org.name}</h3>
                          <div className="space-y-1 text-sm text-muted-foreground">
                            {(org.identification_number || org.tax_id) && (
                              <p className="truncate">
                                ID: {org.identification_number || org.tax_id}
                              </p>
                            )}
                            {org.email && (
                              <p className="truncate">Email: {org.email}</p>
                            )}
                            <p className="text-xs">
                              Creada: {new Date(org.created_at).toLocaleDateString("es-CR")}
                            </p>
                          </div>
                          {org.id === activeOrganization && (
                            <Badge variant="default" className="mt-3">
                              Activa
                            </Badge>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      <CreateOrganizationDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onSuccess={handleOrganizationCreated}
      />
    </div>
  );
};

export default MyCompany;
