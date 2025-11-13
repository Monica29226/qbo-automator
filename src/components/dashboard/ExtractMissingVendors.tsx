import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const [vendorAccounts, setVendorAccounts] = useState<Record<string, string>>({});

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
      
      // Inicializar con cuenta por defecto 5105
      const defaultAccounts: Record<string, string> = {};
      missing.forEach(vendor => {
        defaultAccounts[vendor.tax_id] = "5105";
      });
      setVendorAccounts(defaultAccounts);
      
      setShowResult(true);

      toast.success(`Encontrados ${missing.length} vendors faltantes`);

    } catch (error) {
      console.error("Error extracting vendors:", error);
      toast.error("Error al extraer vendors");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleAccountChange = (taxId: string, accountCode: string) => {
    setVendorAccounts(prev => ({
      ...prev,
      [taxId]: accountCode
    }));
  };

  const handleAddSingle = async (vendor: any) => {
    if (!activeOrganization) return;

    toast.info(`Agregando ${vendor.name}...`);

    try {
      const { error } = await supabase
        .from("vendor_categories")
        .insert({
          organization_id: activeOrganization,
          vendor_identification: vendor.tax_id,
          vendor_name: vendor.name,
          account_code: vendorAccounts[vendor.tax_id] || "5105",
          is_active: true
        });

      if (error) throw error;

      toast.success(`✓ ${vendor.name} agregado`);
      
      // Remover el vendor de la lista
      setMissingVendors(prev => prev.filter(v => v.tax_id !== vendor.tax_id));
      
      // Limpiar la cuenta del vendor
      setVendorAccounts(prev => {
        const newAccounts = { ...prev };
        delete newAccounts[vendor.tax_id];
        return newAccounts;
      });

    } catch (error) {
      console.error("Error adding vendor:", error);
      toast.error(`Error al agregar ${vendor.name}`);
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

          {missingVendors.length > 0 ? (
            <div className="space-y-4">
              <div className="max-h-96 overflow-y-auto space-y-3">
                {missingVendors.map((vendor, index) => (
                  <div key={index} className="p-4 border rounded-lg space-y-3">
                    <div className="font-medium">{vendor.name}</div>
                    <div className="text-sm text-muted-foreground">
                      ID: {vendor.tax_id}
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium whitespace-nowrap">
                        Cuenta:
                      </label>
                      <Input
                        type="text"
                        value={vendorAccounts[vendor.tax_id] || "5105"}
                        onChange={(e) => handleAccountChange(vendor.tax_id, e.target.value)}
                        placeholder="Ej: 5105"
                        className="flex-1"
                      />
                      <Button 
                        onClick={() => handleAddSingle(vendor)}
                        size="sm"
                        className="whitespace-nowrap"
                      >
                        Guardar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No hay vendors pendientes por agregar
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
