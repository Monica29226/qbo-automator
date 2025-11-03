import { Building2, Check, Plus, Loader2 } from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const OrganizationSwitcher = () => {
  const { organizations, activeOrganization, switchOrganization } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgEmail, setNewOrgEmail] = useState("");

  const currentOrg = organizations.find((org) => org.id === activeOrganization);

  const handleCreateOrg = async () => {
    if (!newOrgName) {
      toast.error("El nombre es requerido");
      return;
    }

    setIsLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      toast.error("Usuario no autenticado");
      setIsLoading(false);
      return;
    }

    // Crear nueva organización
    const { data: newOrg, error: orgError } = await supabase
      .from("organizations")
      .insert([{
        name: newOrgName,
        email: newOrgEmail || null,
      }])
      .select()
      .single();

    if (orgError) {
      toast.error("Error al crear empresa");
      console.error(orgError);
      setIsLoading(false);
      return;
    }

    // Agregar usuario actual como owner
    const { error: memberError } = await supabase
      .from("organization_members")
      .insert([{
        organization_id: newOrg.id,
        user_id: user.id,
        role: 'owner'
      }]);

    if (memberError) {
      toast.error("Error al configurar permisos");
      console.error(memberError);
      setIsLoading(false);
      return;
    }

    // Establecer como organización activa
    await supabase
      .from("user_active_organization")
      .upsert({
        user_id: user.id,
        organization_id: newOrg.id
      }, {
        onConflict: 'user_id'
      });

    setIsLoading(false);
    toast.success("Empresa creada exitosamente");
    setIsDialogOpen(false);
    setNewOrgName("");
    setNewOrgEmail("");
    
    // Recargar la página para actualizar el estado
    window.location.reload();
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
            className="flex items-center gap-2 cursor-pointer text-primary"
          >
            <Plus className="h-4 w-4" />
            <span className="font-medium">Crear Nueva Empresa</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear Nueva Empresa</DialogTitle>
            <DialogDescription>Cree una nueva empresa para gestionar</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org-name">
                Nombre <span className="text-destructive">*</span>
              </Label>
              <Input
                id="org-name"
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                placeholder="Mi Nueva Empresa"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-email">Correo</Label>
              <Input
                id="org-email"
                type="email"
                value={newOrgEmail}
                onChange={(e) => setNewOrgEmail(e.target.value)}
                placeholder="contacto@empresa.com"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreateOrg} disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creando...
                </>
              ) : (
                "Crear Empresa"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
