import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Zap } from "lucide-react";
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

export const SmartRetryButton = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSmartRetry = async () => {
    setShowConfirm(false);
    setIsProcessing(true);

    try {
      // Obtener organización activa
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

      toast.info("🔄 Iniciando reintento inteligente...", {
        description: "Buscando configuraciones exitosas de proveedores",
      });

      const { data, error } = await supabase.functions.invoke("smart-retry-errors", {
        body: { organization_id: activeOrg.organization_id },
      });

      if (error) throw error;

      const result = data as {
        total_errors_found: number;
        resolved: number;
        still_errors: number;
        resolved_suppliers: string[];
        pending_suppliers: string[];
      };

      if (result.resolved > 0) {
        toast.success(`✅ Reintento completado exitosamente`, {
          description: `${result.resolved} de ${result.total_errors_found} facturas resueltas automáticamente`,
          duration: 5000,
        });

        if (result.resolved_suppliers.length > 0) {
          toast.info("🎯 Proveedores resueltos:", {
            description: result.resolved_suppliers.slice(0, 3).join(", ") + 
              (result.resolved_suppliers.length > 3 ? ` y ${result.resolved_suppliers.length - 3} más` : ""),
            duration: 4000,
          });
        }
      } else {
        toast.warning("⚠️ No se pudieron resolver errores automáticamente", {
          description: result.still_errors > 0 
            ? `${result.still_errors} facturas requieren configuración manual`
            : "No se encontraron facturas con error",
        });
      }

      if (result.pending_suppliers.length > 0) {
        toast.info("📋 Proveedores sin configuración:", {
          description: result.pending_suppliers.slice(0, 3).join(", ") +
            (result.pending_suppliers.length > 3 ? ` y ${result.pending_suppliers.length - 3} más` : ""),
          duration: 5000,
        });
      }

      // Recargar la página para actualizar estadísticas
      if (result.resolved > 0) {
        setTimeout(() => window.location.reload(), 2000);
      }
    } catch (error) {
      console.error("Error in smart retry:", error);
      toast.error("❌ Error al ejecutar reintento inteligente", {
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
        variant="default"
        className="w-full gap-2"
      >
        {isProcessing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Procesando...
          </>
        ) : (
          <>
            <Zap className="h-4 w-4" />
            Reintento Inteligente
          </>
        )}
      </Button>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>🧠 Reintento Inteligente</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p className="font-semibold">Esta función hará lo siguiente:</p>
              <ul className="list-disc list-inside space-y-1 text-sm">
                <li>Buscar facturas con error de "cuenta contable"</li>
                <li>Para cada proveedor, buscar facturas exitosas anteriores</li>
                <li>Aplicar la misma configuración automáticamente</li>
                <li>Crear reglas de clasificación para futuros documentos</li>
                <li>Reintentar publicación a QuickBooks</li>
              </ul>
              <p className="text-sm text-muted-foreground mt-3">
                Los proveedores sin facturas exitosas anteriores requerirán configuración manual.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleSmartRetry}>
              Ejecutar Reintento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
