import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useUserManagementData } from "@/hooks/useUserManagementData";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Users, Loader2, Plus, Trash2, Mail, Building2, CheckSquare, Square, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  created_at: string;
  organizations: { name: string }[];
}

interface PendingInvitation {
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
  organizations: string[];
  invitation_ids: string[];
}

interface Organization {
  id: string;
  name: string;
}

const UsersManagement = () => {
  const navigate = useNavigate();
  const { isAdmin, activeOrganization, isLoading: authLoading } = useAuth();
  const { users, organizations, pendingInvitations, isLoading, invalidate } = useUserManagementData(activeOrganization);
  
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [selectedOrganizations, setSelectedOrganizations] = useState<string[]>([]);
  const [formData, setFormData] = useState({
    email: "",
    role: "member",
  });

  useEffect(() => {
    if (authLoading) return;
    
    if (!isAdmin) {
      toast.error("Acceso denegado. Solo administradores pueden acceder.");
      navigate("/dashboard");
      return;
    }
    
    if (!activeOrganization) {
      toast.error("Por favor selecciona una empresa primero.");
      navigate("/select-company");
      return;
    }
  }, [isAdmin, activeOrganization, authLoading, navigate]);

  const handleSendInvitation = async () => {
    if (!formData.email) {
      toast.error("Ingrese el correo del usuario");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      toast.error("Ingrese un correo válido");
      return;
    }

    if (selectedOrganizations.length === 0) {
      toast.error("Seleccione al menos una empresa");
      return;
    }

    setIsSending(true);

    try {
      // Get selected organizations
      const orgsToInvite = organizations.filter(org => selectedOrganizations.includes(org.id));
      
      // Send invitations sequentially with delay to avoid rate limits
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < orgsToInvite.length; i++) {
        const org = orgsToInvite[i];
        
        try {
          const result = await supabase.functions.invoke("send-invitation", {
            body: {
              email: formData.email,
              role: formData.role,
              organizationId: org.id,
            },
          });

          if (result.error || result.data?.error) {
            errorCount++;
            console.error(`Error inviting to ${org.name}:`, result.error || result.data?.error);
          } else {
            successCount++;
          }

          // Add delay between requests to avoid rate limits
          if (i < orgsToInvite.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 600));
          }
        } catch (err) {
          errorCount++;
          console.error(`Exception inviting to ${org.name}:`, err);
        }
      }

      if (errorCount === 0) {
        toast.success(
          `Usuario invitado a ${successCount} empresa${successCount > 1 ? 's' : ''}. Recibirá un correo para establecer su contraseña.`
        );
        setIsInviteDialogOpen(false);
        setFormData({ email: "", role: "member" });
        setSelectedOrganizations([]);
        invalidate();
      } else if (successCount > 0) {
        toast.warning(
          `Invitaciones enviadas a ${successCount} de ${orgsToInvite.length} empresas. ${errorCount} fallaron.`
        );
        invalidate();
      } else {
        toast.error("No se pudo enviar ninguna invitación. Verifica tus permisos y la configuración de Resend.");
      }
    } catch (error: any) {
      toast.error(`Error al enviar invitaciones: ${error.message || "Error desconocido"}`);
    } finally {
      setIsSending(false);
    }
  };

  const toggleOrganization = (orgId: string) => {
    setSelectedOrganizations(prev => 
      prev.includes(orgId) 
        ? prev.filter(id => id !== orgId)
        : [...prev, orgId]
    );
  };

  const selectAllOrganizations = () => {
    setSelectedOrganizations(organizations.map(org => org.id));
  };

  const clearAllOrganizations = () => {
    setSelectedOrganizations([]);
  };

  const handleDeleteInvitation = async (invitationIds: string[]) => {
    if (!confirm("¿Está seguro de eliminar todas las invitaciones para este usuario?")) return;

    const { error } = await supabase
      .from("organization_invitations")
      .delete()
      .in("id", invitationIds);

    if (error) {
      toast.error("Error al eliminar invitaciones");
      console.error(error);
    } else {
      toast.success("Invitaciones eliminadas");
      invalidate();
    }
  };


  const roleLabels: Record<string, string> = {
    admin: "Administrador Global",
    owner: "Propietario",
    member: "Miembro",
    viewer: "Observador",
  };

  const roleDescriptions: Record<string, string> = {
    admin: "Puede gestionar configuración y miembros de las empresas",
    member: "Puede crear y editar documentos y proveedores",
    viewer: "Solo puede ver información, sin editar",
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("es-CR", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Mostrar loader si auth está cargando
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/5 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
          <p className="text-muted-foreground">Cargando gestión de usuarios...</p>
        </div>
      </div>
    );
  }

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
              <Users className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Gestión de Usuarios ACL</h1>
              <p className="text-xs text-muted-foreground">
                Invitar usuarios con acceso a múltiples empresas
              </p>
            </div>
          </div>
          <Button onClick={() => setIsInviteDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Invitar Usuario
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
            {/* Email Configuration Alert */}
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <p className="font-medium mb-1">Configuración de correos requerida</p>
                <p className="text-sm">
                  Para enviar invitaciones a otros usuarios, necesitas verificar un dominio en{" "}
                  <a 
                    href="https://resend.com/domains" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="underline hover:text-primary"
                  >
                    Resend
                  </a>
                  {" "}y actualizar el campo "from" en el código a un email usando ese dominio verificado.
                  Actualmente solo puedes enviar emails de prueba a: monicalderon.2910@gmail.com
                </p>
              </AlertDescription>
            </Alert>

            {/* Pending Invitations */}
            {pendingInvitations.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="h-5 w-5" />
                    Invitaciones Pendientes ({pendingInvitations.length})
                  </CardTitle>
                  <CardDescription>
                    Invitaciones enviadas que aún no han sido aceptadas
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {pendingInvitations.map((invitation: any) => (
                      <div
                        key={invitation.email}
                        className="flex items-center justify-between p-4 border rounded-lg bg-muted/30"
                      >
                        <div className="flex-1">
                          <p className="font-medium">{invitation.email}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-sm text-muted-foreground">
                              {roleLabels[invitation.role]}
                            </span>
                            <span className="text-sm text-muted-foreground">•</span>
                            <span className="text-sm font-medium text-primary">
                              Acceso a {invitation.organizations.length === organizations.length 
                                ? 'todas las empresas' 
                                : `${invitation.organizations.length} empresa${invitation.organizations.length > 1 ? 's' : ''}`}
                            </span>
                          </div>
                          {invitation.organizations.length <= 5 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {invitation.organizations.map((orgName: string, idx: number) => (
                                <Badge key={idx} variant="outline" className="text-xs">
                                  {orgName}
                                </Badge>
                              ))}
                            </div>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            Expira: {formatDate(invitation.expires_at)}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteInvitation(invitation.invitation_ids)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Active Users */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Usuarios Activos ({users.length})
                </CardTitle>
                <CardDescription>
                  Usuarios registrados en el sistema y sus empresas asignadas
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Usuario</TableHead>
                      <TableHead>Correo</TableHead>
                      <TableHead>Rol Global</TableHead>
                      <TableHead>Empresas con Acceso</TableHead>
                      <TableHead>Fecha de Registro</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          No hay usuarios registrados
                        </TableCell>
                      </TableRow>
                    ) : (
                      users.map((user) => (
                        <TableRow key={user.id}>
                          <TableCell className="font-medium">
                            {user.full_name || "Sin nombre"}
                          </TableCell>
                          <TableCell>{user.email}</TableCell>
                          <TableCell>
                            <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                              {roleLabels[user.role] || user.role}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {user.organizations.slice(0, 3).map((org, idx) => (
                                <Badge key={idx} variant="outline" className="text-xs">
                                  {org.name}
                                </Badge>
                              ))}
                              {user.organizations.length > 3 && (
                                <Badge variant="outline" className="text-xs">
                                  +{user.organizations.length - 3} más
                                </Badge>
                              )}
                              {user.organizations.length === 0 && (
                                <Badge variant="secondary" className="text-xs">
                                  Sin empresas
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDate(user.created_at)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      {/* Invitation Dialog */}
      <Dialog open={isInviteDialogOpen} onOpenChange={setIsInviteDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invitar Usuario de ACL</DialogTitle>
            <DialogDescription>
              Selecciona las empresas a las que el usuario tendrá acceso.
              Recibirá un correo para establecer su contraseña.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="email">Correo Electrónico *</Label>
              <Input
                id="email"
                type="email"
                placeholder="usuario@ejemplo.com"
                value={formData.email}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, email: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground mt-1">
                El usuario recibirá un correo con un enlace de invitación válido por 7 días
              </p>
            </div>

            <div>
              <Label htmlFor="role">Rol en las Empresas *</Label>
              <Select
                value={formData.role}
                onValueChange={(value) =>
                  setFormData((prev) => ({ ...prev, role: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccione un rol" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Administrador</SelectItem>
                  <SelectItem value="member">Miembro</SelectItem>
                  <SelectItem value="viewer">Observador</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {roleDescriptions[formData.role]}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Empresas con acceso *</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={selectAllOrganizations}
                    className="text-xs h-7"
                  >
                    <CheckSquare className="h-3 w-3 mr-1" />
                    Todas
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clearAllOrganizations}
                    className="text-xs h-7"
                  >
                    <Square className="h-3 w-3 mr-1" />
                    Ninguna
                  </Button>
                </div>
              </div>
              
              <div className="border rounded-lg max-h-48 overflow-y-auto">
                {organizations.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground text-center">
                    No hay empresas disponibles
                  </p>
                ) : (
                  <div className="divide-y">
                    {organizations.map((org) => (
                      <label
                        key={org.id}
                        className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedOrganizations.includes(org.id)}
                          onChange={() => toggleOrganization(org.id)}
                          className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
                        />
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="text-sm truncate">{org.name}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              
              <p className="text-xs text-muted-foreground">
                {selectedOrganizations.length === 0 
                  ? "Selecciona al menos una empresa"
                  : `${selectedOrganizations.length} de ${organizations.length} empresas seleccionadas`}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsInviteDialogOpen(false);
                setFormData({ email: "", role: "member" });
                setSelectedOrganizations([]);
              }}
            >
              Cancelar
            </Button>
            <Button 
              onClick={handleSendInvitation} 
              disabled={isSending || selectedOrganizations.length === 0}
            >
              {isSending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Enviando...
                </>
              ) : (
                `Enviar Invitación (${selectedOrganizations.length})`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UsersManagement;
