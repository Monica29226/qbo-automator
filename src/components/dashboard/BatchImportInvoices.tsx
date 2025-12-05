import { useState, useRef, useEffect } from "react";
import { Upload, Loader2, CheckCircle2, XCircle, AlertCircle, FileText, RotateCcw } from "lucide-react";
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

const STORAGE_KEY = "batch_import_progress";
const PARALLEL_COUNT = 3;

interface ImportStatus {
  invoiceNumber: string;
  status: "pending" | "processing" | "success" | "error" | "existing";
  message?: string;
}

interface SavedProgress {
  organizationId: string;
  autoPublish: boolean;
  statuses: ImportStatus[];
  timestamp: number;
}

export function BatchImportInvoices() {
  const [open, setOpen] = useState(false);
  const [invoiceNumbers, setInvoiceNumbers] = useState("");
  const [autoPublish, setAutoPublish] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importStatuses, setImportStatuses] = useState<ImportStatus[]>([]);
  const [hasSavedProgress, setHasSavedProgress] = useState(false);
  const { toast } = useToast();
  const { activeOrganization } = useAuth();
  const abortRef = useRef(false);

  // Check for saved progress on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const data: SavedProgress = JSON.parse(saved);
        // Only restore if same org and less than 24h old
        if (
          data.organizationId === activeOrganization &&
          Date.now() - data.timestamp < 24 * 60 * 60 * 1000 &&
          data.statuses.some(s => s.status === "pending")
        ) {
          setHasSavedProgress(true);
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, [activeOrganization]);

  const saveProgress = (statuses: ImportStatus[], orgId: string, autoPub: boolean) => {
    const data: SavedProgress = {
      organizationId: orgId,
      autoPublish: autoPub,
      statuses,
      timestamp: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  };

  const clearSavedProgress = () => {
    localStorage.removeItem(STORAGE_KEY);
    setHasSavedProgress(false);
  };

  const parseInvoiceNumbers = (text: string): string[] => {
    return text
      .split(/[\n,;]+/)
      .map(line => line.trim())
      .filter(line => line.length > 0);
  };

  const processInvoice = async (
    invoiceNumber: string,
    index: number,
    orgId: string,
    autoPub: boolean
  ): Promise<ImportStatus> => {
    try {
      const { data, error } = await supabase.functions.invoke("search-import-invoice", {
        body: {
          organization_id: orgId,
          invoice_number: invoiceNumber,
          auto_publish: autoPub,
        },
      });

      if (error) throw error;

      if (data.success) {
        return { invoiceNumber, status: "success", message: data.message };
      } else if (data.existing) {
        return { invoiceNumber, status: "existing", message: "Ya existe en el sistema" };
      } else {
        return { invoiceNumber, status: "error", message: data.message };
      }
    } catch (error: any) {
      return { invoiceNumber, status: "error", message: error.message || "Error desconocido" };
    }
  };

  const handleStartImport = async (resumeFromSaved = false) => {
    let statuses: ImportStatus[];
    let orgId = activeOrganization!;
    let autoPub = autoPublish;

    if (resumeFromSaved) {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const data: SavedProgress = JSON.parse(saved);
      statuses = data.statuses;
      orgId = data.organizationId;
      autoPub = data.autoPublish;
      setAutoPublish(autoPub);
    } else {
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

      statuses = numbers.map(num => ({
        invoiceNumber: num,
        status: "pending" as const,
      }));
    }

    setIsProcessing(true);
    setImportStatuses(statuses);
    abortRef.current = false;

    // Get pending invoices
    const pendingIndices = statuses
      .map((s, idx) => (s.status === "pending" ? idx : -1))
      .filter(idx => idx !== -1);

    const totalToProcess = pendingIndices.length;
    let processedCount = statuses.filter(s => s.status !== "pending").length;

    // Update progress initially
    setProgress((processedCount / statuses.length) * 100);

    // Process in parallel batches
    for (let i = 0; i < pendingIndices.length; i += PARALLEL_COUNT) {
      if (abortRef.current) break;

      const batchIndices = pendingIndices.slice(i, i + PARALLEL_COUNT);
      
      // Mark batch as processing
      setImportStatuses(prev => {
        const updated = [...prev];
        batchIndices.forEach(idx => {
          updated[idx] = { ...updated[idx], status: "processing" };
        });
        return updated;
      });

      // Process batch in parallel
      const results = await Promise.all(
        batchIndices.map(idx => 
          processInvoice(statuses[idx].invoiceNumber, idx, orgId, autoPub)
        )
      );

      // Update statuses with results
      setImportStatuses(prev => {
        const updated = [...prev];
        batchIndices.forEach((idx, resultIdx) => {
          updated[idx] = results[resultIdx];
        });
        // Save progress after each batch
        saveProgress(updated, orgId, autoPub);
        return updated;
      });

      processedCount += batchIndices.length;
      setProgress((processedCount / statuses.length) * 100);

      // Small delay between batches to avoid rate limiting
      if (i + PARALLEL_COUNT < pendingIndices.length && !abortRef.current) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    setIsProcessing(false);
    
    // Get final counts
    const finalStatuses = await new Promise<ImportStatus[]>(resolve => {
      setImportStatuses(prev => {
        resolve(prev);
        return prev;
      });
    });

    const counts = finalStatuses.reduce(
      (acc, s) => {
        acc[s.status] = (acc[s.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    // Clear saved progress if complete
    if (!finalStatuses.some(s => s.status === "pending")) {
      clearSavedProgress();
    }
    
    toast({
      title: abortRef.current ? "Importación pausada" : "Importación completada",
      description: `Éxito: ${counts.success || 0}, Ya existían: ${counts.existing || 0}, Errores: ${counts.error || 0}`,
    });
  };

  const handleAbort = () => {
    abortRef.current = true;
    toast({
      title: "Pausando importación",
      description: "El progreso se guardó. Puede continuar después.",
    });
  };

  const handleClose = () => {
    if (isProcessing) {
      abortRef.current = true;
    }
    setOpen(false);
    // Don't clear statuses if there are pending - they're saved
    if (!importStatuses.some(s => s.status === "pending")) {
      setInvoiceNumbers("");
      setImportStatuses([]);
      setProgress(0);
    }
  };

  const handleResumeFromSaved = () => {
    handleStartImport(true);
  };

  const handleDiscardSaved = () => {
    clearSavedProgress();
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

  const pendingCount = counts.pending || 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 relative">
          <Upload className="h-4 w-4" />
          Importar Lote
          {hasSavedProgress && (
            <span className="absolute -top-1 -right-1 h-3 w-3 bg-orange-500 rounded-full animate-pulse" />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Importación Masiva de Facturas
            <Badge variant="secondary" className="ml-2">
              {PARALLEL_COUNT}x paralelo
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Pegue los números de factura (uno por línea) para buscarlos en Gmail e importarlos a QuickBooks.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Saved progress recovery */}
          {hasSavedProgress && !isProcessing && importStatuses.length === 0 && (
            <div className="p-4 border border-orange-200 bg-orange-50 dark:bg-orange-950 dark:border-orange-800 rounded-lg space-y-3">
              <div className="flex items-center gap-2 text-orange-700 dark:text-orange-300">
                <RotateCcw className="h-5 w-5" />
                <span className="font-medium">Progreso guardado encontrado</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Hay una importación incompleta. ¿Desea continuar donde se quedó?
              </p>
              <div className="flex gap-2">
                <Button onClick={handleResumeFromSaved} size="sm">
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Continuar
                </Button>
                <Button variant="outline" size="sm" onClick={handleDiscardSaved}>
                  Descartar
                </Button>
              </div>
            </div>
          )}

          {!isProcessing && importStatuses.length === 0 && !hasSavedProgress && (
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
                {pendingCount > 0 && (
                  <Badge variant="outline" className="gap-1">
                    <FileText className="h-3 w-3 text-muted-foreground" />
                    Pendientes: {pendingCount}
                  </Badge>
                )}
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

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose}>
            {isProcessing ? "Pausar" : "Cerrar"}
          </Button>
          {!isProcessing && importStatuses.length === 0 && !hasSavedProgress && (
            <Button 
              onClick={() => handleStartImport(false)} 
              disabled={parseInvoiceNumbers(invoiceNumbers).length === 0}
            >
              <Upload className="mr-2 h-4 w-4" />
              Iniciar Importación ({parseInvoiceNumbers(invoiceNumbers).length})
            </Button>
          )}
          {isProcessing && (
            <Button variant="destructive" onClick={handleAbort}>
              Pausar y Guardar
            </Button>
          )}
          {!isProcessing && importStatuses.length > 0 && pendingCount > 0 && (
            <Button onClick={() => handleStartImport(true)}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Continuar ({pendingCount} pendientes)
            </Button>
          )}
          {!isProcessing && importStatuses.length > 0 && pendingCount === 0 && (
            <Button onClick={() => {
              setImportStatuses([]);
              setProgress(0);
              clearSavedProgress();
            }}>
              Nueva Importación
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
