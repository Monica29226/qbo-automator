import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { FileCheck } from "lucide-react";
import { useState } from "react";

export const PublishReviewButton = () => {
  const { activeOrganization } = useAuth();
  const [isPublishing, setIsPublishing] = useState(false);

  const handlePublishReview = async () => {
    if (!activeOrganization) return;

    setIsPublishing(true);
    toast.info("Preparando documentos en revisión para publicar...");

    try {
      // First, update all 'review' documents to 'pending'
      const { error: updateError, count } = await supabase
        .from("processed_documents")
        .update({ status: "pending" })
        .eq("organization_id", activeOrganization)
        .eq("status", "review");

      if (updateError) throw updateError;

      toast.info(`${count || 0} documentos marcados como pendientes`);

      // Now publish all pending documents
      const { data, error } = await supabase.functions.invoke("publish-to-quickbooks", {
        body: { organization_id: activeOrganization },
      });

      if (error) throw error;

      const published = data.published || 0;
      const failed = data.failed || 0;

      if (published > 0) {
        toast.success(
          `✓ ${published} documento${published !== 1 ? 's' : ''} publicado${published !== 1 ? 's' : ''} en QuickBooks${failed > 0 ? ` (${failed} fallidos)` : ''}`
        );
      } else if (failed > 0) {
        toast.error(`No se pudo publicar ningún documento (${failed} errores)`);
      } else {
        toast.info("No hay documentos para publicar");
      }

      // Reload after 2 seconds
      setTimeout(() => {
        window.location.reload();
      }, 2000);

    } catch (error) {
      console.error("Error publishing review documents:", error);
      toast.error("Error al publicar documentos en revisión");
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <Button 
      onClick={handlePublishReview}
      disabled={isPublishing}
      variant="outline"
      className="w-full"
    >
      <FileCheck className="h-4 w-4 mr-2" />
      {isPublishing ? "Publicando..." : "Publicar Documentos en Revisión"}
    </Button>
  );
};
