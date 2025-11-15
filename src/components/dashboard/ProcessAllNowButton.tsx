import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const ProcessAllNowButton = () => {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleProcessNow = async () => {
    setIsProcessing(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const { data: activeOrg } = await supabase
        .from("user_active_organization")
        .select("organization_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!activeOrg?.organization_id) {
        throw new Error("No active organization");
      }

      toast.info("⚡ Procesando todas las facturas pendientes...");

      // Ejecutar procesamiento automático
      const { data: autoData, error: autoError } = await supabase.functions.invoke(
        "auto-process-all",
        { body: { organization_id: activeOrg.organization_id } }
      );

      if (autoError) throw autoError;

      const autoResult = autoData as {
        review_processed: number;
        errors_fixed: number;
        published: number;
        failed: number;
      };

      toast.success(
        `✅ Procesamiento completado: ${autoResult.published} publicadas`,
        { description: `${autoResult.review_processed + autoResult.errors_fixed} documentos procesados` }
      );

      setTimeout(() => window.location.reload(), 2000);
    } catch (error) {
      console.error("Error processing all:", error);
      toast.error("Error al procesar facturas", {
        description: error instanceof Error ? error.message : "Error desconocido",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Button
      onClick={handleProcessNow}
      disabled={isProcessing}
      size="lg"
      className="w-full"
    >
      <Zap className="h-5 w-5 mr-2" />
      {isProcessing ? "Procesando..." : "Procesar TODO Ahora ⚡"}
    </Button>
  );
};
