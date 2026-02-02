import { useState, useEffect } from "react";
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
import { Server, Calendar, AlertTriangle, RefreshCw } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNavigate } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface HostingerFetchDialogProps {
  onSuccess?: () => void;
}

export const HostingerFetchDialog = ({ onSuccess }: HostingerFetchDialogProps) => {
  const { activeOrganization } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [hostingerConnected, setHostingerConnected] = useState<boolean | null>(null);
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);

  // Check if Hostinger is connected when dialog opens
  useEffect(() => {
    const checkHostingerConnection = async () => {
      if (!open || !activeOrganization) return;
      
      setIsCheckingConnection(true);
      try {
        const { data, error } = await supabase
          .from("integration_accounts")
          .select("id, is_active")
          .eq("organization_id", activeOrganization)
          .eq("service_type", "hostinger")
          .eq("is_active", true)
          .maybeSingle();
        
        if (error) throw error;
        setHostingerConnected(!!data);
      } catch (error) {
        console.error("Error checking Hostinger connection:", error);
        setHostingerConnected(false);
      } finally {
        setIsCheckingConnection(false);
      }
    };

    checkHostingerConnection();
  }, [open, activeOrganization]);

  const handleReconnect = () => {
    setOpen(false);
    navigate("/integrations");
  };

  const handleYearChange = (value: string) => {
    setSelectedYear(value);
    if (!value) {
      setSelectedMonth("");
    }
  };

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
    toast.info("Obteniendo facturas de Hostinger...");

    let totalProcessed = 0;
    let totalFailed = 0;
    let skipCount = 0;
    let continueProcessing = true;
    let iterations = 0;
    const maxIterations = 20; // Safety limit to prevent infinite loops

    try {
      while (continueProcessing && iterations < maxIterations) {
        iterations++;
        
        const body: Record<string, unknown> = { 
          organization_id: activeOrganization,
          skip_count: skipCount
        };
        
        if (selectedMonth && selectedYear) {
          body.month = parseInt(selectedMonth);
          body.year = parseInt(selectedYear);
        }

        const { data, error } = await supabase.functions.invoke("hostinger-fetch-invoices", {
          body,
        });

        if (error) throw error;

        if (data?.success === false) {
          setHostingerConnected(false);
          toast.error(data.message || "Hostinger requiere reconexión. Por favor conecta tu cuenta nuevamente.");
          return;
        }

        const processed = data.invoices_processed || 0;
        const failed = data.invoices_failed || 0;
        totalProcessed += processed;
        totalFailed += failed;

        // Check if there are more messages to process
        if (data.partial && data.next_skip_count) {
          skipCount = data.next_skip_count;
          toast.info(`Procesando... ${data.message || ''}`);
        } else {
          continueProcessing = false;
        }
      }

      toast.success(
        `✓ ${totalProcessed} factura${totalProcessed !== 1 ? 's' : ''} procesada${totalProcessed !== 1 ? 's' : ''}${totalFailed > 0 ? ` (${totalFailed} fallidas)` : ''}`
      );

      setOpen(false);
      onSuccess?.();
    } catch (error: unknown) {
      console.error("Error fetching Hostinger invoices:", error);
      
      const errorMessage = error instanceof Error ? error.message : "";
      if (errorMessage.includes("No active Hostinger account") || errorMessage.includes("403")) {
        setHostingerConnected(false);
        toast.error("Hostinger no está conectado. Por favor reconecta tu cuenta.");
      } else {
        toast.error(`Error al obtener facturas: ${errorMessage}`);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full">
          <Server className="h-4 w-4 mr-2" />
          Obtener de Hostinger
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Obtener Facturas de Hostinger</DialogTitle>
          <DialogDescription>
            Selecciona un período específico o deja en blanco para obtener todas las facturas disponibles.
          </DialogDescription>
        </DialogHeader>

        {isCheckingConnection ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Verificando conexión...</span>
          </div>
        ) : hostingerConnected === false ? (
          <div className="py-4">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Hostinger no está conectado</AlertTitle>
              <AlertDescription className="mt-2">
                No hay una cuenta de Hostinger configurada. Necesitas conectar tu cuenta para obtener facturas.
              </AlertDescription>
            </Alert>
            <div className="flex justify-end mt-4">
              <Button onClick={handleReconnect} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Ir a Conectar Hostinger
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="year">Año (opcional)</Label>
              <Select value={selectedYear} onValueChange={handleYearChange}>
                <SelectTrigger id="year">
                  <SelectValue placeholder="Todos los años" />
                </SelectTrigger>
                <SelectContent>
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
                  <SelectValue placeholder="Todos los meses" />
                </SelectTrigger>
                <SelectContent>
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
        )}

        {hostingerConnected !== false && !isCheckingConnection && (
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isProcessing}>
              Cancelar
            </Button>
            {(selectedYear || selectedMonth) && (
              <Button 
                variant="ghost" 
                onClick={() => {
                  setSelectedYear("");
                  setSelectedMonth("");
                }} 
                disabled={isProcessing}
              >
                Limpiar
              </Button>
            )}
            <Button onClick={handleFetch} disabled={isProcessing}>
              {isProcessing ? "Obteniendo..." : "Obtener Facturas"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
