import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Building2, Plus } from "lucide-react";
import calderonLogo from "@/assets/acl-logo-new.png";
import { useAuth } from "@/hooks/useAuth";

const SelectCompany = () => {
  const navigate = useNavigate();
  const { user, organizations, isLoading: authLoading, setActiveOrganizationLocal } = useAuth();
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");

  // Ordenar organizaciones alfabéticamente
  const sortedOrganizations = [...organizations].sort((a, b) => 
    a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
  );

  useEffect(() => {
    console.log('🏢 SelectCompany: Estado actual', { authLoading, userExists: !!user, orgCount: organizations.length });
    
    if (!authLoading && !user) {
      console.log('⚠️ SelectCompany: No hay usuario, redirigiendo a login');
      navigate("/");
    }
    
    if (!authLoading && user && organizations.length === 0) {
      console.log('⚠️ SelectCompany: Usuario sin organizaciones');
      toast.error("No tienes acceso a ninguna empresa");
      supabase.auth.signOut();
      navigate("/");
    }
  }, [authLoading, user, organizations, navigate]);

  const handleSelectCompany = async () => {
    if (!selectedOrg || !user) return;

    try {
      setIsSelecting(true);
      
      // Actualizar estado local INMEDIATAMENTE para evitar delay
      console.log('⚡ Actualizando organización local antes de guardar:', selectedOrg);
      setActiveOrganizationLocal(selectedOrg);
      
      const { error } = await supabase
        .from("user_active_organization")
        .upsert({ 
          user_id: user.id, 
          organization_id: selectedOrg 
        });

      if (error) throw error;

      console.log('✅ Organización guardada, navegando al dashboard');
      toast.success("Empresa seleccionada");
      navigate("/dashboard");
    } catch (error) {
      console.error("Error selecting company:", error);
      toast.error("Error al seleccionar la empresa");
    } finally {
      setIsSelecting(false);
    }
  };

  const handleCreateOrganization = async () => {
    if (!newOrgName.trim() || !user) return;

    try {
      setIsCreating(true);

      // Crear la organización
      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .insert({ name: newOrgName.trim() })
        .select()
        .single();

      if (orgError) throw orgError;

      // Agregar al usuario como owner
      const { error: memberError } = await supabase
        .from("organization_members")
        .insert({
          organization_id: org.id,
          user_id: user.id,
          role: "owner",
        });

      if (memberError) throw memberError;

      // Establecer como organización activa
      const { error: activeError } = await supabase
        .from("user_active_organization")
        .upsert({
          user_id: user.id,
          organization_id: org.id,
        });

      if (activeError) throw activeError;

      // Actualizar estado local y navegar
      setActiveOrganizationLocal(org.id);
      
      toast.success("Empresa creada exitosamente");
      setIsCreateDialogOpen(false);
      setNewOrgName("");
      
      navigate("/dashboard");
    } catch (error) {
      console.error("Error creating organization:", error);
      toast.error("Error al crear la empresa");
    } finally {
      setIsCreating(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/5 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/5 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <div className="mb-6 flex justify-center">
            <img src={calderonLogo} alt="Calderón Logo" className="h-24 w-auto" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Selecciona tu Empresa</h1>
          <p className="text-muted-foreground">
            Elige la empresa con la que deseas trabajar
          </p>
        </div>

        <Card className="p-6">
          <div className="space-y-4">
            {sortedOrganizations.map((org) => (
              <button
                key={org.id}
                onClick={() => setSelectedOrg(org.id)}
                className={`w-full p-4 rounded-lg border-2 transition-all text-left flex items-center gap-4 hover:border-primary ${
                  selectedOrg === org.id
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card"
                }`}
              >
                <div className="flex-shrink-0">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                    selectedOrg === org.id ? "bg-primary text-primary-foreground" : "bg-muted"
                  }`}>
                    <Building2 className="h-6 w-6" />
                  </div>
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-foreground">{org.name}</div>
                  <div className="text-sm text-muted-foreground capitalize">
                    Rol: {org.role}
                  </div>
                </div>
                {selectedOrg === org.id && (
                  <div className="flex-shrink-0">
                    <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                      <svg className="w-4 h-4 text-primary-foreground" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                  </div>
                )}
              </button>
            ))}
          </div>

          <div className="flex gap-3 mt-6">
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="flex-1">
                  <Plus className="mr-2 h-4 w-4" />
                  Nueva Empresa
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Crear Nueva Empresa</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="orgName">Nombre de la Empresa</Label>
                    <Input
                      id="orgName"
                      value={newOrgName}
                      onChange={(e) => setNewOrgName(e.target.value)}
                      placeholder="Ingrese el nombre"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newOrgName.trim()) {
                          handleCreateOrganization();
                        }
                      }}
                    />
                  </div>
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsCreateDialogOpen(false);
                        setNewOrgName("");
                      }}
                      className="flex-1"
                    >
                      Cancelar
                    </Button>
                    <Button
                      onClick={handleCreateOrganization}
                      disabled={!newOrgName.trim() || isCreating}
                      className="flex-1"
                    >
                      {isCreating ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Creando...
                        </>
                      ) : (
                        "Crear"
                      )}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <Button
              onClick={handleSelectCompany}
              disabled={!selectedOrg || isSelecting}
              className="flex-1"
            >
              {isSelecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cargando...
                </>
              ) : (
                "Continuar"
              )}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default SelectCompany;
