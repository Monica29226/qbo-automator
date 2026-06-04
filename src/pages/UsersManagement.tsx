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
import { Textarea } from "@/components/ui/textarea";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Users, Loader2, Plus, Trash2, Mail, Building2, CheckSquare, Square, AlertCircle, Pencil, X, Send, Power, PowerOff } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  created_at: string;
  organizations: { name: string; id?: string }[];
  tipo_persona?: string;
  numero_cedula?: string | null;
  nombre_comercial?: string | null;
  activo?: boolean;
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

// ====== Cédula formatting helpers ======
const formatCedulaFisica = (value: string): string => {
  const digits = value.replace(/\D/g, "").slice(0, 9);
  if (digits.length <= 1) return digits;
  if (digits.length <= 5) return `${digits[0]}-${digits.slice(1)}`;
  return `${digits[0]}-${digits.slice(1, 5)}-${digits.slice(5)}`;
};

const formatCedulaJuridica = (value: string): string => {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 1) return digits;
  if (digits.length <= 4) return `${digits[0]}-${digits.slice(1)}`;
  return `${digits[0]}-${digits.slice(1, 4)}-${digits.slice(4)}`;
};

const validateCedulaFisica = (cedula: string): boolean => {
  const digits = cedula.replace(/\D/g, "");
  return digits.length === 9;
};

const validateCedulaJuridica = (cedula: string): boolean => {
  const digits = cedula.replace(/\D/g, "");
  return digits.length >= 9 && digits.length <= 10 && digits.startsWith("3");
};

const UsersManagement = () => {
  const navigate = useNavigate();
  const { isAdmin, activeOrganization, isLoading: authLoading } = useAuth();
  const { users, organizations, pendingInvitations, isLoading, invalidate } = useUserManagementData(activeOrganization);
  
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [isEditOrgsDialogOpen, setIsEditOrgsDialogOpen] = useState(false);
  const [isEditNameDialogOpen, setIsEditNameDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editingUserOrgs, setEditingUserOrgs] = useState<string[]>([]);
  const [editingUserName, setEditingUserName] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isSavingOrgs, setIsSavingOrgs] = useState(false);
  const [isSavingName, setIsSavingName] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSendingBulk, setIsSendingBulk] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);
  const [selectedOrganizations, setSelectedOrganizations] = useState<string[]>([]);
  const [isTogglingActive, setIsTogglingActive] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    full_name: "",
    role: "member",
    tipo_persona: "fisica" as "fisica" | "juridica",
    numero_cedula: "",
    nombre_comercial: "",
    nombre_representante: "",
    cedula_representante: "",
    telefono: "",
    direccion: "",
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

  const handleCedulaChange = (value: string) => {
    const formatted = formData.tipo_persona === "fisica"
      ? formatCedulaFisica(value)
      : formatCedulaJuridica(value);
    setFormData(prev => ({ ...prev, numero_cedula: formatted }));
  };

  const handleCedulaRepresentanteChange = (value: string) => {
    setFormData(prev => ({ ...prev, cedula_representante: formatCedulaFisica(value) }));
  };

  const handleCreateUser = async () => {
    if (!formData.email) {
      toast.error("Ingrese el correo del usuario");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      toast.error("Ingrese un correo válido");
      return;
    }

    if (!formData.password || formData.password.length < 8) {
      toast.error("La contraseña debe tener al menos 8 caracteres");
      return;
    }

    if (formData.numero_cedula) {
      if (formData.tipo_persona === "fisica" && !validateCedulaFisica(formData.numero_cedula)) {
        toast.error("La cédula física debe tener exactamente 9 dígitos (formato X-XXXX-XXXX)");
        return;
      }
      if (formData.tipo_persona === "juridica" && !validateCedulaJuridica(formData.numero_cedula)) {
        toast.error("La cédula jurídica debe iniciar con 3 y tener 9-10 dígitos (formato 3-XXX-XXXXXX)");
        return;
      }
    }

    if (formData.tipo_persona === "juridica" && !formData.full_name) {
      toast.error("La razón social es requerida para persona jurídica");
      return;
    }

    if (selectedOrganizations.length === 0) {
      toast.error("Seleccione al menos una empresa");
      return;
    }

    // Check duplicate cédula
    if (formData.numero_cedula) {
      const rawCedula = formData.numero_cedula.replace(/\D/g, "");
      const { data: existing } = await supabase
        .from("profiles")
        .select("id")
        .eq("numero_cedula", rawCedula)
        .maybeSingle();
      
      if (existing) {
        toast.error("Ya existe un usuario con esta cédula en el sistema");
        return;
      }
    }

    setIsSending(true);

    try {
      const orgsToAdd = organizations.filter(org => selectedOrganizations.includes(org.id));
      
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < orgsToAdd.length; i++) {
        const org = orgsToAdd[i];
        
        try {
          const result = await supabase.functions.invoke("create-user", {
            body: {
              email: formData.email,
              password: formData.password,
              full_name: formData.tipo_persona === "juridica" ? formData.full_name : formData.full_name,
              role: formData.role,
              organization_id: org.id,
              tipo_persona: formData.tipo_persona,
              numero_cedula: formData.numero_cedula ? formData.numero_cedula.replace(/\D/g, "") : null,
              nombre_comercial: formData.tipo_persona === "juridica" ? formData.nombre_comercial : null,
              nombre_representante: formData.tipo_persona === "juridica" ? formData.nombre_representante : null,
              cedula_representante: formData.tipo_persona === "juridica" ? formData.cedula_representante.replace(/\D/g, "") : null,
              telefono: formData.telefono || null,
              direccion: formData.direccion || null,
            },
          });

          if (result.error || result.data?.error) {
            errorCount++;
            console.error(`Error adding to ${org.name}:`, result.error || result.data?.error);
          } else {
            successCount++;
          }

          if (i < orgsToAdd.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        } catch (err) {
          errorCount++;
          console.error(`Exception adding to ${org.name}:`, err);
        }
      }

      if (errorCount === 0) {
        toast.success(
          `Usuario creado y agregado a ${successCount} empresa${successCount > 1 ? 's' : ''}. Se envió correo con credenciales.`
        );
        setIsInviteDialogOpen(false);
        resetFormData();
        invalidate();
      } else if (successCount > 0) {
        toast.warning(
          `Usuario agregado a ${successCount} de ${orgsToAdd.length} empresas. ${errorCount} fallaron.`
        );
        invalidate();
      } else {
        toast.error("No se pudo crear el usuario. Verifica tus permisos.");
      }
    } catch (error: any) {
      toast.error(`Error al crear usuario: ${error.message || "Error desconocido"}`);
    } finally {
      setIsSending(false);
    }
  };

  const resetFormData = () => {
    setFormData({
      email: "", password: "", full_name: "", role: "member",
      tipo_persona: "fisica", numero_cedula: "", nombre_comercial: "",
      nombre_representante: "", cedula_representante: "", telefono: "", direccion: "",
    });
    setSelectedOrganizations([]);
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

  const handleEditUserOrgs = (user: UserProfile) => {
    setEditingUser(user);
    setEditingUserOrgs(user.organizations.map(org => org.id || '').filter(Boolean));
    setIsEditOrgsDialogOpen(true);
  };

  const handleSaveUserOrgs = async () => {
    if (!editingUser) return;
    
    setIsSavingOrgs(true);
    
    try {
      const currentOrgIds = editingUser.organizations.map(org => org.id).filter(Boolean);
      const newOrgIds = editingUserOrgs;
      
      const orgsToAdd = newOrgIds.filter(id => !currentOrgIds.includes(id));
      const orgsToRemove = currentOrgIds.filter(id => !newOrgIds.includes(id));

      const failures: { orgId: string; action: string; message: string }[] = [];

      for (const orgId of orgsToRemove) {
        const { error } = await supabase
          .from("organization_members")
          .update({ is_active: false })
          .eq("user_id", editingUser.id)
          .eq("organization_id", orgId);
        if (error) failures.push({ orgId, action: "remove", message: error.message });
      }
      
      for (const orgId of orgsToAdd) {
        const { data: existing, error: selErr } = await supabase
          .from("organization_members")
          .select("id, is_active")
          .eq("user_id", editingUser.id)
          .eq("organization_id", orgId)
          .maybeSingle();

        if (selErr) {
          failures.push({ orgId, action: "lookup", message: selErr.message });
          continue;
        }
          
        if (existing) {
          const { error } = await supabase
            .from("organization_members")
            .update({ is_active: true })
            .eq("id", existing.id);
          if (error) failures.push({ orgId, action: "reactivate", message: error.message });
        } else {
          const { error } = await supabase
            .from("organization_members")
            .insert({
              user_id: editingUser.id,
              organization_id: orgId,
              role: "member",
              is_active: true
            });
          if (error) failures.push({ orgId, action: "add", message: error.message });
        }
      }

      const successCount = (orgsToAdd.length + orgsToRemove.length) - failures.length;

      if (failures.length === 0) {
        toast.success(`Empresas actualizadas correctamente (${successCount} cambios)`);
        setIsEditOrgsDialogOpen(false);
        setEditingUser(null);
      } else {
        console.error("Fallos al actualizar empresas:", failures);
        const firstMsg = failures[0]?.message || "desconocido";
        toast.error(
          `${failures.length} empresa(s) no se pudieron asignar (${successCount} OK). Motivo: ${firstMsg}`
        );
      }
      invalidate();
    } catch (error: any) {
      toast.error(`Error al actualizar: ${error.message}`);
    } finally {
      setIsSavingOrgs(false);
    }
  };

  const toggleEditingOrg = (orgId: string) => {
    setEditingUserOrgs(prev => 
      prev.includes(orgId) 
        ? prev.filter(id => id !== orgId)
        : [...prev, orgId]
    );
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    
    setIsDeleting(true);
    
    try {
      const { data, error } = await supabase.functions.invoke("delete-user", {
        body: { userId: userToDelete.id },
      });

      if (error || data?.error) {
        throw new Error(data?.error || error?.message || "Error al eliminar usuario");
      }

      toast.success(`Usuario ${userToDelete.email} eliminado correctamente`);
      setUserToDelete(null);
      invalidate();
    } catch (err: any) {
      toast.error(err.message || "Error al eliminar usuario");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggleActive = async (user: UserProfile) => {
    setIsTogglingActive(user.id);
    try {
      const newStatus = !(user.activo ?? true);
      const { error } = await supabase
        .from("profiles")
        .update({ activo: newStatus })
        .eq("id", user.id);

      if (error) throw error;

      toast.success(`Usuario ${newStatus ? "activado" : "desactivado"} correctamente`);
      invalidate();
    } catch (error: any) {
      toast.error(`Error: ${error.message}`);
    } finally {
      setIsTogglingActive(null);
    }
  };

  const handleSendBulkWelcome = async () => {
    const confirm = window.confirm(
      `¿Enviar email de bienvenida a todos los ${users.length} usuarios activos?`
    );
    if (!confirm) return;
    
    setIsSendingBulk(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-bulk-welcome", {
        body: { userIds: users.map(u => u.id) },
      });
      if (error || data?.error) {
        throw new Error(data?.error || error?.message || "Error al enviar emails");
      }
      toast.success(data.message || "Emails enviados correctamente");
    } catch (err: any) {
      toast.error(err.message || "Error al enviar emails masivos");
    } finally {
      setIsSendingBulk(false);
    }
  };

  const handleEditUserName = (user: UserProfile) => {
    setEditingUser(user);
    setEditingUserName(user.full_name || "");
    setIsEditNameDialogOpen(true);
  };

  const handleSaveUserName = async () => {
    if (!editingUser) return;
    
    setIsSavingName(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: editingUserName.trim() })
        .eq("id", editingUser.id);
      if (error) throw error;
      toast.success("Nombre actualizado correctamente");
      setIsEditNameDialogOpen(false);
      setEditingUser(null);
      setEditingUserName("");
      invalidate();
    } catch (error: any) {
      toast.error(`Error al actualizar nombre: ${error.message}`);
    } finally {
      setIsSavingName(false);
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

  const formatCedulaDisplay = (cedula: string | null | undefined): string => {
    if (!cedula) return "—";
    if (cedula.includes("-")) return cedula;
    if (cedula.length === 9 && !cedula.startsWith("3")) {
      return `${cedula[0]}-${cedula.slice(1, 5)}-${cedula.slice(5)}`;
    }
    if (cedula.startsWith("3")) {
      return `${cedula[0]}-${cedula.slice(1, 4)}-${cedula.slice(4)}`;
    }
    return cedula;
  };

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
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={handleSendBulkWelcome}
              disabled={isSendingBulk || users.length === 0}
            >
              {isSendingBulk ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Enviar Bienvenida a Todos
                </>
              )}
            </Button>
            <Button onClick={() => setIsInviteDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Crear Usuario
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-6">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <p className="font-medium mb-1">Configuración de correos requerida</p>
                <p className="text-sm">
                  Para enviar invitaciones a otros usuarios, necesitas verificar un dominio en{" "}
                  <a href="https://resend.com/domains" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">Resend</a>
                  {" "}y actualizar el campo "from" en el código a un email usando ese dominio verificado.
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
                  <CardDescription>Invitaciones enviadas que aún no han sido aceptadas</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {pendingInvitations.map((invitation: any) => (
                      <div key={invitation.email} className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
                        <div className="flex-1">
                          <p className="font-medium">{invitation.email}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-sm text-muted-foreground">{roleLabels[invitation.role]}</span>
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
                                <Badge key={idx} variant="outline" className="text-xs">{orgName}</Badge>
                              ))}
                            </div>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            Expira: {formatDate(invitation.expires_at)}
                          </p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => handleDeleteInvitation(invitation.invitation_ids)}>
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
                  Usuarios ({users.length})
                </CardTitle>
                <CardDescription>Usuarios registrados en el sistema y sus empresas asignadas</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre / Razón Social</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Cédula</TableHead>
                      <TableHead>Correo</TableHead>
                      <TableHead>Rol</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Empresas</TableHead>
                      <TableHead className="w-[140px]">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                          No hay usuarios registrados
                        </TableCell>
                      </TableRow>
                    ) : (
                      users.map((user) => (
                        <TableRow key={user.id} className={(user.activo === false) ? "opacity-60" : ""}>
                          <TableCell className="font-medium">
                            <div>
                              {user.full_name || "Sin nombre"}
                              {user.nombre_comercial && (
                                <p className="text-xs text-muted-foreground">{user.nombre_comercial}</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge 
                              variant="outline" 
                              className={user.tipo_persona === "juridica" 
                                ? "border-purple-500/50 text-purple-700 bg-purple-500/10" 
                                : "border-blue-500/50 text-blue-700 bg-blue-500/10"}
                            >
                              {user.tipo_persona === "juridica" ? "Jurídica" : "Física"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm font-mono">
                            {formatCedulaDisplay(user.numero_cedula)}
                          </TableCell>
                          <TableCell>{user.email}</TableCell>
                          <TableCell>
                            <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                              {roleLabels[user.role] || user.role}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge 
                              variant="outline"
                              className={(user.activo ?? true)
                                ? "border-green-500/50 text-green-700 bg-green-500/10"
                                : "border-red-500/50 text-red-700 bg-red-500/10"}
                            >
                              {(user.activo ?? true) ? "Activo" : "Inactivo"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {user.organizations.slice(0, 2).map((org, idx) => (
                                <Badge key={idx} variant="outline" className="text-xs">{org.name}</Badge>
                              ))}
                              {user.organizations.length > 2 && (
                                <Badge variant="outline" className="text-xs">+{user.organizations.length - 2} más</Badge>
                              )}
                              {user.organizations.length === 0 && (
                                <Badge variant="secondary" className="text-xs">Sin empresas</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="sm" onClick={() => handleEditUserName(user)} title="Editar nombre">
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => handleEditUserOrgs(user)} title="Editar empresas">
                                <Building2 className="h-4 w-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => handleToggleActive(user)} 
                                title={(user.activo ?? true) ? "Desactivar" : "Activar"}
                                disabled={isTogglingActive === user.id}
                              >
                                {isTogglingActive === user.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (user.activo ?? true) ? (
                                  <PowerOff className="h-4 w-4 text-orange-500" />
                                ) : (
                                  <Power className="h-4 w-4 text-green-500" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setUserToDelete(user)}
                                title="Eliminar usuario"
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
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

      {/* Create User Dialog */}
      <Dialog open={isInviteDialogOpen} onOpenChange={setIsInviteDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Crear Usuario</DialogTitle>
            <DialogDescription>
              Crea un nuevo usuario con acceso a las empresas seleccionadas.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Tipo de Persona */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Tipo de Persona</Label>
              <RadioGroup
                value={formData.tipo_persona}
                onValueChange={(value) => setFormData(prev => ({ 
                  ...prev, 
                  tipo_persona: value as "fisica" | "juridica",
                  numero_cedula: "",
                }))}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="fisica" id="fisica" />
                  <Label htmlFor="fisica" className="cursor-pointer">Persona Física</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="juridica" id="juridica" />
                  <Label htmlFor="juridica" className="cursor-pointer">Persona Jurídica</Label>
                </div>
              </RadioGroup>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Name / Razón Social */}
              <div>
                <Label htmlFor="full_name">
                  {formData.tipo_persona === "fisica" ? "Nombre Completo *" : "Razón Social *"}
                </Label>
                <Input
                  id="full_name"
                  placeholder={formData.tipo_persona === "fisica" ? "Juan Pérez" : "Empresa S.A."}
                  value={formData.full_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, full_name: e.target.value }))}
                />
              </div>

              {/* Cédula */}
              <div>
                <Label htmlFor="numero_cedula">
                  {formData.tipo_persona === "fisica" ? "Cédula de Identidad" : "Cédula Jurídica"} *
                </Label>
                <Input
                  id="numero_cedula"
                  placeholder={formData.tipo_persona === "fisica" ? "1-1234-5678" : "3-123-456789"}
                  value={formData.numero_cedula}
                  onChange={(e) => handleCedulaChange(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {formData.tipo_persona === "fisica" 
                    ? "Formato: X-XXXX-XXXX (9 dígitos)" 
                    : "Formato: 3-XXX-XXXXXX (inicia con 3)"}
                </p>
              </div>
            </div>

            {/* Nombre Comercial (solo jurídica) */}
            {formData.tipo_persona === "juridica" && (
              <div>
                <Label htmlFor="nombre_comercial">Nombre Comercial</Label>
                <Input
                  id="nombre_comercial"
                  placeholder="Nombre comercial de la empresa"
                  value={formData.nombre_comercial}
                  onChange={(e) => setFormData(prev => ({ ...prev, nombre_comercial: e.target.value }))}
                />
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="email">Correo Electrónico *</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="usuario@ejemplo.com"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                />
              </div>

              <div>
                <Label htmlFor="telefono">Teléfono</Label>
                <Input
                  id="telefono"
                  placeholder="8888-8888"
                  value={formData.telefono}
                  onChange={(e) => setFormData(prev => ({ ...prev, telefono: e.target.value }))}
                />
              </div>
            </div>

            {/* Dirección */}
            <div>
              <Label htmlFor="direccion">Dirección</Label>
              <Textarea
                id="direccion"
                placeholder="Dirección completa"
                value={formData.direccion}
                onChange={(e) => setFormData(prev => ({ ...prev, direccion: e.target.value }))}
                rows={2}
              />
            </div>

            {/* Representante Legal (solo jurídica) */}
            {formData.tipo_persona === "juridica" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t pt-4">
                <div>
                  <Label htmlFor="nombre_representante">Nombre del Representante Legal *</Label>
                  <Input
                    id="nombre_representante"
                    placeholder="Nombre completo del representante"
                    value={formData.nombre_representante}
                    onChange={(e) => setFormData(prev => ({ ...prev, nombre_representante: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="cedula_representante">Cédula del Representante *</Label>
                  <Input
                    id="cedula_representante"
                    placeholder="1-1234-5678"
                    value={formData.cedula_representante}
                    onChange={(e) => handleCedulaRepresentanteChange(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t pt-4">
              <div>
                <Label htmlFor="password">Contraseña *</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Mínimo 8 caracteres"
                  value={formData.password}
                  onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Se enviará al usuario por correo electrónico
                </p>
              </div>

              <div>
                <Label htmlFor="role">Rol *</Label>
                <Select
                  value={formData.role}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, role: value }))}
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
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Empresas con acceso *</Label>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={selectAllOrganizations} className="text-xs h-7">
                    <CheckSquare className="h-3 w-3 mr-1" />
                    Todas
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={clearAllOrganizations} className="text-xs h-7">
                    <Square className="h-3 w-3 mr-1" />
                    Ninguna
                  </Button>
                </div>
              </div>
              
              <div className="border rounded-lg max-h-48 overflow-y-auto">
                {organizations.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground text-center">No hay empresas disponibles</p>
                ) : (
                  <div className="divide-y">
                    {organizations.map((org) => (
                      <label key={org.id} className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50 transition-colors">
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
            <Button variant="outline" onClick={() => { setIsInviteDialogOpen(false); resetFormData(); }}>
              Cancelar
            </Button>
            <Button 
              onClick={handleCreateUser} 
              disabled={isSending || selectedOrganizations.length === 0 || !formData.password}
            >
              {isSending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creando...
                </>
              ) : (
                `Crear Usuario (${selectedOrganizations.length})`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Organizations Dialog */}
      <Dialog open={isEditOrgsDialogOpen} onOpenChange={(open) => {
        if (!open) { setEditingUser(null); setEditingUserOrgs([]); }
        setIsEditOrgsDialogOpen(open);
      }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Empresas de Usuario</DialogTitle>
            <DialogDescription>
              {editingUser?.full_name || editingUser?.email} - Selecciona las empresas a las que tendrá acceso
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Empresas con acceso</Label>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditingUserOrgs(organizations.map(org => org.id))} className="text-xs h-7">
                  <CheckSquare className="h-3 w-3 mr-1" />
                  Todas
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditingUserOrgs([])} className="text-xs h-7">
                  <Square className="h-3 w-3 mr-1" />
                  Ninguna
                </Button>
              </div>
            </div>
            
            <div className="border rounded-lg max-h-64 overflow-y-auto">
              {organizations.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground text-center">No hay empresas disponibles</p>
              ) : (
                <div className="divide-y">
                  {organizations.map((org) => (
                    <label key={org.id} className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50 transition-colors">
                      <input
                        type="checkbox"
                        checked={editingUserOrgs.includes(org.id)}
                        onChange={() => toggleEditingOrg(org.id)}
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
              {editingUserOrgs.length === 0 
                ? "El usuario no tendrá acceso a ninguna empresa"
                : `${editingUserOrgs.length} de ${organizations.length} empresas seleccionadas`}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsEditOrgsDialogOpen(false); setEditingUser(null); setEditingUserOrgs([]); }}>
              Cancelar
            </Button>
            <Button onClick={handleSaveUserOrgs} disabled={isSavingOrgs}>
              {isSavingOrgs ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Guardando...</>) : "Guardar Cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Name Dialog */}
      <Dialog open={isEditNameDialogOpen} onOpenChange={setIsEditNameDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Nombre</DialogTitle>
            <DialogDescription>
              Actualiza el nombre del usuario <strong>{editingUser?.email}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit_full_name">Nombre Completo</Label>
              <Input
                id="edit_full_name"
                placeholder="Juan Pérez"
                value={editingUserName}
                onChange={(e) => setEditingUserName(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsEditNameDialogOpen(false); setEditingUser(null); setEditingUserName(""); }}>
              Cancelar
            </Button>
            <Button onClick={handleSaveUserName} disabled={isSavingName || !editingUserName.trim()}>
              {isSavingName ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Guardando...</>) : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Confirmation */}
      <AlertDialog open={!!userToDelete} onOpenChange={(open) => !open && setUserToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar usuario?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción es <strong>irreversible</strong>. Se eliminará permanentemente el usuario{" "}
              <strong>{userToDelete?.email}</strong> y todo su acceso a las empresas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Eliminando...</>) : (<><Trash2 className="h-4 w-4 mr-2" />Eliminar Usuario</>)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default UsersManagement;
