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
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const OrganizationSwitcher = () => {
  const { organizations, activeOrganization, switchOrganization } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgEmail, setNewOrgEmail] = useState("");
  
  // OAuth credentials states
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [quickbooksClientId, setQuickbooksClientId] = useState("");
  const [quickbooksClientSecret, setQuickbooksClientSecret] = useState("");

  const currentOrg = organizations.find((org) => org.id === activeOrganization);

  const handleCreateOrg = async () => {
    if (!newOrgName) {
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

      // Llamar al edge function para crear la organización (bypasa RLS)
      const { data, error } = await supabase.functions.invoke('create-organization', {
        body: {
          name: newOrgName,
          email: newOrgEmail || null,
          user_id: user.id
        }
      });

      if (error) {
        console.error("Error calling edge function:", error);
        toast.error(`Error al crear empresa: ${error.message}`);
        setIsLoading(false);
        return;
      }

      if (data?.error) {
        console.error("Error from edge function:", data);
        toast.error(`Error al crear empresa: ${data.error}`);
        setIsLoading(false);
        return;
      }

      const newOrg = data.organization;

      // Guardar credenciales OAuth si fueron proporcionadas
      const credentialsToInsert = [];
      
      if (googleClientId && googleClientSecret) {
        credentialsToInsert.push({
          organization_id: newOrg.id,
          provider: 'google',
          client_id: googleClientId.trim(),
          client_secret: googleClientSecret.trim()
        });
      }

      if (quickbooksClientId && quickbooksClientSecret) {
        credentialsToInsert.push({
          organization_id: newOrg.id,
          provider: 'quickbooks',
          client_id: quickbooksClientId.trim(),
          client_secret: quickbooksClientSecret.trim()
        });
      }

      if (credentialsToInsert.length > 0) {
        const { error: credsError } = await supabase
          .from('oauth_credentials')
          .insert(credentialsToInsert);

        if (credsError) {
          console.error("Error saving OAuth credentials:", credsError);
          toast.warning("Empresa creada, pero hubo un error al guardar las credenciales OAuth");
        }
      }

      setIsLoading(false);
      toast.success("Empresa creada exitosamente");
      setIsDialogOpen(false);
      setNewOrgName("");
      setNewOrgEmail("");
      setGoogleClientId("");
      setGoogleClientSecret("");
      setQuickbooksClientId("");
      setQuickbooksClientSecret("");
      
      // Recargar la página para actualizar el estado
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error("Error inesperado:", error);
      toast.error("Error inesperado al crear empresa");
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
            className="flex items-center gap-2 cursor-pointer text-primary"
          >
            <Plus className="h-4 w-4" />
            <span className="font-medium">Crear Nueva Empresa</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Crear Nueva Empresa</DialogTitle>
            <DialogDescription>Configure su empresa y credenciales OAuth</DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="basic" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="basic">Básico</TabsTrigger>
              <TabsTrigger value="google">Google</TabsTrigger>
              <TabsTrigger value="quickbooks">QuickBooks</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-4 mt-4">
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
            </TabsContent>

            <TabsContent value="google" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="google-client-id">Google Client ID</Label>
                <Input
                  id="google-client-id"
                  value={googleClientId}
                  onChange={(e) => setGoogleClientId(e.target.value)}
                  placeholder="123456789.apps.googleusercontent.com"
                />
                <p className="text-xs text-muted-foreground">
                  El Client ID de tu aplicación de Google Cloud Console
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="google-client-secret">Google Client Secret</Label>
                <Textarea
                  id="google-client-secret"
                  value={googleClientSecret}
                  onChange={(e) => setGoogleClientSecret(e.target.value)}
                  placeholder="GOCSPX-..."
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  El Client Secret de tu aplicación de Google Cloud Console
                </p>
              </div>
            </TabsContent>

            <TabsContent value="quickbooks" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="qb-client-id">QuickBooks Client ID</Label>
                <Input
                  id="qb-client-id"
                  value={quickbooksClientId}
                  onChange={(e) => setQuickbooksClientId(e.target.value)}
                  placeholder="ABcdEFghIJklMNop..."
                />
                <p className="text-xs text-muted-foreground">
                  El Client ID de tu aplicación en Intuit Developer
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="qb-client-secret">QuickBooks Client Secret</Label>
                <Textarea
                  id="qb-client-secret"
                  value={quickbooksClientSecret}
                  onChange={(e) => setQuickbooksClientSecret(e.target.value)}
                  placeholder="..."
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  El Client Secret de tu aplicación en Intuit Developer
                </p>
              </div>
            </TabsContent>
          </Tabs>

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
