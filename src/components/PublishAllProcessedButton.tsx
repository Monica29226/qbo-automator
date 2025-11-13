import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Upload, Loader2 } from "lucide-react";
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

export const PublishAllProcessedButton = () => {
  const { activeOrganization } = useAuth();
  const [isPublishing, setIsPublishing] = useState(false);
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  const fetchPendingCount = async () => {
    if (!activeOrganization) return;

    const { count } = await supabase
      .from("processed_documents")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", activeOrganization)
      .eq("status", "processed")
      .is("qbo_entity_id", null);

    setPendingCount(count || 0);
  };

  const handlePublishAll = async () => {
    if (!activeOrganization) {
      toast.error("No hay organización activa");
      return;
    }

    setIsPublishing(true);
    toast.info("Publicando todos los documentos procesados a QuickBooks...");

    try {
      // Obtener todos los documentos procesados sin publicar
      const { data: docs, error: fetchError } = await supabase
        .from("processed_documents")
        .select("id")
        .eq("organization_id", activeOrganization)
        .eq("status", "processed")
        .is("qbo_entity_id", null);

      if (fetchError) throw fetchError;

      if (!docs || docs.length === 0) {
        toast.info("No hay documentos pendientes de publicar");
        return;
      }

      const documentIds = docs.map(d => d.id);
      
      // Publicar en lotes de 20 documentos
      const batchSize = 20;
      let totalPublished = 0;
      let totalFailed = 0;

      for (let i = 0; i < documentIds.length; i += batchSize) {
        const batch = documentIds.slice(i, i + batchSize);
        
        toast.info(`Publicando lote ${Math.floor(i / batchSize) + 1}/${Math.ceil(documentIds.length / batchSize)}...`);

        const { data, error } = await supabase.functions.invoke("publish-to-quickbooks", {
          body: {
            organization_id: activeOrganization,
            document_ids: batch,
          },
        });

        if (error) {
          console.error("Error in batch:", error);
          totalFailed += batch.length;
        } else {
          totalPublished += data.published || 0;
          totalFailed += data.failed || 0;
        }
      }

      if (totalPublished > 0) {
        toast.success(`✓ ${totalPublished} documentos publicados exitosamente a QuickBooks`);
      }
      
      if (totalFailed > 0) {
        toast.warning(`⚠️ ${totalFailed} documentos fallaron al publicar`);
      }

      // Recargar la página después de 2 segundos
      setTimeout(() => window.location.reload(), 2000);
    } catch (error) {
      console.error("Error publishing documents:", error);
      const errorMsg = error instanceof Error ? error.message : "Error desconocido";
      toast.error(`Error: ${errorMsg}`, { duration: 6000 });
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <AlertDialog onOpenChange={(open) => open && fetchPendingCount()}>
      <AlertDialogTrigger asChild>
        <Button
          variant="default"
          size="sm"
          className="bg-green-600 hover:bg-green-700"
        >
          <Upload className="h-4 w-4 mr-2" />
          Publicar Todos a QBO
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Publicar Todos los Documentos Procesados</AlertDialogTitle>
          <AlertDialogDescription>
            {pendingCount !== null ? (
              <>
                Se publicarán <strong>{pendingCount} documentos procesados</strong> que aún no están en QuickBooks.
                <br /><br />
                Este proceso puede tomar varios minutos dependiendo de la cantidad de documentos.
                <br /><br />
                ¿Deseas continuar?
              </>
            ) : (
              "Cargando..."
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPublishing}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={handlePublishAll}
            disabled={isPublishing || pendingCount === 0}
            className="bg-green-600 hover:bg-green-700"
          >
            {isPublishing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Publicando...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Publicar {pendingCount || 0} Documentos
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
