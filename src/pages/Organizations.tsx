import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { FileText, ArrowLeft, Loader2, Plus, Edit, Users as UsersIcon, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";

interface Organization {
  id: string;
  name: string;
  tax_id: string | null;
  email: string | null;
  qbo_company_id: string | null;
  google_drive_folder_id: string | null;
  google_drive_enabled: boolean;
  is_active: boolean;
}

interface Member {
  id: string;
  user_id: string;
  role: string;
  profiles: {
    email: string;
    full_name: string | null;
  };
}

interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
}

const Organizations = () => {
  const { activeOrganization, organizations: userOrgs } = useAuth();
  const [orgDetails, setOrgDetails] = useState<Organization | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState<"edit-org" | "add-member" | "create-org">("edit-org");
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberRole, setNewMemberRole] = useState("member");
  const [orgFormData, setOrgFormData] = useState({
    name: "",
    tax_id: "",
    email: "",
    qbo_company_id: "",
    google_drive_folder_id: "",
    google_drive_enabled: false,
  });

  useEffect(() => {
    if (activeOrganization) {
      fetchOrgData();
    }
  }, [activeOrganization]);

  const fetchOrgData = async () => {
    if (!activeOrganization) return;

    setIsLoading(true);

    // Obtener detalles de la organización
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("*")
      .eq("id", activeOrganization)
      .single();

    if (orgError) {
      toast.error("Error al cargar organización");
      console.error(orgError);
    } else {
      setOrgDetails(org);
      setOrgFormData({
        name: org.name,
        tax_id: org.tax_id || "",
        email: org.email || "",
        qbo_company_id: org.qbo_company_id || "",
        google_drive_folder_id: org.google_drive_folder_id || "",
        google_drive_enabled: org.google_drive_enabled || false,
      });
    }

    // Obtener miembros
    const { data: membersData, error: membersError } = await supabase
      .from("organization_members")
      .select("id, user_id, role")
      .eq("organization_id", activeOrganization)
      .eq("is_active", true)
      .order("role");

    if (membersError) {
      toast.error("Error al cargar miembros");
      console.error(membersError);
    } else if (membersData && membersData.length > 0) {
      // Fetch profiles separately since there's no FK relationship
      const userIds = membersData.map(m => m.user_id);
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", userIds);

      // Combine members with their profiles
      const membersWithProfiles = membersData.map(member => ({
        ...member,
        profiles: profilesData?.find(p => p.id === member.user_id) || { email: "", full_name: "" }
      }));
      setMembers(membersWithProfiles as any);
    } else {
      setMembers([]);
    }

    // Obtener invitaciones pendientes
    const { data: invitationsData, error: invitationsError } = await supabase
      .from("organization_invitations")
      .select("id, email, role, created_at, expires_at")
      .eq("organization_id", activeOrganization)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    if (invitationsError) {
      console.error("Error loading invitations:", invitationsError);
    } else {
      setPendingInvitations(invitationsData || []);
    }

    setIsLoading(false);
  };

  const handleUpdateOrg = async () => {
    if (!orgFormData.name) {
      toast.error("El nombre es requerido");
      return;
    }

    if (!activeOrganization) return;

    setIsLoading(true);

    const { error } = await supabase
      .from("organizations")
      .update({
        name: orgFormData.name,
        tax_id: orgFormData.tax_id || null,
        email: orgFormData.email || null,
        qbo_company_id: orgFormData.qbo_company_id || null,
        google_drive_folder_id: orgFormData.google_drive_folder_id || null,
        google_drive_enabled: orgFormData.google_drive_enabled,
      })
      .eq("id", activeOrganization);

    setIsLoading(false);

    if (error) {
      toast.error("Error al actualizar organización");
      console.error(error);
    } else {
      toast.success("Organización actualizada");
      setIsDialogOpen(false);
      fetchOrgData();
    }
  };

  const handleAddMember = async () => {
    if (!newMemberEmail) {
      toast.error("Ingrese el correo del usuario");
      return;
    }

    if (!activeOrganization) return;

    // Validar email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newMemberEmail)) {
      toast.error("Ingrese un correo válido");
      return;
    }

    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("send-invitation", {
        body: {
          email: newMemberEmail,
          role: newMemberRole,
          organizationId: activeOrganization,
        },
      });

      if (error) throw error;

      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success("Invitación enviada por correo");
        setIsDialogOpen(false);
        setNewMemberEmail("");
        setNewMemberRole("member");
        fetchOrgData();
      }
    } catch (error: any) {
      console.error("Error sending invitation:", error);
      toast.error("Error al enviar invitación");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!confirm("¿Está seguro de remover este miembro?")) return;

    const { error } = await supabase
      .from("organization_members")
      .update({ is_active: false })
      .eq("id", memberId);

    if (error) {
      toast.error("Error al remover miembro");
      console.error(error);
    } else {
      toast.success("Miembro removido");
      fetchOrgData();
    }
  };

  const handleCreateOrg = async () => {
    if (!orgFormData.name) {
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

    try {
      // Paso 1: Crear organización y obtener ID usando returning
      const { data: insertedOrgs, error: orgError } = await supabase
        .from("organizations")
        .insert({
          name: orgFormData.name,
          tax_id: orgFormData.tax_id || null,
          email: orgFormData.email || null,
          qbo_company_id: orgFormData.qbo_company_id || null,
          google_drive_folder_id: orgFormData.google_drive_folder_id || null,
          google_drive_enabled: orgFormData.google_drive_enabled,
        })
        .select('id');

      if (orgError) {
        console.error("Error creating organization:", orgError);
        toast.error(`Error al crear organización: ${orgError.message}`);
        setIsLoading(false);
        return;
      }

      if (!insertedOrgs || insertedOrgs.length === 0) {
        toast.error("Error: No se pudo obtener el ID de la organización creada");
        setIsLoading(false);
        return;
      }

      const newOrgId = insertedOrgs[0].id;
      console.log("✅ Organización creada con ID:", newOrgId);

      // Paso 2: Agregar usuario actual como owner
      const { error: memberError } = await supabase
        .from("organization_members")
        .insert({
          organization_id: newOrgId,
          user_id: user.id,
          role: 'owner'
        });

      if (memberError) {
        console.error("Error adding member:", memberError);
        toast.error(`Error al configurar permisos: ${memberError.message}`);
        setIsLoading(false);
        return;
      }

      console.log("✅ Usuario agregado como owner");

      // Paso 3: Crear configuración inicial de sistema
      const defaultSettings = [
        { key: 'qbo_company_id', value: '', description: 'QuickBooks Company ID', organization_id: newOrgId },
        { key: 'mail_provider', value: 'gmail', description: 'Proveedor de correo', organization_id: newOrgId },
        { key: 'dry_run', value: 'true', description: 'Modo prueba', organization_id: newOrgId },
      ];

      await supabase.from('system_settings').insert(defaultSettings);

      toast.success("Organización creada exitosamente. Recarga la página para verla.");
      setIsDialogOpen(false);
      setOrgFormData({
        name: "",
        tax_id: "",
        email: "",
        qbo_company_id: "",
        google_drive_folder_id: "",
        google_drive_enabled: false,
      });
    } catch (err: any) {
      console.error("Error in handleCreateOrg:", err);
      toast.error(`Error inesperado: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const roleLabels: Record<string, string> = {
    owner: "Propietario",
    admin: "Administrador",
    member: "Miembro",
    viewer: "Observador",
  };

  const roleDescriptions: Record<string, string> = {
    owner: "Control total: puede eliminar la empresa y gestionar todos los aspectos",
    admin: "Gestión completa: puede editar configuración y gestionar miembros",
    member: "Edición de contenido: puede crear y editar documentos y proveedores",
    viewer: "Solo lectura: puede ver toda la información sin editar",
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/dashboard">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Volver
              </Link>
            </Button>
            <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
              <FileText className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Gestión de Empresa</h1>
              <p className="text-xs text-muted-foreground">
                {orgDetails?.name || "Cargando..."}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <Tabs defaultValue="info" className="space-y-6">
            <TabsList>
              <TabsTrigger value="info">Información</TabsTrigger>
              <TabsTrigger value="members">Miembros</TabsTrigger>
              <TabsTrigger value="all-orgs">Todas las Empresas</TabsTrigger>
            </TabsList>

            <TabsContent value="info">
              <Card className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold">Información de la Empresa</h2>
                  <Button
                    onClick={() => {
                      setDialogType("edit-org");
                      setIsDialogOpen(true);
                    }}
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    Editar
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Nombre</p>
                    <p className="font-medium">{orgDetails?.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Cédula Jurídica</p>
                    <p className="font-medium">{orgDetails?.tax_id || "No configurado"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Correo</p>
                    <p className="font-medium">{orgDetails?.email || "No configurado"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">QuickBooks Company ID</p>
                    <p className="font-medium">{orgDetails?.qbo_company_id || "No configurado"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Google Drive Folder ID</p>
                    <p className="font-medium">{orgDetails?.google_drive_folder_id || "No configurado"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Sincronización Google Drive</p>
                    <Badge variant={orgDetails?.google_drive_enabled ? "default" : "secondary"}>
                      {orgDetails?.google_drive_enabled ? "Activada" : "Desactivada"}
                    </Badge>
                  </div>
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="members">
              <Card className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold">Miembros del Equipo</h2>
                  <Button
                    onClick={() => {
                      setDialogType("add-member");
                      setIsDialogOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Invitar Miembro
                  </Button>
                </div>

                {/* Invitaciones Pendientes */}
                {pendingInvitations.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-semibold mb-3 text-muted-foreground">Invitaciones Pendientes</h3>
                    <div className="space-y-2">
                      {pendingInvitations.map((invitation) => (
                        <div 
                          key={invitation.id}
                          className="flex items-center justify-between p-3 border rounded-lg bg-muted/30"
                        >
                          <div>
                            <p className="font-medium">{invitation.email}</p>
                            <p className="text-xs text-muted-foreground">
                              Rol: {roleLabels[invitation.role]} • Expira: {new Date(invitation.expires_at).toLocaleDateString()}
                            </p>
                          </div>
                          <Badge variant="secondary">Pendiente</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Miembros Activos */}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Usuario</TableHead>
                      <TableHead>Correo</TableHead>
                      <TableHead>Rol</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                          No hay miembros
                        </TableCell>
                      </TableRow>
                    ) : (
                      members.map((member) => (
                        <TableRow key={member.id}>
                          <TableCell className="font-medium">
                            {member.profiles.full_name || "Sin nombre"}
                          </TableCell>
                          <TableCell>{member.profiles.email}</TableCell>
                           <TableCell>
                            <div className="flex flex-col gap-1">
                              <Badge variant={member.role === "owner" ? "default" : "secondary"}>
                                {roleLabels[member.role]}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {roleDescriptions[member.role]}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {member.role !== "owner" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveMember(member.id)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </Card>
            </TabsContent>

            <TabsContent value="all-orgs">
              <Card className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold">Todas las Empresas</h2>
                  <Button
                    onClick={() => {
                      setDialogType("create-org");
                      setOrgFormData({
                        name: "",
                        tax_id: "",
                        email: "",
                        qbo_company_id: "",
                        google_drive_folder_id: "",
                        google_drive_enabled: false,
                      });
                      setIsDialogOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Crear Nueva Empresa
                  </Button>
                </div>

                <div className="space-y-3">
                  {userOrgs.map((org) => (
                    <Card 
                      key={org.id} 
                      className={`p-4 ${org.id === activeOrganization ? 'border-primary' : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold">{org.name}</h3>
                          <p className="text-sm text-muted-foreground capitalize">{org.role}</p>
                        </div>
                        {org.id === activeOrganization && (
                          <Badge>Activa</Badge>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </main>

      {/* Dialog para editar organización */}
      <Dialog open={isDialogOpen && dialogType === "edit-org"} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Información de Empresa</DialogTitle>
            <DialogDescription>Actualice los datos de su organización</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org-name">
                Nombre <span className="text-destructive">*</span>
              </Label>
              <Input
                id="org-name"
                value={orgFormData.name}
                onChange={(e) => setOrgFormData({ ...orgFormData, name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-tax-id">Cédula Jurídica</Label>
              <Input
                id="org-tax-id"
                value={orgFormData.tax_id}
                onChange={(e) => setOrgFormData({ ...orgFormData, tax_id: e.target.value })}
                placeholder="3-101-123456"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-email">Correo</Label>
              <Input
                id="org-email"
                type="email"
                value={orgFormData.email}
                onChange={(e) => setOrgFormData({ ...orgFormData, email: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-qbo">QuickBooks Company ID</Label>
              <Input
                id="org-qbo"
                value={orgFormData.qbo_company_id}
                onChange={(e) =>
                  setOrgFormData({ ...orgFormData, qbo_company_id: e.target.value })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-drive-folder">Google Drive Folder ID</Label>
              <Input
                id="org-drive-folder"
                value={orgFormData.google_drive_folder_id}
                onChange={(e) =>
                  setOrgFormData({ ...orgFormData, google_drive_folder_id: e.target.value })
                }
                placeholder="1zXPJYdXOBwnpal6AgYO11K6RKSKPtlV0"
              />
              <p className="text-xs text-muted-foreground">
                ID de la carpeta en Google Drive para sincronizar documentos
              </p>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="org-drive-enabled">Sincronización Google Drive</Label>
                <p className="text-xs text-muted-foreground">
                  Activar sincronización automática de documentos
                </p>
              </div>
              <Switch
                id="org-drive-enabled"
                checked={orgFormData.google_drive_enabled}
                onCheckedChange={(checked) =>
                  setOrgFormData({ ...orgFormData, google_drive_enabled: checked })
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleUpdateOrg} disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                "Guardar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog para crear organización */}
      <Dialog open={isDialogOpen && dialogType === "create-org"} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear Nueva Empresa</DialogTitle>
            <DialogDescription>Cree una nueva organización para gestionar</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-org-name">
                Nombre <span className="text-destructive">*</span>
              </Label>
              <Input
                id="new-org-name"
                value={orgFormData.name}
                onChange={(e) => setOrgFormData({ ...orgFormData, name: e.target.value })}
                placeholder="Mi Nueva Empresa"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-org-email">Correo</Label>
              <Input
                id="new-org-email"
                type="email"
                value={orgFormData.email}
                onChange={(e) => setOrgFormData({ ...orgFormData, email: e.target.value })}
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

      {/* Dialog para invitar miembro */}
      <Dialog open={isDialogOpen && dialogType === "add-member"} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invitar Miembro</DialogTitle>
            <DialogDescription>
              Enviaremos una invitación por correo electrónico
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="member-email">
                Correo del Usuario <span className="text-destructive">*</span>
              </Label>
              <Input
                id="member-email"
                type="email"
                value={newMemberEmail}
                onChange={(e) => setNewMemberEmail(e.target.value)}
                placeholder="usuario@ejemplo.cr"
              />
              <p className="text-xs text-muted-foreground">
                Se enviará una invitación por email que expirará en 7 días
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="member-role">Rol</Label>
              <Select value={newMemberRole} onValueChange={setNewMemberRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">
                    <div className="flex flex-col">
                      <span className="font-medium">Observador</span>
                      <span className="text-xs text-muted-foreground">Solo lectura</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="member">
                    <div className="flex flex-col">
                      <span className="font-medium">Miembro</span>
                      <span className="text-xs text-muted-foreground">Puede crear y editar contenido</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="admin">
                    <div className="flex flex-col">
                      <span className="font-medium">Administrador</span>
                      <span className="text-xs text-muted-foreground">Gestión completa excepto eliminar empresa</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {roleDescriptions[newMemberRole]}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleAddMember} disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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

export default Organizations;
