import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, FileSpreadsheet, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

interface VendorError {
  supplier_name: string;
  supplier_tax_id: string | null;
  facturas_count: number;
  sample_doc_number: string;
}

export const VendorsWithoutRules = () => {
  const { activeOrganization } = useAuth();
  const [vendors, setVendors] = useState<VendorError[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (activeOrganization) {
      fetchVendorsWithoutRules();
    }
  }, [activeOrganization]);

  const fetchVendorsWithoutRules = async () => {
    if (!activeOrganization) return;

    setIsLoading(true);
    try {
      // Obtener documentos en error
      const { data: errorDocs, error } = await supabase
        .from("processed_documents")
        .select("supplier_name, supplier_tax_id, doc_number, error_message")
        .eq("organization_id", activeOrganization)
        .eq("status", "error");

      if (error) throw error;

      // Filtrar solo los que tienen error de cuenta contable
      const accountErrors = errorDocs?.filter(
        (doc) =>
          doc.error_message?.includes("No se pudo determinar cuenta contable") ||
          doc.error_message?.includes("account") ||
          doc.error_message?.includes("classification")
      );

      // Agrupar por proveedor
      const vendorMap = new Map<string, VendorError>();
      
      accountErrors?.forEach((doc) => {
        const key = doc.supplier_name;
        const existing = vendorMap.get(key);
        
        if (existing) {
          existing.facturas_count++;
        } else {
          vendorMap.set(key, {
            supplier_name: doc.supplier_name,
            supplier_tax_id: doc.supplier_tax_id,
            facturas_count: 1,
            sample_doc_number: doc.doc_number,
          });
        }
      });

      setVendors(Array.from(vendorMap.values()).sort((a, b) => b.facturas_count - a.facturas_count));
    } catch (error) {
      console.error("Error fetching vendors without rules:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertCircle className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">Proveedores sin Reglas</h3>
        </div>
        <p className="text-sm text-muted-foreground">Cargando...</p>
      </Card>
    );
  }

  if (vendors.length === 0) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertCircle className="h-5 w-5 text-success" />
          <h3 className="text-lg font-semibold">Proveedores sin Reglas</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          ✓ Todos los proveedores tienen reglas de clasificación configuradas
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-destructive" />
          <h3 className="text-lg font-semibold">Proveedores sin Reglas de Clasificación</h3>
        </div>
        <Badge variant="destructive">{vendors.length}</Badge>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        Estos proveedores tienen facturas que fallan porque no tienen una cuenta contable asignada.
        Agrega reglas de clasificación para resolverlo.
      </p>

      <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
        {vendors.map((vendor, index) => (
          <div
            key={index}
            className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border"
          >
            <div className="flex-1">
              <p className="font-medium text-sm">{vendor.supplier_name}</p>
              {vendor.supplier_tax_id && (
                <p className="text-xs text-muted-foreground">RUC: {vendor.supplier_tax_id}</p>
              )}
            </div>
            <Badge variant="outline" className="ml-2">
              {vendor.facturas_count} {vendor.facturas_count === 1 ? "factura" : "facturas"}
            </Badge>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Button asChild className="flex-1">
          <Link to="/vendor-rules" className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Configurar Reglas
          </Link>
        </Button>
        <Button variant="outline" onClick={fetchVendorsWithoutRules}>
          <ExternalLink className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-4 p-3 bg-muted/30 rounded-lg border border-dashed">
        <p className="text-xs text-muted-foreground">
          <strong>Tip:</strong> Crea un Excel con columnas: Proveedor | Código Contable (ej: "5105: Alimentos")
        </p>
      </div>
    </Card>
  );
};
