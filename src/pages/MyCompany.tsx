import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, Building2, Loader2, Plus, Check, Settings } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

interface Organization {
  id: string;
  name: string;
  tax_id: string | null;
  email: string | null;
  is_active: boolean;
  created_at: string;
}

const MyCompany = () => {
  const navigate = useNavigate();
  const { activeOrganization, organizations: userOrgs, switchOrganization } = useAuth();
  const [allOrganizations, setAllOrganizations] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newOrgForm, setNewOrgForm] = useState({
    name: "",
    tax_id: "",
    email: "",
  });

  useEffect(() => {
    fetchAllOrganizations();
  }, []);

  const fetchAllOrganizations = async () => {
    setIsLoading(true);

    const { data, error } = await supabase
      .from("organizations")
      .select("id, name, tax_id, email, is_active, created_at")
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

  const handleCreateOrganization = async () => {
    if (!newOrgForm.name.trim()) {
      toast.error("El nombre es requerido");
      return;
    }

    setIsCreating(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        toast.error("Usuario no autenticado");
        setIsCreating(false);
        return;
      }

      // Create organization
      const { data: orgData, error: orgError } = await supabase
        .from("organizations")
        .insert([{
          name: newOrgForm.name,
          tax_id: newOrgForm.tax_id || null,
          email: newOrgForm.email || null,
          is_active: true
        }])
        .select()
        .single();

      if (orgError) {
        toast.error(`Error al crear organización: ${orgError.message}`);
        console.error("Organization insert error:", orgError);
        setIsCreating(false);
        return;
      }

      if (!orgData) {
        toast.error("No se pudo crear la organización");
        setIsCreating(false);
        return;
      }

      // Add user as owner
      const { error: memberError } = await supabase
        .from("organization_members")
        .insert([{
          organization_id: orgData.id,
          user_id: user.id,
          role: "owner",
          is_active: true
        }]);

      if (memberError) {
        toast.error(`Error al asignar rol: ${memberError.message}`);
        console.error("Member insert error:", memberError);
        setIsCreating(false);
        return;
      }

      // Create default system settings
      const defaultSettings = [
        { key: 'qbo_company_id', value: '', description: 'QuickBooks Company ID (realmId)', organization_id: orgData.id },
        { key: 'mail_provider', value: 'gmail', description: 'Proveedor de correo: gmail u outlook', organization_id: orgData.id },
        { key: 'mail_query', value: 'has:attachment (filename:xml OR filename:pdf) newer_than:30d', description: 'Filtro de búsqueda de correos', organization_id: orgData.id },
        { key: 'process_credit_notes', value: 'true', description: 'Procesar notas de crédito automáticamente', organization_id: orgData.id },
        { key: 'currency_fallback', value: 'CRC', description: 'Moneda por defecto si falta en XML', organization_id: orgData.id },
        { key: 'duplicate_window_days', value: '120', description: 'Ventana anti-duplicados en días', organization_id: orgData.id },
        { key: 'dry_run', value: 'true', description: 'Modo prueba (no publica en QBO)', organization_id: orgData.id }
      ];

      await supabase.from('system_settings').insert(defaultSettings);

      toast.success("Organización creada exitosamente");
      setIsDialogOpen(false);
      setNewOrgForm({ name: "", tax_id: "", email: "" });
      setIsCreating(false);
      
      // Switch to new organization and reload
      await switchOrganization(orgData.id);
      fetchAllOrganizations();
    } catch (error) {
      console.error("Unexpected error creating organization:", error);
      toast.error(`Error inesperado: ${error instanceof Error ? error.message : 'Error desconocido'}`);
      setIsCreating(false);
    }
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
                      onClick={() => navigate("/organizations")}
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
                      <div key={org.id} className="space-y-3">
                        <div>
                          <p className="text-sm text-muted-foreground">Nombre</p>
                          <p className="text-lg font-semibold">{org.name}</p>
                        </div>
                        {org.tax_id && (
                          <div>
                            <p className="text-sm text-muted-foreground">Cédula Jurídica</p>
                            <p className="font-medium">{org.tax_id}</p>
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
                            {org.tax_id && (
                              <p className="truncate">Cédula: {org.tax_id}</p>
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

      {/* Create Organization Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Crear Nueva Empresa</DialogTitle>
            <DialogDescription>
              Ingresa la información básica de tu empresa. Podrás completar más detalles después.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="org-name">Nombre de la Empresa *</Label>
              <Input
                id="org-name"
                placeholder="Ej: Mi Empresa S.A."
                value={newOrgForm.name}
                onChange={(e) =>
                  setNewOrgForm((prev) => ({ ...prev, name: e.target.value }))
                }
                disabled={isCreating}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-tax-id">Cédula Jurídica</Label>
              <Input
                id="org-tax-id"
                placeholder="Ej: 3-101-123456"
                value={newOrgForm.tax_id}
                onChange={(e) =>
                  setNewOrgForm((prev) => ({ ...prev, tax_id: e.target.value }))
                }
                disabled={isCreating}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-email">Correo Electrónico</Label>
              <Input
                id="org-email"
                type="email"
                placeholder="contacto@empresa.com"
                value={newOrgForm.email}
                onChange={(e) =>
                  setNewOrgForm((prev) => ({ ...prev, email: e.target.value }))
                }
                disabled={isCreating}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsDialogOpen(false);
                setNewOrgForm({ name: "", tax_id: "", email: "" });
              }}
              disabled={isCreating}
            >
              Cancelar
            </Button>
            <Button onClick={handleCreateOrganization} disabled={isCreating}>
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creando...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Crear Empresa
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MyCompany;
