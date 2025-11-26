import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
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
  id: string;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
  organization_id: string;
  organization_name?: string;
}

interface Organization {
  id: string;
  name: string;
}

const UsersManagement = () => {
  const navigate = useNavigate();
  const { isAdmin, activeOrganization, isLoading: authLoading } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    role: "member",
  });

  useEffect(() => {
    console.log('🎯 UsersManagement - Auth state:', { authLoading, isAdmin, activeOrganization });
    
    if (authLoading) {
      console.log('⏳ Still loading auth...');
      return;
    }
    
    if (!isAdmin) {
      console.log('❌ Not admin, redirecting to dashboard');
      toast.error("Acceso denegado. Solo administradores pueden acceder.");
      navigate("/dashboard");
      return;
    }
    
    if (!activeOrganization) {
      console.log('⚠️ No active organization, redirecting to select-company');
      toast.error("Por favor selecciona una empresa primero.");
      navigate("/select-company");
      return;
    }
    
    console.log('✅ All checks passed, fetching data...');
    fetchData();
  }, [isAdmin, activeOrganization, authLoading, navigate]);

  const fetchData = async () => {
    setIsLoading(true);

    // Fetch all users with their roles and organizations
    const { data: usersData, error: usersError } = await supabase
      .from("profiles")
      .select(`
        id,
        email,
        full_name,
        created_at,
        user_roles(role),
        organization_members!inner(
          organization_id,
          role,
          is_active,
          organizations(name)
        )
      `)
      .order("created_at", { ascending: false });

    if (usersError) {
      toast.error("Error al cargar usuarios");
      console.error(usersError);
    } else {
      // Transform the data
      const transformedUsers: UserProfile[] = (usersData || []).map((user: any) => ({
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.user_roles?.[0]?.role || "user",
        created_at: user.created_at,
        organizations: user.organization_members
          ?.filter((m: any) => m.is_active)
          ?.map((m: any) => ({ name: m.organizations?.name })) || [],
      }));
      setUsers(transformedUsers);
    }

    // Fetch all organizations
    const { data: orgsData, error: orgsError } = await supabase
      .from("organizations")
      .select("id, name")
      .eq("is_active", true)
      .order("name");

    if (orgsError) {
      console.error("Error loading organizations:", orgsError);
    } else {
      setOrganizations(orgsData || []);
    }

    // Fetch all pending invitations with organization names
    const { data: invitationsData, error: invitationsError } = await supabase
      .from("organization_invitations")
      .select(`
        id,
        email,
        role,
        created_at,
        expires_at,
        organization_id,
        organizations(name)
      `)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    if (invitationsError) {
      console.error("Error loading invitations:", invitationsError);
    } else {
      setPendingInvitations(
        (invitationsData || []).map((inv: any) => ({
          ...inv,
          organization_name: inv.organizations?.name,
        }))
      );
    }

    setIsLoading(false);
  };

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

    if (organizations.length === 0) {
      toast.error("No hay empresas disponibles");
      return;
    }

    setIsSending(true);

    try {
      // Send invitations sequentially with delay to avoid rate limits
      const results = [];
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < organizations.length; i++) {
        const org = organizations[i];
        
        try {
          const result = await supabase.functions.invoke("send-invitation", {
            body: {
              email: formData.email,
              role: formData.role,
              organizationId: org.id,
            },
          });

          results.push(result);
          
          if (result.error || result.data?.error) {
            errorCount++;
            console.error(`Error inviting to ${org.name}:`, result.error || result.data?.error);
          } else {
            successCount++;
          }

          // Add delay between requests to avoid rate limits (500ms = 2 requests/second max)
          if (i < organizations.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 600));
          }
        } catch (err) {
          errorCount++;
          console.error(`Exception inviting to ${org.name}:`, err);
        }
      }

      if (errorCount === 0) {
        toast.success(
          `Usuario invitado a todas las ${organizations.length} empresas. Recibirá un correo para establecer su contraseña.`
        );
        setIsInviteDialogOpen(false);
        setFormData({ email: "", role: "member" });
        fetchData();
      } else if (successCount > 0) {
        toast.warning(
          `Invitaciones enviadas a ${successCount} de ${organizations.length} empresas. ${errorCount} fallaron.`
        );
        fetchData();
      } else {
        toast.error("No se pudo enviar ninguna invitación. Verifica tus permisos y la configuración de Resend.");
      }
    } catch (error: any) {
      toast.error(`Error al enviar invitaciones: ${error.message || "Error desconocido"}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleDeleteInvitation = async (invitationId: string) => {
    if (!confirm("¿Está seguro de eliminar esta invitación?")) return;

    const { error } = await supabase
      .from("organization_invitations")
      .delete()
      .eq("id", invitationId);

    if (error) {
      toast.error("Error al eliminar invitación");
      console.error(error);
    } else {
      toast.success("Invitación eliminada");
      fetchData();
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
                    {pendingInvitations.map((invitation) => (
                      <div
                        key={invitation.id}
                        className="flex items-center justify-between p-4 border rounded-lg bg-muted/30"
                      >
                        <div className="flex-1">
                          <p className="font-medium">{invitation.email}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline">{invitation.organization_name}</Badge>
                            <span className="text-sm text-muted-foreground">•</span>
                            <span className="text-sm text-muted-foreground">
                              {roleLabels[invitation.role]}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            Expira: {formatDate(invitation.expires_at)}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteInvitation(invitation.id)}
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invitar Usuario de ACL</DialogTitle>
            <DialogDescription>
              El usuario será invitado automáticamente a TODAS las empresas del sistema.
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

            <div className="border rounded-lg p-3 bg-muted/30">
              <div className="flex items-center gap-2 text-sm">
                <Building2 className="h-4 w-4 text-primary" />
                <span className="font-medium">Empresas con acceso:</span>
                <Badge variant="default">Todas ({organizations.length})</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                El usuario tendrá acceso a todas las empresas del sistema automáticamente
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsInviteDialogOpen(false);
                setFormData({ email: "", role: "member" });
              }}
            >
              Cancelar
            </Button>
            <Button onClick={handleSendInvitation} disabled={isSending}>
              {isSending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Enviando...
                </>
              ) : (
                "Enviar Invitación"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UsersManagement;
