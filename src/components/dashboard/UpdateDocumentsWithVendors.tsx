import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { RefreshCw, Loader2 } from "lucide-react";

export const UpdateDocumentsWithVendors = () => {
  const { activeOrganization } = useAuth();
  const [isUpdating, setIsUpdating] = useState(false);

  const handleUpdate = async () => {
    if (!activeOrganization) return;

    setIsUpdating(true);
    toast.info("Actualizando documentos con vendors...");

    try {
      // 1. Obtener todos los documentos con "Gastos por clasificar"
      const { data: docs, error: docsError } = await supabase
        .from("processed_documents")
        .select("id, supplier_tax_id, xml_data")
        .eq("organization_id", activeOrganization)
        .contains("xml_data", { cuentaContable: "Gastos por clasificar" });

      if (docsError) throw docsError;

      if (!docs || docs.length === 0) {
        toast.info("No hay documentos sin clasificar para actualizar");
        return;
      }

      console.log(`📄 Found ${docs.length} documents with "Gastos por clasificar"`);

      // 2. Obtener todos los vendors activos
      const { data: vendors, error: vendorsError } = await supabase
        .from("vendor_categories")
        .select("vendor_identification, account_code")
        .eq("organization_id", activeOrganization)
        .eq("is_active", true);

      if (vendorsError) throw vendorsError;

      console.log(`👥 Found ${vendors?.length || 0} active vendors`);

      // 3. Crear un mapa de vendors para búsqueda rápida
      const vendorMap = new Map(
        vendors?.map(v => [v.vendor_identification, v.account_code]) || []
      );

      // 4. Actualizar documentos que ahora tienen vendor
      let updated = 0;
      let stillUnclassified = 0;

      for (const doc of docs) {
        const accountCode = vendorMap.get(doc.supplier_tax_id);
        
        if (accountCode && accountCode !== "Gastos por clasificar") {
          // Actualizar el documento con la nueva cuenta y cambiar status a 'processed'
          const currentXmlData = doc.xml_data as any;
          const newXmlData = {
            ...currentXmlData,
            cuentaContable: accountCode
          };

          const { error: updateError } = await supabase
            .from("processed_documents")
            .update({
              xml_data: newXmlData,
              status: "processed",
              processed_at: new Date().toISOString()
            })
            .eq("id", doc.id);

          if (updateError) {
            console.error(`Error updating doc ${doc.id}:`, updateError);
          } else {
            updated++;
          }
        } else {
          stillUnclassified++;
        }
      }

      toast.success(
        `✓ ${updated} documentos actualizados. ${stillUnclassified} aún sin clasificar.`
      );

    } catch (error) {
      console.error("Error updating documents:", error);
      toast.error("Error al actualizar documentos");
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Button
      onClick={handleUpdate}
      disabled={isUpdating}
      variant="outline"
      className="w-full"
    >
      {isUpdating ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Actualizando...
        </>
      ) : (
        <>
          <RefreshCw className="h-4 w-4 mr-2" />
          Actualizar Documentos con Vendors
        </>
      )}
    </Button>
  );
};
