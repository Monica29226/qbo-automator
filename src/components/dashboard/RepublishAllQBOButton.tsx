import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { RefreshCw, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const RepublishAllQBOButton = () => {
  const { activeOrganization } = useAuth();
  const [isRepublishing, setIsRepublishing] = useState(false);

  const handleRepublish = async () => {
    if (!activeOrganization) return;

    setIsRepublishing(true);
    toast.info("Republicando todas las facturas con IVA corregido...");

    try {
      // 1. Obtener todas las facturas publicadas en QuickBooks
      const { data: publishedDocs, error: fetchError } = await supabase
        .from("processed_documents")
        .select("id, doc_number, qbo_entity_id, qbo_entity_type")
        .eq("organization_id", activeOrganization)
        .not("qbo_entity_id", "is", null);

      if (fetchError) throw fetchError;

      if (!publishedDocs || publishedDocs.length === 0) {
        toast.info("No hay facturas publicadas para republicar");
        return;
      }

      toast.info(`Encontradas ${publishedDocs.length} facturas. Borrando de QuickBooks...`);

      // 2. Borrar todas de QuickBooks
      const billIds = publishedDocs
        .filter(doc => doc.qbo_entity_id)
        .map(doc => doc.qbo_entity_id);

      if (billIds.length > 0) {
        const { error: deleteError } = await supabase.functions.invoke(
          "delete-bills-from-quickbooks",
          {
            body: { 
              organization_id: activeOrganization,
              bill_ids: billIds 
            },
          }
        );

        if (deleteError) {
          console.error("Error deleting bills:", deleteError);
          throw new Error("Error al borrar facturas de QuickBooks");
        }

        toast.success(`✓ ${billIds.length} facturas borradas de QuickBooks`);
      }

      // 3. Limpiar qbo_entity_id en la base de datos
      const { error: clearError } = await supabase
        .from("processed_documents")
        .update({
          qbo_entity_id: null,
          qbo_entity_type: null,
          error_message: null,
          status: "processed",
        })
        .in("id", publishedDocs.map(doc => doc.id));

      if (clearError) throw clearError;

      toast.info("Republicando facturas con IVA corregido...");

      // 4. Republicar todas las facturas
      const { data: publishData, error: publishError } = await supabase.functions.invoke(
        "publish-to-quickbooks",
        {
          body: { organization_id: activeOrganization },
        }
      );

      if (publishError) throw publishError;

      const published = publishData?.published || 0;
      const failed = publishData?.failed || 0;

      if (published > 0) {
        toast.success(
          `✅ Republicación completada: ${published} facturas con IVA corregido${
            failed > 0 ? ` (${failed} fallidas)` : ""
          }`
        );
      } else if (failed > 0) {
        toast.error(`❌ No se pudo republicar ninguna factura (${failed} errores)`);
      }

      // Recargar la página para reflejar los cambios
      setTimeout(() => {
        window.location.reload();
      }, 2000);

    } catch (error) {
      console.error("Error republishing bills:", error);
      toast.error("Error al republicar facturas");
    } finally {
      setIsRepublishing(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="default"
          className="w-full"
          disabled={isRepublishing}
        >
          {isRepublishing ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Republicando...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Republicar Todas con IVA Corregido
            </>
          )}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Republicar todas las facturas?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción:
            <br />
            1. Borrará TODAS las facturas de QuickBooks
            <br />
            2. Las republicará con el IVA corregido
            <br />
            <br />
            Esto puede tomar varios minutos. ¿Deseas continuar?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleRepublish}>
            Sí, Republicar Todas
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
