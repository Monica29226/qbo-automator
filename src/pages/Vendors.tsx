import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AccountCombobox } from "@/components/AccountCombobox";
import { useVendorsData } from "@/hooks/useVendorsData";
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
import { FileText, Plus, Edit, ArrowLeft, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

interface Vendor {
  id: string;
  vendor_name: string;
  vendor_tax_id: string | null;
  vendor_email: string | null;
  qbo_vendor_ref: string;
  default_account_ref: string;
  tax_treatment: string;
  tax_rate: number;
  is_active: boolean;
}

interface QBOAccount {
  id: string;
  name: string;
  accountNumber: string;
  type: string;
}

const Vendors = () => {
  const { isAdmin, activeOrganization } = useAuth();
  const { vendors, isLoading, invalidate } = useVendorsData(activeOrganization);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [qboAccounts, setQboAccounts] = useState<QBOAccount[]>([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [formData, setFormData] = useState({
    vendor_name: "",
    vendor_tax_id: "",
    vendor_email: "",
    qbo_vendor_ref: "",
    default_account_ref: "",
    tax_treatment: "gravado",
    tax_rate: 13,
  });
  const [qboNotConnected, setQboNotConnected] = useState(false);

  const handleSave = async () => {
    if (!formData.vendor_name || !formData.qbo_vendor_ref || !formData.default_account_ref) {
      toast.error("Complete los campos requeridos");
      return;
    }

    if (!activeOrganization) {
      toast.error("No hay organización activa");
      return;
    }

    // DEBUG: Mostrar datos antes de guardar
    console.log("📝 GUARDANDO PROVEEDOR - FormData:", {
      vendor_name: formData.vendor_name,
      vendor_tax_id: formData.vendor_tax_id,
      qbo_vendor_ref: formData.qbo_vendor_ref,
      default_account_ref: formData.default_account_ref,
      tax_treatment: formData.tax_treatment,
      tax_rate: formData.tax_rate,
    });

    if (editingVendor) {
      console.log("📝 Actualizando proveedor ID:", editingVendor.id);
      
      const { data, error } = await supabase
        .from("vendors")
        .update(formData)
        .eq("id", editingVendor.id)
        .select();

      console.log("📝 Respuesta UPDATE:", { data, error });

      if (error) {
        toast.error("Error al actualizar proveedor");
        console.error("❌ Error UPDATE:", error);
      } else {
        console.log("✅ Proveedor actualizado correctamente:", data);
        toast.success("Proveedor actualizado");
        setIsDialogOpen(false);
        invalidate();
      }
    } else {
      console.log("📝 Creando nuevo proveedor para org:", activeOrganization);
      
      const { data, error } = await supabase.from("vendors").insert([{
        ...formData,
        organization_id: activeOrganization,
      }]).select();

      console.log("📝 Respuesta INSERT:", { data, error });

      if (error) {
        toast.error("Error al crear proveedor");
        console.error("❌ Error INSERT:", error);
      } else {
        console.log("✅ Proveedor creado correctamente:", data);
        toast.success("Proveedor creado");
        setIsDialogOpen(false);
        invalidate();
      }
    }
  };

  const fetchQBOAccounts = async () => {
    console.log("🔍 fetchQBOAccounts - activeOrganization:", activeOrganization);
    
    if (!activeOrganization) {
      console.log("❌ No hay organización activa");
      return;
    }
    
    setIsLoadingAccounts(true);
    setQboNotConnected(false);
    
    try {
      // Check if QuickBooks is connected first
      console.log("🔍 Verificando integración de QuickBooks...");
      const { data: qbIntegration, error: qbError } = await supabase
        .from("integration_accounts")
        .select("id, is_active, credentials")
        .eq("organization_id", activeOrganization)
        .eq("service_type", "quickbooks")
        .eq("is_active", true)
        .maybeSingle();

      console.log("📊 qbIntegration:", qbIntegration);
      console.log("📊 qbError:", qbError);

      if (qbError) {
        console.error("❌ Error al verificar integración:", qbError);
        throw new Error("Error al verificar integración de QuickBooks");
      }

      if (!qbIntegration) {
        console.log("⚠️ QuickBooks no está conectado para esta organización");
        setQboNotConnected(true);
        setIsLoadingAccounts(false);
        return;
      }
      
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No session");

      console.log("📡 Llamando a list-quickbooks-accounts...");
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/list-quickbooks-accounts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ organization_id: activeOrganization }),
      });

      console.log("📡 Response status:", response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ Error de Edge Function:", errorText);
        throw new Error(`Error al obtener cuentas: ${response.status}`);
      }

      const result = await response.json();
      console.log("✅ Resultado de list-quickbooks-accounts:", result);
      console.log("📊 Total cuentas:", result.accounts?.length || 0);
      
      setQboAccounts(result.accounts || []);
      
      if (result.accounts?.length === 0) {
        console.log("⚠️ No se encontraron cuentas en QuickBooks");
      }
    } catch (error) {
      console.error("❌ Error fetching QBO accounts:", error);
      toast.error("Error al cargar cuentas de QuickBooks");
    } finally {
      setIsLoadingAccounts(false);
    }
  };

  const openDialog = (vendor?: Vendor) => {
    if (vendor) {
      setEditingVendor(vendor);
      setFormData({
        vendor_name: vendor.vendor_name,
        vendor_tax_id: vendor.vendor_tax_id || "",
        vendor_email: vendor.vendor_email || "",
        qbo_vendor_ref: vendor.qbo_vendor_ref,
        default_account_ref: vendor.default_account_ref,
        tax_treatment: vendor.tax_treatment,
        tax_rate: vendor.tax_rate,
      });
    } else {
      setEditingVendor(null);
      setFormData({
        vendor_name: "",
        vendor_tax_id: "",
        vendor_email: "",
        qbo_vendor_ref: "",
        default_account_ref: "",
        tax_treatment: "gravado",
        tax_rate: 13,
      });
    }
    setIsDialogOpen(true);
    fetchQBOAccounts();
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
              <h1 className="text-xl font-bold text-foreground">Catálogo de Proveedores</h1>
              <p className="text-xs text-muted-foreground">Gestión de proveedores para clasificación automática</p>
            </div>
          </div>
          <Button onClick={() => openDialog()}>
            <Plus className="h-4 w-4 mr-2" />
            Nuevo Proveedor
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <Card className="p-6">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Cédula</TableHead>
                  <TableHead>QBO Ref</TableHead>
                  <TableHead>Cuenta a Registrar</TableHead>
                  <TableHead>Tratamiento IVA</TableHead>
                  <TableHead>Tasa (%)</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No hay proveedores registrados
                    </TableCell>
                  </TableRow>
                ) : (
                  vendors.map((vendor) => (
                    <TableRow key={vendor.id}>
                      <TableCell className="font-medium">{vendor.vendor_name}</TableCell>
                      <TableCell>{vendor.vendor_tax_id || "-"}</TableCell>
                      <TableCell>{vendor.qbo_vendor_ref}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{vendor.default_account_ref}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={vendor.tax_treatment === "gravado" ? "default" : "secondary"}>
                          {vendor.tax_treatment}
                        </Badge>
                      </TableCell>
                      <TableCell>{vendor.tax_rate}%</TableCell>
                      <TableCell>
                        <Badge variant={vendor.is_active ? "default" : "secondary"}>
                          {vendor.is_active ? "Activo" : "Inactivo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => openDialog(vendor)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </Card>
      </main>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingVendor ? "Editar Proveedor" : "Nuevo Proveedor"}
            </DialogTitle>
            <DialogDescription>
              Complete la información del proveedor para clasificación automática
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="vendor_name">
                Nombre <span className="text-destructive">*</span>
              </Label>
              <Input
                id="vendor_name"
                value={formData.vendor_name}
                onChange={(e) => setFormData({ ...formData, vendor_name: e.target.value })}
                placeholder="Proveedor Ejemplo S.A."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="vendor_tax_id">Cédula/Jurídica</Label>
              <Input
                id="vendor_tax_id"
                value={formData.vendor_tax_id}
                onChange={(e) => setFormData({ ...formData, vendor_tax_id: e.target.value })}
                placeholder="3-101-123456"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="vendor_email">Correo</Label>
              <Input
                id="vendor_email"
                type="email"
                value={formData.vendor_email}
                onChange={(e) => setFormData({ ...formData, vendor_email: e.target.value })}
                placeholder="proveedor@ejemplo.cr"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="qbo_vendor_ref">
                QBO VendorRef ID <span className="text-destructive">*</span>
              </Label>
              <Input
                id="qbo_vendor_ref"
                value={formData.qbo_vendor_ref}
                onChange={(e) => setFormData({ ...formData, qbo_vendor_ref: e.target.value })}
                placeholder="123"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="default_account_ref">
                Cuenta a Registrar <span className="text-destructive">*</span>
              </Label>
              {qboNotConnected ? (
                <div className="p-3 border border-destructive/50 bg-destructive/10 rounded-md">
                  <p className="text-sm text-destructive">
                    QuickBooks no está conectado. Vaya a Integraciones para conectar QuickBooks primero.
                  </p>
                </div>
              ) : (
                <AccountCombobox
                  accounts={qboAccounts}
                  value={formData.default_account_ref}
                  onValueChange={(value) => setFormData({ ...formData, default_account_ref: value })}
                  disabled={isLoadingAccounts}
                  className="w-full"
                  placeholder={isLoadingAccounts ? "Cargando cuentas..." : qboAccounts.length === 0 ? "No hay cuentas disponibles" : "Seleccionar cuenta"}
                />
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="tax_treatment">Tratamiento IVA</Label>
              <Select
                value={formData.tax_treatment}
                onValueChange={(value) => setFormData({ ...formData, tax_treatment: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="exento">Exento</SelectItem>
                  <SelectItem value="gravado">Gravado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tax_rate">Tasa IVA (%)</Label>
              <Select
                value={formData.tax_rate.toString()}
                onValueChange={(value) => setFormData({ ...formData, tax_rate: Number(value) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">0%</SelectItem>
                  <SelectItem value="1">1%</SelectItem>
                  <SelectItem value="2">2%</SelectItem>
                  <SelectItem value="4">4%</SelectItem>
                  <SelectItem value="13">13%</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={isLoading}>
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
    </div>
  );
};

export default Vendors;
