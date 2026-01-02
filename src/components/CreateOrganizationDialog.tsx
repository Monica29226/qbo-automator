import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Building2, MapPin, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface CreateOrganizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (organizationId: string) => void;
}

interface OrganizationFormData {
  name: string;
  identification_type: string;
  identification_number: string;
  trade_name: string;
  legal_name: string;
  tax_regime: string;
  main_economic_activity: string;
  economic_activity_code: string;
  hacienda_notification_email: string;
  email: string;
  phone: string;
  province: string;
  canton: string;
  district: string;
  exact_address: string;
}

const initialFormData: OrganizationFormData = {
  name: "",
  identification_type: "",
  identification_number: "",
  trade_name: "",
  legal_name: "",
  tax_regime: "",
  main_economic_activity: "",
  economic_activity_code: "",
  hacienda_notification_email: "",
  email: "",
  phone: "",
  province: "",
  canton: "",
  district: "",
  exact_address: "",
};

const PROVINCES = [
  "San José",
  "Alajuela",
  "Cartago",
  "Heredia",
  "Guanacaste",
  "Puntarenas",
  "Limón",
];

export function CreateOrganizationDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateOrganizationDialogProps) {
  const { setActiveOrganizationLocal } = useAuth();
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState<OrganizationFormData>(initialFormData);

  const handleInputChange = (field: keyof OrganizationFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // Validar cédula según tipo de identificación
  const validateIdentification = (type: string, number: string): string | null => {
    if (!number) return null; // Es opcional
    
    // Limpiar guiones y espacios
    const cleanNumber = number.replace(/[-\s]/g, "");
    
    if (type === "juridica") {
      if (!/^\d{10}$/.test(cleanNumber)) {
        return "La cédula jurídica debe tener exactamente 10 dígitos";
      }
    } else if (type === "fisica") {
      if (!/^\d{9}$/.test(cleanNumber)) {
        return "La cédula física debe tener exactamente 9 dígitos";
      }
    } else if (type === "dimex") {
      if (!/^\d{11,12}$/.test(cleanNumber)) {
        return "El DIMEX debe tener 11 o 12 dígitos";
      }
    } else if (type === "nite") {
      if (!/^\d{10}$/.test(cleanNumber)) {
        return "El NITE debe tener exactamente 10 dígitos";
      }
    }
    
    return null;
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      toast.error("El nombre de la empresa es requerido");
      return;
    }

    // Validar identificación si está presente
    if (formData.identification_number && formData.identification_type) {
      const validationError = validateIdentification(formData.identification_type, formData.identification_number);
      if (validationError) {
        toast.error(validationError);
        return;
      }
    }

    setIsCreating(true);

    try {
      const { data, error } = await supabase.functions.invoke("create-organization", {
        body: formData,
      });

      if (error) {
        console.error("Error creating organization:", error);
        toast.error(error.message || "Error al crear la empresa");
        return;
      }

      if (data?.error) {
        toast.error(data.error);
        return;
      }

      const organizationId = data.organization_id;
      
      // Update local state
      setActiveOrganizationLocal(organizationId);
      
      toast.success("Empresa creada exitosamente");
      setFormData(initialFormData);
      onOpenChange(false);
      
      if (onSuccess) {
        onSuccess(organizationId);
      }
    } catch (error: any) {
      console.error("Error:", error);
      toast.error("Error de conexión. Verifica tu internet.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    if (!isCreating) {
      setFormData(initialFormData);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Crear Nueva Empresa
          </DialogTitle>
          <DialogDescription>
            Ingresa la información de tu empresa según los requisitos de factura electrónica de Costa Rica (Ley 9635).
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="fiscal">Fiscal</TabsTrigger>
            <TabsTrigger value="ubicacion">Ubicación</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4 mt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Nombre de la Empresa *</Label>
                <Input
                  id="name"
                  placeholder="Mi Empresa S.A."
                  value={formData.name}
                  onChange={(e) => handleInputChange("name", e.target.value)}
                  disabled={isCreating}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="trade_name">Nombre Comercial</Label>
                <Input
                  id="trade_name"
                  placeholder="Nombre comercial"
                  value={formData.trade_name}
                  onChange={(e) => handleInputChange("trade_name", e.target.value)}
                  disabled={isCreating}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="legal_name">Razón Social</Label>
              <Input
                id="legal_name"
                placeholder="Razón social completa"
                value={formData.legal_name}
                onChange={(e) => handleInputChange("legal_name", e.target.value)}
                disabled={isCreating}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="email">Correo Electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="empresa@ejemplo.cr"
                  value={formData.email}
                  onChange={(e) => handleInputChange("email", e.target.value)}
                  disabled={isCreating}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Teléfono</Label>
                <Input
                  id="phone"
                  placeholder="+506 2222-2222"
                  value={formData.phone}
                  onChange={(e) => handleInputChange("phone", e.target.value)}
                  disabled={isCreating}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="fiscal" className="space-y-4 mt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="identification_type">Tipo de Identificación</Label>
                <Select
                  value={formData.identification_type}
                  onValueChange={(value) => handleInputChange("identification_type", value)}
                  disabled={isCreating}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fisica">Cédula Física</SelectItem>
                    <SelectItem value="juridica">Cédula Jurídica</SelectItem>
                    <SelectItem value="nite">NITE</SelectItem>
                    <SelectItem value="dimex">DIMEX</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="identification_number">Número de Identificación</Label>
                <Input
                  id="identification_number"
                  placeholder="3-101-123456"
                  value={formData.identification_number}
                  onChange={(e) => handleInputChange("identification_number", e.target.value)}
                  disabled={isCreating}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="tax_regime">Régimen Tributario</Label>
                <Select
                  value={formData.tax_regime}
                  onValueChange={(value) => handleInputChange("tax_regime", value)}
                  disabled={isCreating}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar régimen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General</SelectItem>
                    <SelectItem value="simplificado">Simplificado</SelectItem>
                    <SelectItem value="agropecuario">Agropecuario</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="economic_activity_code">Código Actividad Económica</Label>
                <Input
                  id="economic_activity_code"
                  placeholder="620101"
                  value={formData.economic_activity_code}
                  onChange={(e) => handleInputChange("economic_activity_code", e.target.value)}
                  disabled={isCreating}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="main_economic_activity">Actividad Económica Principal</Label>
              <Input
                id="main_economic_activity"
                placeholder="Descripción de la actividad"
                value={formData.main_economic_activity}
                onChange={(e) => handleInputChange("main_economic_activity", e.target.value)}
                disabled={isCreating}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="hacienda_notification_email">Correo para Notificaciones Hacienda</Label>
              <Input
                id="hacienda_notification_email"
                type="email"
                placeholder="hacienda@empresa.cr"
                value={formData.hacienda_notification_email}
                onChange={(e) => handleInputChange("hacienda_notification_email", e.target.value)}
                disabled={isCreating}
              />
            </div>
          </TabsContent>

          <TabsContent value="ubicacion" className="space-y-4 mt-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="province">Provincia</Label>
                <Select
                  value={formData.province}
                  onValueChange={(value) => handleInputChange("province", value)}
                  disabled={isCreating}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Provincia" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVINCES.map((prov) => (
                      <SelectItem key={prov} value={prov}>
                        {prov}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="canton">Cantón</Label>
                <Input
                  id="canton"
                  placeholder="Cantón"
                  value={formData.canton}
                  onChange={(e) => handleInputChange("canton", e.target.value)}
                  disabled={isCreating}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="district">Distrito</Label>
                <Input
                  id="district"
                  placeholder="Distrito"
                  value={formData.district}
                  onChange={(e) => handleInputChange("district", e.target.value)}
                  disabled={isCreating}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="exact_address">Dirección Exacta</Label>
              <Textarea
                id="exact_address"
                placeholder="Descripción detallada de la ubicación"
                value={formData.exact_address}
                onChange={(e) => handleInputChange("exact_address", e.target.value)}
                disabled={isCreating}
                rows={3}
              />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={handleClose} disabled={isCreating}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={isCreating}>
            {isCreating ? (
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
  );
}
