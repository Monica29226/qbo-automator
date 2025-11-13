import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Link, Loader2 } from "lucide-react";

export const AssignVendorsToDocuments = () => {
  const { activeOrganization } = useAuth();
  const [isAssigning, setIsAssigning] = useState(false);

  const handleAssign = async () => {
    if (!activeOrganization) return;

    setIsAssigning(true);
    toast.info("Asignando vendors a documentos pendientes...");

    try {
      // 1. Obtener todos los vendors activos
      const { data: vendors, error: vendorsError } = await supabase
        .from("vendors")
        .select("id, vendor_tax_id")
        .eq("organization_id", activeOrganization)
        .eq("is_active", true);

      if (vendorsError) throw vendorsError;

      if (!vendors || vendors.length === 0) {
        toast.error("No hay vendors creados");
        return;
      }

      // 2. Crear un mapa de tax_id -> vendor_id
      const vendorMap = new Map(
        vendors.map(v => [v.vendor_tax_id, v.id])
      );

      // 3. Obtener documentos pendientes sin vendor
      const { data: docs, error: docsError } = await supabase
        .from("processed_documents")
        .select("id, supplier_tax_id")
        .eq("organization_id", activeOrganization)
        .eq("status", "pending")
        .is("vendor_id", null)
        .not("supplier_tax_id", "is", null);

      if (docsError) throw docsError;

      if (!docs || docs.length === 0) {
        toast.info("No hay documentos para asignar");
        return;
      }

      // 4. Asignar vendor_id a cada documento que tenga un vendor matching
      let assigned = 0;
      let notFound = 0;

      for (const doc of docs) {
        const vendorId = vendorMap.get(doc.supplier_tax_id);
        
        if (vendorId) {
          const { error: updateError } = await supabase
            .from("processed_documents")
            .update({ 
              vendor_id: vendorId,
              status: "processed" // Cambiar a processed para que pueda publicarse
            })
            .eq("id", doc.id);

          if (!updateError) {
            assigned++;
          }
        } else {
          notFound++;
        }
      }

      if (assigned > 0) {
        toast.success(`✓ ${assigned} documentos asignados y listos para publicar`);
      }
      
      if (notFound > 0) {
        toast.warning(`${notFound} documentos sin vendor correspondiente`);
      }

      // Recargar página después de 2 segundos
      setTimeout(() => {
        window.location.reload();
      }, 2000);

    } catch (error) {
      console.error("Error assigning vendors:", error);
      toast.error("Error al asignar vendors");
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <Button
      onClick={handleAssign}
      disabled={isAssigning}
      variant="outline"
      className="w-full"
    >
      {isAssigning ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Asignando...
        </>
      ) : (
        <>
          <Link className="h-4 w-4 mr-2" />
          Asignar Vendors a Documentos
        </>
      )}
    </Button>
  );
};
