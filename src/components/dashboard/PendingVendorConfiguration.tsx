import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Settings, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { VendorConfigurationModal } from "./VendorConfigurationModal";
import { toast } from "sonner";

interface PendingVendor {
  supplier_name: string;
  supplier_tax_id: string | null;
  facturas_count: number;
  document_ids: string[];
}

export const PendingVendorConfiguration = () => {
  const { activeOrganization } = useAuth();
  const [pendingVendors, setPendingVendors] = useState<PendingVendor[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<PendingVendor | null>(null);

  useEffect(() => {
    if (activeOrganization) {
      fetchPendingVendors();
    }
  }, [activeOrganization]);

  const fetchPendingVendors = async () => {
    if (!activeOrganization) return;

    setIsLoading(true);
    try {
      // Buscar documentos que necesitan configuración de proveedor
      const { data: docs, error } = await supabase
        .from("processed_documents")
        .select("id, supplier_name, supplier_tax_id, doc_number")
        .eq("organization_id", activeOrganization)
        .eq("status", "pending_config");

      if (error) throw error;

      // Agrupar por proveedor
      const vendorMap = new Map<string, PendingVendor>();
      
      docs?.forEach((doc) => {
        const key = doc.supplier_name;
        const existing = vendorMap.get(key);
        
        if (existing) {
          existing.facturas_count++;
          existing.document_ids.push(doc.id);
        } else {
          vendorMap.set(key, {
            supplier_name: doc.supplier_name,
            supplier_tax_id: doc.supplier_tax_id,
            facturas_count: 1,
            document_ids: [doc.id],
          });
        }
      });

      setPendingVendors(Array.from(vendorMap.values()));
    } catch (error) {
      console.error("Error fetching pending vendors:", error);
      toast.error("Error al cargar proveedores pendientes");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVendorConfigured = () => {
    fetchPendingVendors();
    setSelectedVendor(null);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Proveedores Nuevos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Cargando...</p>
        </CardContent>
      </Card>
    );
  }

  if (pendingVendors.length === 0) {
    return null; // No mostrar si no hay proveedores pendientes
  }

  return (
    <>
      <Card className="border-yellow-500/50 bg-yellow-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
            <AlertCircle className="h-5 w-5" />
            Proveedores Nuevos - Configuración Requerida
          </CardTitle>
          <CardDescription>
            Hay {pendingVendors.length} proveedor{pendingVendors.length !== 1 ? 'es' : ''} nuevo{pendingVendors.length !== 1 ? 's' : ''} que necesitan asignación de cuenta contable
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {pendingVendors.map((vendor) => (
            <div
              key={vendor.supplier_name}
              className="flex items-center justify-between p-3 border border-border rounded-lg bg-background hover:bg-accent/5 transition-colors"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{vendor.supplier_name}</span>
                </div>
                {vendor.supplier_tax_id && (
                  <p className="text-xs text-muted-foreground ml-6">
                    RUC: {vendor.supplier_tax_id}
                  </p>
                )}
                <Badge variant="secondary" className="ml-6 mt-1">
                  {vendor.facturas_count} factura{vendor.facturas_count !== 1 ? 's' : ''}
                </Badge>
              </div>
              <Button
                onClick={() => setSelectedVendor(vendor)}
                size="sm"
                className="gap-2"
              >
                <Settings className="h-4 w-4" />
                Asignar Cuenta
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {selectedVendor && (
        <VendorConfigurationModal
          isOpen={!!selectedVendor}
          onClose={() => setSelectedVendor(null)}
          vendor={selectedVendor}
          onConfigured={handleVendorConfigured}
        />
      )}
    </>
  );
};
