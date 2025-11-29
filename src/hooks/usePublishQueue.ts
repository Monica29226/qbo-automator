import { useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface PublishJob {
  documentIds: string[];
  vendorName: string;
  organizationId: string;
}

export const usePublishQueue = () => {
  const queueRef = useRef<PublishJob[]>([]);
  const isProcessingRef = useRef(false);

  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || queueRef.current.length === 0) return;
    
    isProcessingRef.current = true;
    
    while (queueRef.current.length > 0) {
      const job = queueRef.current.shift();
      if (!job) continue;

      try {
        console.log(`🚀 Publicando ${job.documentIds.length} facturas de ${job.vendorName}`);
        
        const { data, error } = await supabase.functions.invoke(
          "publish-to-quickbooks",
          {
            body: { 
              organization_id: job.organizationId, 
              document_ids: job.documentIds 
            },
          }
        );

        if (error) throw error;

        const published = data?.published || job.documentIds.length;
        const errors = data?.errors?.length || 0;

        if (errors > 0) {
          toast.warning(`⚠️ ${job.vendorName}: ${published} publicada(s), ${errors} con errores`);
        } else {
          toast.success(`✅ ${job.vendorName}: ${published} factura(s) publicada(s)`);
        }
      } catch (error: any) {
        console.error(`❌ Error publicando ${job.vendorName}:`, error);
        toast.error(`Error al publicar ${job.vendorName}: ${error.message || "Error desconocido"}`);
      }

      // Pequeña pausa entre jobs para no sobrecargar
      if (queueRef.current.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    isProcessingRef.current = false;
  }, []);

  const addToQueue = useCallback((job: PublishJob) => {
    queueRef.current.push(job);
    // Iniciar procesamiento sin bloquear
    processQueue();
  }, [processQueue]);

  const queueLength = queueRef.current.length;

  return { addToQueue, queueLength };
};
