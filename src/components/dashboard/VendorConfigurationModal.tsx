import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Save, CheckCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface VendorConfigurationModalProps {
  isOpen: boolean;
  onClose: () => void;
  vendor: {
    supplier_name: string;
    supplier_tax_id: string | null;
    facturas_count: number;
    document_ids?: string[];
  };
  onConfigured: () => void;
}

export const VendorConfigurationModal = ({
  isOpen,
  onClose,
  vendor,
  onConfigured,
}: VendorConfigurationModalProps) => {
  const { activeOrganization } = useAuth();
  const [accountCode, setAccountCode] = useState("");
  const [accountDescription, setAccountDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!accountCode.trim()) {
      toast.error("Por favor ingrese el código contable");
      return;
    }

    if (!activeOrganization) {
      toast.error("No hay organización activa");
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Guardar en vendor_defaults para futuras facturas
      const { error: defaultsError } = await supabase
        .from("vendor_defaults")
        .upsert({
          organization_id: activeOrganization,
          vendor_name: vendor.supplier_name,
          default_account_ref: accountCode.trim(),
          default_uses_tax: true,
        }, {
          onConflict: "organization_id,vendor_name",
        });

      if (defaultsError) throw defaultsError;

      // 2. Crear regla de clasificación para aplicar automáticamente
      const { error: ruleError } = await supabase
        .from("vendor_classification_rules")
        .upsert({
          organization_id: activeOrganization,
          vendor_name: vendor.supplier_name,
          account_code: accountCode.trim(),
          account_description: accountDescription.trim() || `Configurado manualmente`,
          is_active: true,
        }, {
          onConflict: "organization_id,vendor_name",
        });

      if (ruleError) throw ruleError;

      // 3. Actualizar documentos de pending_config a pending
      const { error: updateError } = await supabase
        .from("processed_documents")
        .update({
          status: "pending",
          error_message: null,
        })
        .eq("organization_id", activeOrganization)
        .eq("supplier_name", vendor.supplier_name)
        .in("status", ["pending_config", "error"]);

      if (updateError) throw updateError;

      // 4. Invocar función de publicación automática
      const { error: publishError } = await supabase.functions.invoke("publish-to-quickbooks", {
        body: {
          organization_id: activeOrganization,
        },
      });

      if (publishError) {
        console.error("Error publishing:", publishError);
        toast.warning("Regla creada exitosamente, pero hubo un error al publicar. Intente de nuevo desde el Log de Pendientes.");
      } else {
        toast.success(
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4" />
            <div>
              <p className="font-semibold">¡Configuración exitosa!</p>
              <p className="text-sm">
                Regla creada para "{vendor.supplier_name}". Se aplicará automáticamente a futuras facturas.
              </p>
            </div>
          </div>,
          { duration: 5000 }
        );
      }

      onConfigured();
      onClose();
    } catch (error) {
      console.error("Error configuring vendor:", error);
      toast.error("Error al configurar proveedor");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Configurar Cuenta Contable</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Proveedor</Label>
            <p className="text-sm text-muted-foreground">{vendor.supplier_name}</p>
            {vendor.supplier_tax_id && (
              <p className="text-xs text-muted-foreground">RUC: {vendor.supplier_tax_id}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Facturas pendientes</Label>
            <p className="text-sm text-muted-foreground">{vendor.facturas_count} factura(s)</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="accountCode" className="text-sm font-medium">
              Código Contable <span className="text-destructive">*</span>
            </Label>
            <Input
              id="accountCode"
              placeholder="Ej: 5105"
              value={accountCode}
              onChange={(e) => setAccountCode(e.target.value)}
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              Ingrese el código de cuenta de QuickBooks
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="accountDescription" className="text-sm font-medium">
              Descripción (opcional)
            </Label>
            <Input
              id="accountDescription"
              placeholder="Ej: Costo de Ventas"
              value={accountDescription}
              onChange={(e) => setAccountDescription(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !accountCode.trim()}
              className="flex-1"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Guardar y Publicar
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
