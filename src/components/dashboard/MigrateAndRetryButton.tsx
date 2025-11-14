import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { RefreshCw, Loader2 } from "lucide-react";
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

export const MigrateAndRetryButton = () => {
  const { activeOrganization } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleMigrate = async () => {
    if (!activeOrganization) return;

    setIsProcessing(true);
    setShowConfirm(false);
    
    toast.info("🔄 Migrando y reprocesando facturas con error...");

    try {
      const { data, error } = await supabase.functions.invoke("migrate-and-retry-all", {
        body: { organization_id: activeOrganization },
      });

      if (error) throw error;

      const { results, publishResult } = data;
      
      if (results.migrated > 0) {
        const published = publishResult?.published || 0;
        const failed = publishResult?.failed || 0;
        
        toast.success(
          `✅ Migración completada: ${results.migrated} documentos actualizados. ` +
          `${published} publicados en QuickBooks${failed > 0 ? `, ${failed} con errores` : ''}`
        );
      } else {
        toast.info("ℹ️ No hay documentos para migrar");
      }

      if (results.failed > 0) {
        toast.warning(`⚠️ ${results.failed} documentos fallaron durante la migración`);
      }

      // Recargar después de 2 segundos
      setTimeout(() => {
        window.location.reload();
      }, 2000);

    } catch (error) {
      console.error("Error during migration:", error);
      toast.error("❌ Error al migrar y reprocesar documentos");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <Button 
        onClick={() => setShowConfirm(true)}
        disabled={isProcessing}
        variant="outline"
        className="w-full"
      >
        {isProcessing ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4 mr-2" />
        )}
        Migrar y Reprocesar Todo
      </Button>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Migrar y Reprocesar Documentos?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>Esta operación:</p>
              <ul className="list-disc list-inside space-y-1 text-sm">
                <li>Actualizará el formato de datos de todas las facturas con error</li>
                <li>Migrará los datos antiguos al nuevo formato con impuestos detallados</li>
                <li>Intentará publicar automáticamente en QuickBooks</li>
              </ul>
              <p className="mt-3 font-medium">
                ¿Desea continuar?
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleMigrate}>
              Migrar y Reprocesar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
