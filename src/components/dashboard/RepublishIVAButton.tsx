import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { useState } from "react";

export const RepublishIVAButton = () => {
  const { activeOrganization } = useAuth();
  const [isRepublishing, setIsRepublishing] = useState(false);

  const handleRepublish = async () => {
    if (!activeOrganization) return;

    setIsRepublishing(true);
    toast.info("Republicando facturas con IVA mal dividido...");

    try {
      const { data, error } = await supabase.functions.invoke("republish-bills-with-iva", {
        body: { organization_id: activeOrganization },
      });

      if (error) throw error;

      const processed = data.processed || 0;
      const deleted = data.deleted || 0;
      const republished = data.republished || 0;
      const failed = data.failed || 0;

      if (republished > 0) {
        toast.success(
          `✓ ${republished} factura${republished !== 1 ? 's' : ''} republicada${republished !== 1 ? 's' : ''} con IVA corregido${failed > 0 ? ` (${failed} fallidos)` : ''}`
        );
      } else if (failed > 0) {
        toast.error(`No se pudo republicar ninguna factura (${failed} errores)`);
      } else {
        toast.info("No hay facturas con IVA para republicar");
      }

      // Reload after 2 seconds
      setTimeout(() => {
        window.location.reload();
      }, 2000);

    } catch (error) {
      console.error("Error republishing bills with IVA:", error);
      toast.error("Error al republicar facturas con IVA");
    } finally {
      setIsRepublishing(false);
    }
  };

  return (
    <Button 
      onClick={handleRepublish}
      disabled={isRepublishing}
      variant="outline"
      className="w-full"
    >
      <RefreshCw className="h-4 w-4 mr-2" />
      {isRepublishing ? "Republicando..." : "Republicar Facturas con IVA Corregido"}
    </Button>
  );
};
