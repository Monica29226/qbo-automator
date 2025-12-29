import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FileDown, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

interface BatchDownloadMissingPdfsProps {
  onComplete?: () => void;
}

export const BatchDownloadMissingPdfs = ({ onComplete }: BatchDownloadMissingPdfsProps) => {
  const { activeOrganization } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleBatchDownload = async () => {
    if (!activeOrganization) {
      toast.error("No hay organización activa");
      return;
    }

    setIsProcessing(true);
    toast.info("Verificando y descargando PDFs faltantes...");

    try {
      const { data, error } = await supabase.functions.invoke("batch-download-missing-pdfs", {
        body: { 
          organization_id: activeOrganization,
          limit: 100
        },
      });

      if (error) throw error;

      if (data.downloaded > 0) {
        toast.success(
          `✓ ${data.downloaded} PDF${data.downloaded !== 1 ? 's' : ''} descargado${data.downloaded !== 1 ? 's' : ''}` +
          (data.notFound > 0 ? `, ${data.notFound} no encontrados en Gmail` : '') +
          (data.failed > 0 ? `, ${data.failed} con error` : '')
        );
      } else if (data.processed === 0) {
        toast.info("No hay documentos pendientes para verificar");
      } else if (data.notFound > 0) {
        toast.warning(`${data.notFound} PDFs no encontrados en Gmail`);
      } else {
        toast.success("Todos los documentos ya tienen su PDF");
      }

      onComplete?.();
    } catch (error: any) {
      console.error("Error en descarga batch de PDFs:", error);
      toast.error(`Error: ${error.message || "Error al descargar PDFs"}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleBatchDownload}
      disabled={isProcessing}
      className="gap-2"
    >
      {isProcessing ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Descargando...
        </>
      ) : (
        <>
          <FileDown className="h-4 w-4" />
          Descargar PDFs Faltantes
        </>
      )}
    </Button>
  );
};
