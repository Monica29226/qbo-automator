import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Rocket } from "lucide-react";
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

export const AutoProcessAllButton = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleAutoProcess = async () => {
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

      toast.info("🚀 Iniciando procesamiento automático completo...", {
        description: "Procesando cola de revisión y resolviendo errores",
      });

      const { data, error } = await supabase.functions.invoke("auto-process-all", {
        body: { organization_id: activeOrg.organization_id },
      });

      if (error) throw error;

      const result = data as {
        review_processed: number;
        errors_fixed: number;
        rules_created: number;
        published: number;
        failed: number;
      };

      const totalProcessed = result.review_processed + result.errors_fixed;
      
      if (result.published > 0) {
        toast.success(`🎉 ¡Éxito total!`, {
          description: `${result.published} de ${totalProcessed} facturas publicadas exitosamente en QuickBooks`,
          duration: 6000,
        });

        if (result.rules_created > 0) {
          toast.info(`📋 Reglas creadas: ${result.rules_created}`, {
            description: "Se asignaron cuentas automáticamente para futuros documentos",
            duration: 5000,
          });
        }
      } else if (result.failed > 0) {
        toast.warning(`⚠️ Procesamiento completado con errores`, {
          description: `${result.failed} facturas no se pudieron publicar. Revisa los detalles.`,
        });
      } else {
        toast.info("ℹ️ No hay facturas pendientes para procesar");
      }

      // Recargar después de 2 segundos si hubo éxito
      if (result.published > 0) {
        setTimeout(() => window.location.reload(), 2000);
      }
    } catch (error) {
      console.error("Error in auto-process:", error);
      toast.error("❌ Error al ejecutar procesamiento automático", {
        description: error instanceof Error ? error.message : "Error desconocido",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => setShowConfirm(true)}
        disabled={isProcessing}
        className="w-full gap-2"
      >
        {isProcessing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Procesando...
          </>
        ) : (
          <>
            <Rocket className="h-4 w-4" />
            Procesar TODO Automáticamente
          </>
        )}
      </Button>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>🚀 Procesamiento Automático Completo</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p className="font-semibold">Esta función procesará TODAS las facturas pendientes automáticamente:</p>
              <ul className="list-disc list-inside space-y-2 text-sm">
                <li><strong>Cola de Revisión:</strong> Procesar automáticamente todas las facturas en revisión</li>
                <li><strong>Errores de Cuenta:</strong> Resolver errores de clasificación contable</li>
                <li><strong>Cuenta por Defecto:</strong> Asignar cuenta 5105 (Costo de Ventas) si no existe configuración</li>
                <li><strong>Publicación QuickBooks:</strong> Enviar todas las facturas a QuickBooks</li>
                <li><strong>Aprendizaje Automático:</strong> Guardar configuraciones exitosas para futuros documentos</li>
              </ul>
              <p className="text-sm font-semibold text-primary mt-3">
                Meta: 100% de facturas procesadas exitosamente HOY
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleAutoProcess}>
              Procesar TODO
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
