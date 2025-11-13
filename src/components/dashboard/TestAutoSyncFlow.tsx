import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { PlayCircle, Loader2 } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export const TestAutoSyncFlow = () => {
  const { activeOrganization } = useAuth();
  const [isTesting, setIsTesting] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleTest = async () => {
    if (!activeOrganization) return;

    setIsTesting(true);
    setResult(null);
    toast.info("Iniciando prueba del flujo completo...");

    try {
      // Llamar a auto-sync-invoices en modo manual
      const { data, error } = await supabase.functions.invoke("auto-sync-invoices", {
        body: { 
          organization_id: activeOrganization,
          trigger: "manual"
        },
      });

      if (error) throw error;

      setResult(data);

      if (data.success) {
        toast.success("✓ Flujo de sincronización completado correctamente");
      } else {
        toast.warning("Flujo completado con advertencias");
      }

    } catch (error: any) {
      console.error("Error testing auto-sync flow:", error);
      toast.error(`Error: ${error.message}`);
      setResult({ error: error.message });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full">
          <PlayCircle className="h-4 w-4 mr-2" />
          Probar Flujo Automático
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Prueba del Flujo Automático</DialogTitle>
          <DialogDescription>
            Esta herramienta ejecuta el flujo completo de sincronización: Gmail → Procesamiento → QuickBooks
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Button 
            onClick={handleTest}
            disabled={isTesting}
            className="w-full"
          >
            {isTesting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Ejecutando...
              </>
            ) : (
              <>
                <PlayCircle className="h-4 w-4 mr-2" />
                Ejecutar Flujo Completo
              </>
            )}
          </Button>

          {result && (
            <div className="mt-4 p-4 border rounded-lg bg-muted/50">
              <h3 className="font-semibold mb-2">Resultado:</h3>
              <pre className="text-xs overflow-auto max-h-96 whitespace-pre-wrap">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}

          <div className="text-xs text-muted-foreground space-y-1 border-t pt-4">
            <p><strong>Este flujo ejecuta:</strong></p>
            <p>1. Busca facturas nuevas en Gmail</p>
            <p>2. Descarga y procesa los XMLs</p>
            <p>3. Extrae datos y asigna proveedores</p>
            <p>4. Publica automáticamente a QuickBooks</p>
            <p className="mt-2 text-amber-600">⚠️ Esta es la misma ejecución que hace el cron automático cada 30 minutos</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
