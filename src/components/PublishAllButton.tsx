import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { PublishValidationDialog } from "./PublishValidationDialog";

export const PublishAllButton = () => {
  const { activeOrganization } = useAuth();
  const [showValidation, setShowValidation] = useState(false);

  const handlePublishAll = async () => {
    if (!activeOrganization) return;

    toast.info("Publicando facturas procesadas a QuickBooks...");

    try {
      const { data, error } = await supabase.functions.invoke("publish-to-quickbooks", {
        body: { organization_id: activeOrganization },
      });

      if (error) throw error;

      const published = data.published || 0;
      const failed = data.failed || 0;

      if (published > 0) {
        toast.success(
          `✓ ${published} factura${published !== 1 ? 's' : ''} publicada${published !== 1 ? 's' : ''} en QuickBooks${failed > 0 ? ` (${failed} fallidas)` : ''}`
        );
      } else if (failed > 0) {
        toast.error(`No se pudo publicar ninguna factura (${failed} errores)`);
      } else {
        toast.info("No hay facturas pendientes para publicar");
      }

      // Recargar página después de 2 segundos
      setTimeout(() => {
        window.location.reload();
      }, 2000);

    } catch (error) {
      console.error("Error publishing to QuickBooks:", error);
      toast.error("Error al publicar en QuickBooks");
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
        onClick={() => setShowValidation(true)}
        className="w-full"
      >
        <Send className="h-4 w-4 mr-2" />
        Publicar Todas a QuickBooks
      </Button>
    </>
  );
};
