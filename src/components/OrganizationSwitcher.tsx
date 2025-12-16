import { Building2, Check, Plus } from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export const OrganizationSwitcher = () => {
  const { organizations, activeOrganization, switchOrganization, setActiveOrganizationLocal } = useAuth();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");

  const currentOrg = organizations.find((org) => org.id === activeOrganization);

  const handleCreateOrg = async () => {
    if (!newOrgName.trim()) {
      toast.error("El nombre es requerido");
      return;
    }

    setIsLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        toast.error("Usuario no autenticado");
        setIsLoading(false);
        return;
      }

      // Step 1: Create organization - use .select('id') to avoid RLS issue on full select
      const { data: insertedOrgs, error: orgError } = await supabase
        .from("organizations")
        .insert({
          name: newOrgName,
          is_active: true
        })
        .select('id');

      if (orgError) {
        toast.error(`Error al crear organización: ${orgError.message}`);
        console.error("Organization insert error:", orgError);
        setIsLoading(false);
        return;
      }

      const orgData = insertedOrgs?.[0];

      if (!orgData) {
        toast.error("No se pudo crear la organización");
        setIsLoading(false);
        return;
      }

      // Step 2: Add user as owner
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
        setIsLoading(false);
        return;
      }

      // Step 3: Set as active organization
      const { error: activeOrgError } = await supabase
        .from("user_active_organization")
        .upsert({
          user_id: user.id,
          organization_id: orgData.id
        });

      if (activeOrgError) {
        console.warn("Warning setting active org:", activeOrgError);
      }

      // Actualizar estado local inmediatamente sin recargar página
      setActiveOrganizationLocal(orgData.id);
      
      // Invalidar queries para refrescar datos
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      queryClient.invalidateQueries({ queryKey: ["organization-connections"] });
      queryClient.invalidateQueries({ queryKey: ["recent-documents"] });

      toast.success("Organización creada exitosamente");
      setIsDialogOpen(false);
      setNewOrgName("");
      setIsLoading(false);
    } catch (error) {
      console.error("Unexpected error creating organization:", error);
      toast.error(`Error inesperado: ${error instanceof Error ? error.message : 'Error desconocido'}`);
      setIsLoading(false);
    }
  };

  if (organizations.length === 0) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Building2 className="h-4 w-4" />
            <span className="hidden md:inline">{currentOrg?.name || "Seleccionar empresa"}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Cambiar Empresa</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {organizations.map((org) => (
            <DropdownMenuItem
              key={org.id}
              onClick={() => switchOrganization(org.id)}
              className="flex items-center justify-between cursor-pointer"
            >
              <div className="flex flex-col">
                <span className="font-medium">{org.name}</span>
                <span className="text-xs text-muted-foreground capitalize">{org.role}</span>
              </div>
              {org.id === activeOrganization && <Check className="h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setIsDialogOpen(true)}
            className="flex items-center gap-2 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Nueva Empresa</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear Nueva Empresa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="org-name">Nombre de la Empresa</Label>
              <Input
                id="org-name"
                placeholder="Ingrese el nombre"
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                disabled={isLoading}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsDialogOpen(false);
                setNewOrgName("");
              }}
              disabled={isLoading}
            >
              Cancelar
            </Button>
            <Button onClick={handleCreateOrg} disabled={isLoading}>
              {isLoading ? "Creando..." : "Crear Empresa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
