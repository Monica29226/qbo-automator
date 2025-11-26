import { useState } from "react";
import { Button } from "@/components/ui/button";
import { HardDrive, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

export function BatchUploadToDriveButton() {
  const { activeOrganization } = useAuth();
  const [isUploading, setIsUploading] = useState(false);

  const handleBatchUpload = async () => {
    if (!activeOrganization) {
      toast.error("No hay organización activa");
      return;
    }

    const confirmed = confirm(
      "¿Desea subir todas las facturas existentes a Google Drive? Esto puede tomar varios minutos."
    );

    if (!confirmed) return;

    setIsUploading(true);
    toast.info("Iniciando subida masiva a Google Drive...");

    try {
      const { data, error } = await supabase.functions.invoke(
        "batch-upload-to-drive",
        {
          body: { organization_id: activeOrganization },
        }
      );

      if (error) {
        throw error;
      }

      toast.success(
        `Subida completada: ${data.uploaded} exitosos, ${data.failed} fallidos de ${data.total} totales`
      );
    } catch (error) {
      console.error("Error in batch upload:", error);
      toast.error(
        "Error al subir facturas a Google Drive: " +
          (error instanceof Error ? error.message : "Error desconocido")
      );
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Button
      onClick={handleBatchUpload}
      disabled={isUploading}
      variant="outline"
      size="sm"
    >
      {isUploading ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Subiendo...
        </>
      ) : (
        <>
          <HardDrive className="h-4 w-4 mr-2" />
          Subir Todo a Drive
        </>
      )}
    </Button>
  );
}
