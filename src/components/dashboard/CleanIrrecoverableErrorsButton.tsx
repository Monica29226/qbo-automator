import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const CleanIrrecoverableErrorsButton = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [errorsToClean, setErrorsToClean] = useState(0);

  const checkIrrecoverableErrors = async () => {
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

      // Contar documentos con errores irrecuperables (no existen en Gmail)
      const { data, error } = await supabase
        .from("processed_documents")
        .select("id", { count: "exact", head: false })
        .eq("organization_id", activeOrg.organization_id)
        .eq("status", "error")
        .ilike("error_message", "%Could not recover document from Gmail%");

      if (error) throw error;

      setErrorsToClean(data?.length || 0);
      
      if (data && data.length > 0) {
        setShowConfirm(true);
      } else {
        toast.info("No hay errores irrecuperables para limpiar");
      }
    } catch (error) {
      console.error("Error checking irrecoverable errors:", error);
      toast.error("Error al verificar errores");
    }
  };

  const handleClean = async () => {
    setShowConfirm(false);
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

      toast.info("🗑️ Limpiando errores irrecuperables...");

      // Eliminar documentos con errores irrecuperables
      const { error } = await supabase
        .from("processed_documents")
        .delete()
        .eq("organization_id", activeOrg.organization_id)
        .eq("status", "error")
        .ilike("error_message", "%Could not recover document from Gmail%");

      if (error) throw error;

      toast.success(`✅ ${errorsToClean} errores irrecuperables eliminados`, {
        description: "Estos documentos ya no se intentarán reprocesar",
        duration: 5000,
      });

      setTimeout(() => window.location.reload(), 2000);
    } catch (error) {
      console.error("Error cleaning irrecoverable errors:", error);
      toast.error("❌ Error al limpiar errores", {
        description: error instanceof Error ? error.message : "Error desconocido",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <Button
        onClick={checkIrrecoverableErrors}
        disabled={isProcessing}
        variant="outline"
        className="w-full"
      >
        {isProcessing ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Procesando...
          </>
        ) : (
          <>
            <Trash2 className="h-4 w-4 mr-2" />
            Limpiar Errores Irrecuperables
          </>
        )}
      </Button>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>🗑️ Limpiar Errores Irrecuperables</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>Se encontraron <strong>{errorsToClean}</strong> documentos con errores irrecuperables.</p>
              <p className="text-sm">
                Estos son documentos que ya no existen en Gmail y están causando fallos 
                continuos en el procesamiento automático.
              </p>
              <p className="text-sm font-medium">
                ¿Desea eliminar estos documentos de la base de datos?
              </p>
              <p className="text-xs text-muted-foreground">
                Nota: Esta acción no afecta documentos exitosos ni documentos que puedan ser recuperados.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleClean}>
              Limpiar Errores
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
