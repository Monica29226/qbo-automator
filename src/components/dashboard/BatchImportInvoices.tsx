import { useState, useRef } from "react";
import { Upload, Loader2, CheckCircle2, XCircle, AlertCircle, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";

interface ImportStatus {
  invoiceNumber: string;
  status: "pending" | "processing" | "success" | "error" | "existing";
  message?: string;
}

export function BatchImportInvoices() {
  const [open, setOpen] = useState(false);
  const [invoiceNumbers, setInvoiceNumbers] = useState("");
  const [autoPublish, setAutoPublish] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importStatuses, setImportStatuses] = useState<ImportStatus[]>([]);
  const { toast } = useToast();
  const { activeOrganization } = useAuth();
  const abortRef = useRef(false);

  const parseInvoiceNumbers = (text: string): string[] => {
    return text
      .split(/[\n,;]+/)
      .map(line => line.trim())
      .filter(line => line.length > 0);
  };

  const handleStartImport = async () => {
    const numbers = parseInvoiceNumbers(invoiceNumbers);
    
    if (numbers.length === 0) {
      toast({
        title: "Error",
        description: "No hay números de factura válidos",
        variant: "destructive",
      });
      return;
    }

    if (!activeOrganization) {
      toast({
        title: "Error",
        description: "No hay organización activa",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    abortRef.current = false;

    // Initialize all statuses as pending
    const initialStatuses: ImportStatus[] = numbers.map(num => ({
      invoiceNumber: num,
      status: "pending",
    }));
    setImportStatuses(initialStatuses);

    let successCount = 0;
    let errorCount = 0;
    let existingCount = 0;

    for (let i = 0; i < numbers.length; i++) {
      if (abortRef.current) break;

      const invoiceNumber = numbers[i];
      
      // Update status to processing
      setImportStatuses(prev => 
        prev.map((s, idx) => 
          idx === i ? { ...s, status: "processing" } : s
        )
      );

      try {
        const { data, error } = await supabase.functions.invoke("search-import-invoice", {
          body: {
            organization_id: activeOrganization,
            invoice_number: invoiceNumber,
            auto_publish: autoPublish,
          },
        });

        if (error) throw error;

        if (data.success) {
          successCount++;
          setImportStatuses(prev =>
            prev.map((s, idx) =>
              idx === i ? { ...s, status: "success", message: data.message } : s
            )
          );
        } else if (data.existing) {
          existingCount++;
          setImportStatuses(prev =>
            prev.map((s, idx) =>
              idx === i ? { ...s, status: "existing", message: "Ya existe en el sistema" } : s
            )
          );
        } else {
          errorCount++;
          setImportStatuses(prev =>
            prev.map((s, idx) =>
              idx === i ? { ...s, status: "error", message: data.message } : s
            )
          );
        }
      } catch (error: any) {
        errorCount++;
        setImportStatuses(prev =>
          prev.map((s, idx) =>
            idx === i ? { ...s, status: "error", message: error.message || "Error desconocido" } : s
          )
        );
      }

      setProgress(((i + 1) / numbers.length) * 100);
      
      // Small delay to avoid overwhelming the API
      if (i < numbers.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    setIsProcessing(false);
    
    toast({
      title: "Importación completada",
      description: `Éxito: ${successCount}, Ya existían: ${existingCount}, Errores: ${errorCount}`,
    });
  };

  const handleAbort = () => {
    abortRef.current = true;
  };

  const handleClose = () => {
    if (isProcessing) {
      abortRef.current = true;
    }
    setOpen(false);
    setInvoiceNumbers("");
    setImportStatuses([]);
    setProgress(0);
  };

  const getStatusIcon = (status: ImportStatus["status"]) => {
    switch (status) {
      case "success":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "error":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "existing":
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case "processing":
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      default:
        return <FileText className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: ImportStatus["status"]) => {
    switch (status) {
      case "success":
        return <Badge className="bg-green-500">Importada</Badge>;
      case "error":
        return <Badge variant="destructive">Error</Badge>;
      case "existing":
        return <Badge variant="secondary">Existente</Badge>;
      case "processing":
        return <Badge className="bg-blue-500">Procesando...</Badge>;
      default:
        return <Badge variant="outline">Pendiente</Badge>;
    }
  };

  const counts = importStatuses.reduce(
    (acc, s) => {
      acc[s.status] = (acc[s.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Upload className="h-4 w-4" />
          Importar Lote
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Importación Masiva de Facturas
          </DialogTitle>
          <DialogDescription>
            Pegue los números de factura (uno por línea) para buscarlos en Gmail e importarlos a QuickBooks.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {!isProcessing && importStatuses.length === 0 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="invoice-numbers">Números de Factura (uno por línea)</Label>
                <Textarea
                  id="invoice-numbers"
                  placeholder="00100004010000143249&#10;00100004010000143256&#10;00100004010000143255&#10;..."
                  value={invoiceNumbers}
                  onChange={(e) => setInvoiceNumbers(e.target.value)}
                  rows={10}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  {parseInvoiceNumbers(invoiceNumbers).length} facturas detectadas
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="auto-publish-batch"
                  checked={autoPublish}
                  onCheckedChange={(checked) => setAutoPublish(checked as boolean)}
                />
                <Label htmlFor="auto-publish-batch" className="text-sm">
                  Publicar automáticamente a QuickBooks después de importar
                </Label>
              </div>
            </>
          )}

          {(isProcessing || importStatuses.length > 0) && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Progreso: {Math.round(progress)}%</span>
                  <span className="text-muted-foreground">
                    {importStatuses.filter(s => s.status !== "pending" && s.status !== "processing").length} / {importStatuses.length}
                  </span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>

              <div className="flex gap-2 flex-wrap">
                <Badge variant="outline" className="gap-1">
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                  Éxito: {counts.success || 0}
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <AlertCircle className="h-3 w-3 text-yellow-500" />
                  Existentes: {counts.existing || 0}
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <XCircle className="h-3 w-3 text-red-500" />
                  Errores: {counts.error || 0}
                </Badge>
              </div>

              <ScrollArea className="h-[300px] border rounded-md">
                <div className="p-2 space-y-1">
                  {importStatuses.map((status, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center justify-between p-2 rounded text-sm ${
                        status.status === "processing" ? "bg-blue-50 dark:bg-blue-950" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {getStatusIcon(status.status)}
                        <span className="font-mono truncate">{status.invoiceNumber}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {status.message && (
                          <span className="text-xs text-muted-foreground max-w-[200px] truncate" title={status.message}>
                            {status.message}
                          </span>
                        )}
                        {getStatusBadge(status.status)}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {isProcessing ? "Cancelar" : "Cerrar"}
          </Button>
          {!isProcessing && importStatuses.length === 0 && (
            <Button 
              onClick={handleStartImport} 
              disabled={parseInvoiceNumbers(invoiceNumbers).length === 0}
            >
              <Upload className="mr-2 h-4 w-4" />
              Iniciar Importación ({parseInvoiceNumbers(invoiceNumbers).length})
            </Button>
          )}
          {isProcessing && (
            <Button variant="destructive" onClick={handleAbort}>
              Detener
            </Button>
          )}
          {!isProcessing && importStatuses.length > 0 && (
            <Button onClick={() => {
              setImportStatuses([]);
              setProgress(0);
            }}>
              Nueva Importación
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
