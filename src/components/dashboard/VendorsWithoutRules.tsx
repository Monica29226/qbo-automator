import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, FileSpreadsheet, ExternalLink, Download, Settings } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { VendorConfigurationModal } from "./VendorConfigurationModal";

interface VendorError {
  supplier_name: string;
  supplier_tax_id: string | null;
  facturas_count: number;
  sample_doc_number: string;
  error_type: string;
  document_ids?: string[];
}

export const VendorsWithoutRules = () => {
  const { activeOrganization } = useAuth();
  const [vendors, setVendors] = useState<VendorError[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedVendor, setSelectedVendor] = useState<VendorError | null>(null);

  useEffect(() => {
    if (activeOrganization) {
      fetchVendorsWithoutRules();
    }
  }, [activeOrganization]);

  const fetchVendorsWithoutRules = async () => {
    if (!activeOrganization) return;

    setIsLoading(true);
    try {
      // Obtener documentos en error o pending_config
      const { data: errorDocs, error } = await supabase
        .from("processed_documents")
        .select("id, supplier_name, supplier_tax_id, doc_number, error_message, status")
        .eq("organization_id", activeOrganization)
        .in("status", ["error", "pending_config"]);

      if (error) throw error;

      // Agrupar por proveedor y tipo de error
      const vendorMap = new Map<string, VendorError>();
      
      errorDocs?.forEach((doc) => {
        const key = doc.supplier_name;
        const existing = vendorMap.get(key);
        
        // Determinar tipo de error
        let errorType = "Otro";
        if (doc.status === "pending_config" || doc.error_message?.includes("sin cuenta contable")) {
          errorType = "Sin cuenta contable";
        } else if (doc.error_message?.includes("No se pudo determinar cuenta contable")) {
          errorType = "Sin cuenta contable";
        } else if (doc.error_message?.includes("Max retries reached")) {
          errorType = "Reintentos agotados";
        } else if (doc.error_message?.includes("Gmail")) {
          errorType = "Error Gmail";
        } else if (doc.error_message?.includes("QuickBooks") || doc.error_message?.includes("QBO")) {
          errorType = "Error QuickBooks";
        }
        
        if (existing) {
          existing.facturas_count++;
          existing.document_ids?.push(doc.id);
        } else {
          vendorMap.set(key, {
            supplier_name: doc.supplier_name,
            supplier_tax_id: doc.supplier_tax_id,
            facturas_count: 1,
            sample_doc_number: doc.doc_number,
            error_type: errorType,
            document_ids: [doc.id],
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

  const exportToExcel = () => {
    if (vendors.length === 0) {
      toast.error("No hay proveedores para exportar");
      return;
    }

    // Crear datos para Excel
    const excelData = vendors.map((vendor) => ({
      "Proveedor": vendor.supplier_name,
      "RUC": vendor.supplier_tax_id || "",
      "Facturas Afectadas": vendor.facturas_count,
      "Tipo de Error": vendor.error_type,
      "Código Contable": "", // Vacío para que el usuario lo llene
      "Descripción Cuenta": "", // Vacío para que el usuario lo llene
    }));

    // Crear workbook
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Proveedores");

    // Ajustar anchos de columna
    worksheet['!cols'] = [
      { wch: 50 }, // Proveedor
      { wch: 15 }, // RUC
      { wch: 18 }, // Facturas Afectadas
      { wch: 20 }, // Tipo de Error
      { wch: 15 }, // Código Contable
      { wch: 40 }, // Descripción Cuenta
    ];

    // Descargar
    XLSX.writeFile(workbook, `proveedores-sin-reglas-${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success(`Exportado ${vendors.length} proveedores a Excel`);
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
          <h3 className="text-lg font-semibold">Proveedores con Errores</h3>
        </div>
        <Badge variant="destructive">{vendors.length}</Badge>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        Proveedores con facturas en error. Los que tienen "Sin cuenta contable" necesitan reglas de clasificación.
      </p>

      <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
        {vendors.map((vendor, index) => (
          <div
            key={index}
            className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border"
          >
            <div className="flex-1">
              <p className="font-medium text-sm">{vendor.supplier_name}</p>
              <div className="flex items-center gap-2 mt-1">
                {vendor.supplier_tax_id && (
                  <p className="text-xs text-muted-foreground">RUC: {vendor.supplier_tax_id}</p>
                )}
                <Badge 
                  variant={vendor.error_type === "Sin cuenta contable" ? "destructive" : "secondary"}
                  className="text-xs"
                >
                  {vendor.error_type}
                </Badge>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="ml-2">
                {vendor.facturas_count} {vendor.facturas_count === 1 ? "factura" : "facturas"}
              </Badge>
              {vendor.error_type === "Sin cuenta contable" && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setSelectedVendor(vendor)}
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Configurar
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mb-4">
        <Button asChild className="flex-1">
          <Link to="/vendor-rules" className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Configurar Reglas
          </Link>
        </Button>
        <Button variant="secondary" onClick={exportToExcel} className="flex items-center gap-2">
          <Download className="h-4 w-4" />
          Exportar Excel
        </Button>
        <Button variant="outline" onClick={fetchVendorsWithoutRules}>
          <ExternalLink className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-4 p-3 bg-muted/30 rounded-lg border border-dashed">
        <p className="text-xs text-muted-foreground">
          <strong>Tip:</strong> Para proveedores sin cuenta contable, haga clic en "Configurar" para agregar 
          la cuenta y publicar automáticamente en QuickBooks.
        </p>
      </div>

      {selectedVendor && (
        <VendorConfigurationModal
          isOpen={!!selectedVendor}
          onClose={() => setSelectedVendor(null)}
          vendor={selectedVendor}
          onConfigured={fetchVendorsWithoutRules}
        />
      )}
    </Card>
  );
};
