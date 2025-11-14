import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Upload, Loader2 } from "lucide-react";
import { PublishValidationDialog } from "./PublishValidationDialog";

export const PublishAllProcessedButton = () => {
  const { activeOrganization } = useAuth();
  const [isPublishing, setIsPublishing] = useState(false);
  const [showValidation, setShowValidation] = useState(false);

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
    <>
      <PublishValidationDialog
        open={showValidation}
        onOpenChange={setShowValidation}
        onConfirm={handlePublishAll}
      />
      
      <Button
        variant="default"
        size="sm"
        className="bg-green-600 hover:bg-green-700"
        onClick={() => setShowValidation(true)}
        disabled={isPublishing}
      >
        {isPublishing ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Publicando...
          </>
        ) : (
          <>
            <Upload className="h-4 w-4 mr-2" />
            Publicar Todos a QBO
          </>
        )}
      </Button>
    </>
  );
};
