import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Upload, Loader2 } from "lucide-react";

interface PublishSingleDocButtonProps {
  docNumber: string;
  documentId: string;
}

export const PublishSingleDocButton = ({ docNumber, documentId }: PublishSingleDocButtonProps) => {
  const { activeOrganization } = useAuth();
  const [isPublishing, setIsPublishing] = useState(false);

  const handlePublish = async () => {
    if (!activeOrganization) {
      toast.error("No hay organización activa");
      return;
    }

    setIsPublishing(true);
    toast.info(`Publicando factura ${docNumber} a QuickBooks...`);

    try {
      // Si el documento está en "review", primero cambiarlo a "pending"
      const { data: currentDoc } = await supabase
        .from("processed_documents")
        .select("status")
        .eq("id", documentId)
        .single();

      if (currentDoc?.status === "review") {
        await supabase
          .from("processed_documents")
          .update({ 
            status: "pending",
            error_message: null,
            retry_count: 0
          })
          .eq("id", documentId);
      }

      const { data, error } = await supabase.functions.invoke("publish-to-quickbooks", {
        body: {
          organization_id: activeOrganization,
          document_ids: [documentId],
        },
      });

      if (error) {
        console.error("Error from edge function:", error);
        const errorMsg = typeof error === 'string' 
          ? error 
          : error.message || JSON.stringify(error);
        throw new Error(errorMsg);
      }

      if (data.published > 0) {
        toast.success(`✓ Factura ${docNumber} publicada exitosamente a QuickBooks`);
        // Recargar la página después de 1 segundo
        setTimeout(() => window.location.reload(), 1000);
      } else if (data.failed > 0) {
        const errors = data.errors || [];
        const firstError = errors[0];
        let errorMsg = "Error desconocido";
        
        if (typeof firstError === 'string') {
          errorMsg = firstError;
        } else if (firstError && firstError.error) {
          errorMsg = firstError.error;
        } else if (firstError) {
          errorMsg = JSON.stringify(firstError);
        }
        
        console.error("Publishing failed:", errorMsg, data);
        toast.error(`Error al publicar: ${errorMsg}`, { duration: 6000 });
      }
    } catch (error) {
      console.error("Error publishing document:", error);
      const errorMsg = error instanceof Error 
        ? error.message 
        : typeof error === 'string' 
        ? error 
        : "Error desconocido al publicar la factura";
      toast.error(`Error: ${errorMsg}`, { duration: 6000 });
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <Button
      onClick={handlePublish}
      disabled={isPublishing}
      size="sm"
      variant="default"
      className="bg-green-600 hover:bg-green-700"
    >
      {isPublishing ? (
        <>
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          Publicando...
        </>
      ) : (
        <>
          <Upload className="h-3 w-3 mr-1" />
          Publicar a QBO
        </>
      )}
    </Button>
  );
};
