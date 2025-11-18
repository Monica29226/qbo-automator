import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Mail, Calendar } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface GmailFetchDialogProps {
  onSuccess?: () => void;
}

export const GmailFetchDialog = ({ onSuccess }: GmailFetchDialogProps) => {
  const { activeOrganization } = useAuth();
  const [open, setOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [selectedYear, setSelectedYear] = useState<string>("");

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 3 }, (_, i) => currentYear - i);
  const months = [
    { value: "1", label: "Enero" },
    { value: "2", label: "Febrero" },
    { value: "3", label: "Marzo" },
    { value: "4", label: "Abril" },
    { value: "5", label: "Mayo" },
    { value: "6", label: "Junio" },
    { value: "7", label: "Julio" },
    { value: "8", label: "Agosto" },
    { value: "9", label: "Septiembre" },
    { value: "10", label: "Octubre" },
    { value: "11", label: "Noviembre" },
    { value: "12", label: "Diciembre" },
  ];

  const handleFetch = async () => {
    if (!activeOrganization) return;

    setIsProcessing(true);
    toast.info("Obteniendo facturas de Gmail...");

    try {
      const body: any = { organization_id: activeOrganization };
      
      // Si se seleccionó mes y año, incluirlos
      if (selectedMonth && selectedYear) {
        body.month = parseInt(selectedMonth);
        body.year = parseInt(selectedYear);
      }

      const { data, error } = await supabase.functions.invoke("gmail-fetch-invoices", {
        body,
      });

      if (error) throw error;

      const processed = data.invoices_processed || 0;
      const failed = data.invoices_failed || 0;

      toast.success(
        `✓ ${processed} factura${processed !== 1 ? 's' : ''} obtenida${processed !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} fallidas)` : ''}`
      );

      setOpen(false);
      onSuccess?.();
    } catch (error: any) {
      console.error("Error fetching Gmail invoices:", error);
      toast.error(`Error al obtener facturas: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full">
          <Mail className="h-4 w-4 mr-2" />
          Obtener de Gmail
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Obtener Facturas de Gmail</DialogTitle>
          <DialogDescription>
            Selecciona un período específico o deja en blanco para obtener todas las facturas disponibles.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="year">Año (opcional)</Label>
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger id="year">
                <SelectValue placeholder="Seleccionar año" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todos los años</SelectItem>
                {years.map((year) => (
                  <SelectItem key={year} value={year.toString()}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="month">Mes (opcional)</Label>
            <Select value={selectedMonth} onValueChange={setSelectedMonth} disabled={!selectedYear}>
              <SelectTrigger id="month">
                <SelectValue placeholder="Seleccionar mes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todos los meses</SelectItem>
                {months.map((month) => (
                  <SelectItem key={month.value} value={month.value}>
                    {month.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedYear && selectedMonth && (
            <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Se buscarán facturas de {months.find(m => m.value === selectedMonth)?.label} {selectedYear}
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isProcessing}>
            Cancelar
          </Button>
          <Button onClick={handleFetch} disabled={isProcessing}>
            {isProcessing ? "Obteniendo..." : "Obtener Facturas"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
