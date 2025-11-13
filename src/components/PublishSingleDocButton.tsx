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
      const { data, error } = await supabase.functions.invoke("publish-to-quickbooks", {
        body: {
          organization_id: activeOrganization,
          document_ids: [documentId],
        },
      });

      if (error) throw error;

      if (data.published > 0) {
        toast.success(`✓ Factura ${docNumber} publicada exitosamente a QuickBooks`);
        // Recargar la página después de 1 segundo
        setTimeout(() => window.location.reload(), 1000);
      } else if (data.failed > 0) {
        const errorMsg = data.errors?.[0] || "Error desconocido";
        toast.error(`Error al publicar: ${errorMsg}`);
      }
    } catch (error) {
      console.error("Error publishing document:", error);
      toast.error("Error al publicar la factura");
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
