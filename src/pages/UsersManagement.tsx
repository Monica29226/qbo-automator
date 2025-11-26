import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { ArrowLeft, Users, Loader2, Plus, Trash2, Mail, Building2, CheckSquare, Square } from "lucide-react";
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
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    role: "member",
    organization_ids: [] as string[],
  });

  useEffect(() => {
    if (!isAdmin) {
      toast.error("Acceso denegado. Solo administradores pueden acceder.");
      navigate("/dashboard");
      return;
    }
    fetchData();
  }, [isAdmin, navigate]);

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

  const handleSendInvitations = async () => {
    if (!formData.email) {
      toast.error("Ingrese el correo del usuario");
      return;
    }

    if (formData.organization_ids.length === 0) {
      toast.error("Seleccione al menos una empresa");
      return;
    }

    // Validar email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      toast.error("Ingrese un correo válido");
      return;
    }

    setIsSending(true);

    try {
      // Send invitation for each selected organization
      const promises = formData.organization_ids.map((orgId) =>
        supabase.functions.invoke("send-invitation", {
          body: {
            email: formData.email,
            role: formData.role,
            organizationId: orgId,
          },
        })
      );

      const results = await Promise.all(promises);

      // Check for errors
      const errors = results.filter((r) => r.error || r.data?.error);
      if (errors.length > 0) {
        toast.error(`Error al enviar ${errors.length} invitación(es)`);
        console.error("Errors:", errors);
      } else {
        toast.success(
          `${formData.organization_ids.length} invitación(es) enviada(s) exitosamente a ${formData.email}`
        );
        setIsDialogOpen(false);
        setFormData({
          email: "",
          role: "member",
          organization_ids: [],
        });
        fetchData();
      }
    } catch (error: any) {
      console.error("Error sending invitations:", error);
      toast.error("Error al enviar invitaciones");
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

  const toggleOrganization = (orgId: string) => {
    setFormData((prev) => ({
      ...prev,
      organization_ids: prev.organization_ids.includes(orgId)
        ? prev.organization_ids.filter((id) => id !== orgId)
        : [...prev.organization_ids, orgId],
    }));
  };

  const selectAllOrganizations = () => {
    if (formData.organization_ids.length === organizations.length) {
      // Deselect all
      setFormData((prev) => ({
        ...prev,
        organization_ids: [],
      }));
    } else {
      // Select all
      setFormData((prev) => ({
        ...prev,
        organization_ids: organizations.map((org) => org.id),
      }));
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
          <Button onClick={() => setIsDialogOpen(true)}>
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
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invitar Usuario de ACL</DialogTitle>
            <DialogDescription>
              Envía una invitación por correo para que el usuario pueda acceder a las empresas seleccionadas.
              El usuario recibirá un enlace para aceptar la invitación.
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
                  <SelectValue />
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

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Empresas con Acceso *</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={selectAllOrganizations}
                >
                  {formData.organization_ids.length === organizations.length ? (
                    <>
                      <Square className="h-4 w-4 mr-2" />
                      Deseleccionar Todas
                    </>
                  ) : (
                    <>
                      <CheckSquare className="h-4 w-4 mr-2" />
                      Seleccionar Todas
                    </>
                  )}
                </Button>
              </div>
              <div className="border rounded-lg p-4 max-h-60 overflow-y-auto space-y-2">
                {organizations.map((org) => (
                  <div
                    key={org.id}
                    className="flex items-center gap-3 p-2 hover:bg-muted/50 rounded cursor-pointer transition-colors"
                    onClick={() => toggleOrganization(org.id)}
                  >
                    <div className="flex items-center justify-center h-4 w-4">
                      {formData.organization_ids.includes(org.id) ? (
                        <CheckSquare className="h-4 w-4 text-primary" />
                      ) : (
                        <Square className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1">{org.name}</span>
                  </div>
                ))}
                {organizations.length === 0 && (
                  <p className="text-center text-muted-foreground py-4">
                    No hay empresas disponibles
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between mt-2">
                <p className="text-xs text-muted-foreground">
                  Seleccionadas: {formData.organization_ids.length} de {organizations.length}
                </p>
                {formData.organization_ids.length === organizations.length &&
                  organizations.length > 0 && (
                    <Badge variant="default" className="text-xs">
                      Acceso a todas las empresas
                    </Badge>
                  )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsDialogOpen(false);
                setFormData({ email: "", role: "member", organization_ids: [] });
              }}
            >
              Cancelar
            </Button>
            <Button onClick={handleSendInvitations} disabled={isSending}>
              {isSending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4 mr-2" />
                  Enviar Invitaciones
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UsersManagement;
