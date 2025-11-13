import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Users, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const ExtractMissingVendors = () => {
  const { activeOrganization } = useAuth();
  const [isExtracting, setIsExtracting] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [missingVendors, setMissingVendors] = useState<any[]>([]);

  const handleExtract = async () => {
    if (!activeOrganization) return;

    setIsExtracting(true);
    toast.info("Extrayendo vendors faltantes...");

    try {
      // 1. Obtener todos los documentos únicos por proveedor
      const { data: docs, error: docsError } = await supabase
        .from("processed_documents")
        .select("supplier_name, supplier_tax_id")
        .eq("organization_id", activeOrganization)
        .not("supplier_tax_id", "is", null);

      if (docsError) throw docsError;

      // 2. Obtener vendors existentes
      const { data: existingVendors, error: vendorsError } = await supabase
        .from("vendor_categories")
        .select("vendor_identification")
        .eq("organization_id", activeOrganization);

      if (vendorsError) throw vendorsError;

      const existingIds = new Set(
        existingVendors?.map(v => v.vendor_identification) || []
      );

      // 3. Filtrar vendors únicos que NO están en vendor_categories
      const uniqueVendors = new Map();
      docs?.forEach(doc => {
        if (!existingIds.has(doc.supplier_tax_id)) {
          uniqueVendors.set(doc.supplier_tax_id, {
            tax_id: doc.supplier_tax_id,
            name: doc.supplier_name
          });
        }
      });

      const missing = Array.from(uniqueVendors.values());
      setMissingVendors(missing);
      setShowResult(true);

      toast.success(`Encontrados ${missing.length} vendors faltantes`);

    } catch (error) {
      console.error("Error extracting vendors:", error);
      toast.error("Error al extraer vendors");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleAddAll = async () => {
    if (!activeOrganization || missingVendors.length === 0) return;

    toast.info("Agregando vendors...");

    try {
      const vendorsToInsert = missingVendors.map(v => ({
        organization_id: activeOrganization,
        vendor_identification: v.tax_id,
        vendor_name: v.name,
        account_code: "5105", // Cuenta por defecto
        is_active: true
      }));

      const { error } = await supabase
        .from("vendor_categories")
        .insert(vendorsToInsert);

      if (error) throw error;

      toast.success(`✓ ${missingVendors.length} vendors agregados con cuenta 5105`);
      setShowResult(false);
      setMissingVendors([]);

    } catch (error) {
      console.error("Error adding vendors:", error);
      toast.error("Error al agregar vendors");
    }
  };

  return (
    <>
      <Button
        onClick={handleExtract}
        disabled={isExtracting}
        variant="outline"
        className="w-full"
      >
        {isExtracting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Extrayendo...
          </>
        ) : (
          <>
            <Users className="h-4 w-4 mr-2" />
            Extraer Vendors Faltantes
          </>
        )}
      </Button>

      <Dialog open={showResult} onOpenChange={setShowResult}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Vendors Faltantes ({missingVendors.length})</DialogTitle>
            <DialogDescription>
              Estos proveedores están en tus facturas pero no en vendor_categories
            </DialogDescription>
          </DialogHeader>

          {missingVendors.length > 0 && (
            <div className="space-y-4">
              <div className="max-h-96 overflow-y-auto space-y-2">
                {missingVendors.map((vendor, index) => (
                  <div key={index} className="p-3 border rounded-lg">
                    <div className="font-medium">{vendor.name}</div>
                    <div className="text-sm text-muted-foreground">
                      ID: {vendor.tax_id}
                    </div>
                  </div>
                ))}
              </div>

              <Button onClick={handleAddAll} className="w-full">
                Agregar Todos con Cuenta 5105
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
