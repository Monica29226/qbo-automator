import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Eraser } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export const CleanQBOReferences = () => {
  const { activeOrganization } = useAuth();
  const [docNumbers, setDocNumbers] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);

  const handleClean = async () => {
    if (!activeOrganization || !docNumbers.trim()) {
      toast.error("Ingresa al menos un número de factura");
      return;
    }

    setIsCleaning(true);
    
    // Split by commas, spaces, or newlines and clean up
    const numbers = docNumbers
      .split(/[\n,\s]+/)
      .map(n => n.trim())
      .filter(n => n.length > 0);

    toast.info(`Limpiando ${numbers.length} factura(s)...`);

    try {
      const { error, count } = await supabase
        .from("processed_documents")
        .update({
          qbo_entity_id: null,
          qbo_entity_type: null,
          error_message: null,
          status: "processed"
        })
        .eq("organization_id", activeOrganization)
        .in("doc_number", numbers);

      if (error) throw error;

      toast.success(`✓ ${count || 0} factura(s) limpiadas y listas para reprocesar`);
      setDocNumbers("");
      setIsOpen(false);

    } catch (error) {
      console.error("Error cleaning QBO references:", error);
      toast.error("Error al limpiar referencias de QuickBooks");
    } finally {
      setIsCleaning(false);
    }
  };

  const handleCleanAll = async () => {
    if (!activeOrganization) return;

    setIsCleaning(true);
    toast.info("Limpiando todas las facturas con QBO ID...");

    try {
      const { error, count } = await supabase
        .from("processed_documents")
        .update({
          qbo_entity_id: null,
          qbo_entity_type: null,
          error_message: null,
          status: "processed"
        })
        .eq("organization_id", activeOrganization)
        .not("qbo_entity_id", "is", null);

      if (error) throw error;

      toast.success(`✓ ${count || 0} facturas limpiadas y listas para reprocesar`);
      setIsOpen(false);

    } catch (error) {
      console.error("Error cleaning all QBO references:", error);
      toast.error("Error al limpiar todas las referencias");
    } finally {
      setIsCleaning(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full">
          <Eraser className="h-4 w-4 mr-2" />
          Limpiar Referencias QBO
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Limpiar Referencias de QuickBooks</DialogTitle>
          <DialogDescription>
            Si eliminaste facturas de QuickBooks manualmente, usa esta herramienta para limpiar las referencias en el sistema y poder reprocesarlas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Números de Factura (uno por línea o separados por comas)
            </label>
            <textarea
              value={docNumbers}
              onChange={(e) => setDocNumbers(e.target.value)}
              placeholder="00100001010000025788&#10;00100001010000025801&#10;..."
              className="w-full min-h-32 p-2 border rounded-md resize-none"
              disabled={isCleaning}
            />
          </div>

          <div className="flex gap-2">
            <Button 
              onClick={handleClean}
              disabled={isCleaning || !docNumbers.trim()}
              className="flex-1"
            >
              Limpiar Seleccionadas
            </Button>
            <Button 
              onClick={handleCleanAll}
              disabled={isCleaning}
              variant="destructive"
              className="flex-1"
            >
              Limpiar Todas
            </Button>
          </div>

          <div className="text-xs text-muted-foreground space-y-1">
            <p>• <strong>Limpiar Seleccionadas:</strong> Solo limpia las facturas que ingreses</p>
            <p>• <strong>Limpiar Todas:</strong> Limpia todas las facturas con QBO ID (úsalo si eliminaste muchas facturas)</p>
            <p className="mt-2 text-amber-600">⚠️ Después de limpiar, podrás reprocesar las facturas normalmente</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
