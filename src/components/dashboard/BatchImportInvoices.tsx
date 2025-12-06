import { useState, useRef, useEffect, useCallback } from "react";
import { Upload, Loader2, CheckCircle2, XCircle, AlertCircle, FileText, RotateCcw, Square, Clock, Terminal } from "lucide-react";
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
const INVOICE_TIMEOUT_MS = 25000; // 25s max per invoice to allow Gmail search + XML processing

interface ImportStatus {
  invoiceNumber: string;
  status: "pending" | "processing" | "success" | "error" | "existing" | "skipped";
  message?: string;
  processingStep?: string;
  processingStartTime?: number;
  inputVendorName?: string;
  supplierName?: string;
  issueDate?: string;
  docNumber?: string;
  totalAmount?: number;
  currency?: string;
  elapsedMs?: number;
  qbQueued?: boolean;
}

interface ParsedInvoiceLine {
  vendorName: string;
  invoiceNumber: string;
}

interface SavedProgress {
  organizationId: string;
  autoPublish: boolean;
  statuses: ImportStatus[];
  timestamp: number;
}

interface LogEntry {
  timestamp: number;
  message: string;
  type: "info" | "success" | "error" | "warning";
}

export function BatchImportInvoices() {
  const [open, setOpen] = useState(false);
  const [invoiceNumbers, setInvoiceNumbers] = useState("");
  const [autoPublish, setAutoPublish] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importStatuses, setImportStatuses] = useState<ImportStatus[]>([]);
  const [hasSavedProgress, setHasSavedProgress] = useState(false);
  const [liveLog, setLiveLog] = useState<LogEntry[]>([]);
  const [showLog, setShowLog] = useState(true);
  const { toast } = useToast();
  const { activeOrganization } = useAuth();
  const abortRef = useRef(false);
  const logScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll log
  useEffect(() => {
    if (logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
    }
  }, [liveLog]);

  const addLog = useCallback((message: string, type: LogEntry["type"] = "info") => {
    setLiveLog(prev => [...prev.slice(-100), { timestamp: Date.now(), message, type }]);
  }, []);

  // Check for saved progress on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const data: SavedProgress = JSON.parse(saved);
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

  // Parse lines with format: VendorName | InvoiceNumber (simplified - NO amount)
  const parseInvoiceLines = (text: string): ParsedInvoiceLine[] => {
    return text
      .split(/[\n]+/)
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        // Try tab-separated first (from Excel)
        let parts = line.split('\t');
        if (parts.length >= 2) {
          const vendorName = parts[0].trim();
          const invoiceNumber = parts[1].trim();
          return { vendorName, invoiceNumber };
        }
        
        // Try pipe-separated
        parts = line.split('|');
        if (parts.length >= 2) {
          const vendorName = parts[0].trim();
          const invoiceNumber = parts[1].trim();
          return { vendorName, invoiceNumber };
        }
        
        // Smart detection: find invoice number (20 digits starting with 00)
        const invoiceMatch = line.match(/\b(00\d{18})\b/);
        if (invoiceMatch) {
          const invoiceNumber = invoiceMatch[1];
          const invoiceIndex = line.indexOf(invoiceNumber);
          const vendorName = line.substring(0, invoiceIndex).trim();
          return { vendorName, invoiceNumber };
        }
        
        // Try multiple spaces
        parts = line.split(/\s{2,}/);
        if (parts.length >= 2) {
          const vendorName = parts[0].trim();
          const invoiceNumber = parts[1].trim();
          return { vendorName, invoiceNumber };
        }
        
        // Fallback: just invoice number
        return { vendorName: '', invoiceNumber: line.trim() };
      })
      .filter(item => item.invoiceNumber.length > 0);
  };
  
  const parsedLines = parseInvoiceLines(invoiceNumbers);

  const processInvoice = async (
    invoiceLine: ParsedInvoiceLine,
    index: number,
    orgId: string,
    autoPub: boolean,
    updateStep: (idx: number, step: string, elapsed?: number) => void
  ): Promise<ImportStatus> => {
    const startTime = Date.now();
    const invoiceShort = invoiceLine.invoiceNumber.slice(-10);
    
    addLog(`[${index}] 🔄 Iniciando: ${invoiceShort}`, "info");

    // Update progress in real-time
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const seconds = Math.round(elapsed / 1000);
      if (seconds < 3) {
        updateStep(index, `🔍 Gmail... (${seconds}s)`, elapsed);
      } else if (seconds < 6) {
        updateStep(index, `📄 XML... (${seconds}s)`, elapsed);
      } else if (seconds < 10) {
        updateStep(index, `⚙️ Procesando... (${seconds}s)`, elapsed);
      } else {
        updateStep(index, `⏳ Finalizando... (${seconds}s)`, elapsed);
      }
    }, 400);

    try {
      updateStep(index, "📡 Conectando...", 0);
      
      // Use Promise.race for proper timeout handling (supabase.functions.invoke doesn't support AbortController)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("TIMEOUT")), INVOICE_TIMEOUT_MS);
      });
      
      const invokePromise = supabase.functions.invoke("search-import-invoice", {
        body: {
          organization_id: orgId,
          invoice_number: invoiceLine.invoiceNumber,
          expected_vendor: invoiceLine.vendorName,
          auto_publish: autoPub,
          validate_november_2025: true,
        },
      });

      const { data, error } = await Promise.race([invokePromise, timeoutPromise]);

      clearInterval(progressInterval);

      const elapsed = Date.now() - startTime;
      
      if (error) {
        addLog(`[${index}] ❌ Error: ${error.message}`, "error");
        return { 
          invoiceNumber: invoiceLine.invoiceNumber,
          inputVendorName: invoiceLine.vendorName,
          status: "error", 
          message: error.message,
          elapsedMs: elapsed
        };
      }

      if (data.success) {
        const doc = data.document;
        const qbStatus = data.qbQueued ? " (QB→)" : "";
        addLog(`[${index}] ✅ OK${qbStatus}: ${doc?.supplier_name || invoiceShort} (${Math.round(elapsed/1000)}s)`, "success");
        return { 
          invoiceNumber: invoiceLine.invoiceNumber,
          inputVendorName: invoiceLine.vendorName,
          status: "success", 
          message: data.message,
          supplierName: doc?.supplier_name,
          issueDate: doc?.issue_date,
          docNumber: doc?.doc_number,
          totalAmount: doc?.total_amount,
          currency: doc?.currency,
          elapsedMs: elapsed,
          qbQueued: data.qbQueued
        };
      } else if (data.existing) {
        addLog(`[${index}] 📋 Ya existe: ${invoiceShort}`, "warning");
        return { 
          invoiceNumber: invoiceLine.invoiceNumber,
          inputVendorName: invoiceLine.vendorName,
          status: "existing", 
          message: "Ya existe en el sistema",
          docNumber: data.existing?.doc_number,
          elapsedMs: elapsed
        };
      } else if (data.skipped) {
        addLog(`[${index}] ⏭️ Omitido: ${data.message}`, "warning");
        return { 
          invoiceNumber: invoiceLine.invoiceNumber,
          inputVendorName: invoiceLine.vendorName,
          status: "skipped", 
          message: data.message,
          elapsedMs: elapsed
        };
      } else {
        addLog(`[${index}] ⚠️ Fallo: ${data.message}`, "error");
        return { 
          invoiceNumber: invoiceLine.invoiceNumber,
          inputVendorName: invoiceLine.vendorName,
          status: "error", 
          message: data.message,
          elapsedMs: elapsed
        };
      }
    } catch (error: any) {
      clearInterval(progressInterval);
      
      const elapsed = Date.now() - startTime;
      const isTimeout = error.message === "TIMEOUT";
      const errorMsg = isTimeout ? `Timeout después de ${INVOICE_TIMEOUT_MS/1000}s` : (error.message || "Error desconocido");
      addLog(`[${index}] ${isTimeout ? '⏱️' : '💥'} ${errorMsg}`, "error");
      
      return { 
        invoiceNumber: invoiceLine.invoiceNumber,
        inputVendorName: invoiceLine.vendorName,
        status: "error", 
        message: errorMsg,
        elapsedMs: elapsed
      };
    }
  };

  const handleStartImport = async (resumeFromSaved = false) => {
    let statuses: ImportStatus[];
    let orgId = activeOrganization!;
    let autoPub = autoPublish;

    setLiveLog([]);
    addLog("🚀 Iniciando importación masiva...", "info");

    if (resumeFromSaved) {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const data: SavedProgress = JSON.parse(saved);
      statuses = data.statuses;
      orgId = data.organizationId;
      autoPub = data.autoPublish;
      setAutoPublish(autoPub);
      addLog(`📂 Restaurando progreso: ${statuses.filter(s => s.status === "pending").length} pendientes`, "info");
    } else {
      const lines = parseInvoiceLines(invoiceNumbers);
      
      if (lines.length === 0) {
        toast({
          title: "Error",
          description: "No hay facturas válidas. Formato: Proveedor | Número",
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

      statuses = lines.map(line => ({
        invoiceNumber: line.invoiceNumber,
        inputVendorName: line.vendorName,
        status: "pending" as const,
      }));
      
      addLog(`📋 ${statuses.length} facturas a procesar`, "info");
    }

    setIsProcessing(true);
    setImportStatuses(statuses);
    abortRef.current = false;

    const pendingIndices = statuses
      .map((s, idx) => (s.status === "pending" ? idx : -1))
      .filter(idx => idx !== -1);

    let processedCount = statuses.filter(s => s.status !== "pending").length;
    setProgress((processedCount / statuses.length) * 100);

    // Process in parallel batches
    for (let i = 0; i < pendingIndices.length; i += PARALLEL_COUNT) {
      if (abortRef.current) {
        addLog("⏸️ Importación pausada por usuario", "warning");
        break;
      }

      const batchIndices = pendingIndices.slice(i, i + PARALLEL_COUNT);
      const batchNum = Math.floor(i / PARALLEL_COUNT) + 1;
      const totalBatches = Math.ceil(pendingIndices.length / PARALLEL_COUNT);
      
      addLog(`📦 Lote ${batchNum}/${totalBatches}: procesando ${batchIndices.length} facturas`, "info");
      
      // Mark batch as processing
      setImportStatuses(prev => {
        const updated = [...prev];
        batchIndices.forEach(idx => {
          updated[idx] = { 
            ...updated[idx], 
            status: "processing",
            processingStep: "Conectando...",
            processingStartTime: Date.now()
          };
        });
        return updated;
      });

      // Function to update step for specific invoice
      const updateStep = (idx: number, step: string, elapsed?: number) => {
        setImportStatuses(prev => {
          const updated = [...prev];
          if (updated[idx]?.status === "processing") {
            updated[idx] = { ...updated[idx], processingStep: step, elapsedMs: elapsed };
          }
          return updated;
        });
      };
      
      const results = await Promise.all(
        batchIndices.map(async (idx) => {
          const status = statuses[idx];
          const line: ParsedInvoiceLine = {
            vendorName: status.inputVendorName || '',
            invoiceNumber: status.invoiceNumber,
          };
          return processInvoice(line, idx, orgId, autoPub, updateStep);
        })
      );

      // Update statuses with results
      setImportStatuses(prev => {
        const updated = [...prev];
        batchIndices.forEach((idx, resultIdx) => {
          updated[idx] = results[resultIdx];
        });
        saveProgress(updated, orgId, autoPub);
        return updated;
      });

      processedCount += batchIndices.length;
      setProgress((processedCount / statuses.length) * 100);

      // Small delay between batches
      if (i + PARALLEL_COUNT < pendingIndices.length && !abortRef.current) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    setIsProcessing(false);
    
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

    if (!finalStatuses.some(s => s.status === "pending")) {
      clearSavedProgress();
    }
    
    addLog(`✅ Completado: ${counts.success || 0} éxito, ${counts.existing || 0} existentes, ${counts.error || 0} errores`, "success");
    
    toast({
      title: abortRef.current ? "Importación pausada" : "Importación completada",
      description: `Éxito: ${counts.success || 0}, Ya existían: ${counts.existing || 0}, Errores: ${counts.error || 0}`,
    });
  };

  const handleAbort = () => {
    abortRef.current = true;
    addLog("⏹️ Cancelando importación...", "warning");
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
    if (!importStatuses.some(s => s.status === "pending")) {
      setInvoiceNumbers("");
      setImportStatuses([]);
      setProgress(0);
      setLiveLog([]);
    }
  };

  const handleResumeFromSaved = () => {
    handleStartImport(true);
  };

  const handleDiscardSaved = () => {
    clearSavedProgress();
    setImportStatuses([]);
    setProgress(0);
    setLiveLog([]);
  };

  const getStatusIcon = (status: ImportStatus["status"]) => {
    switch (status) {
      case "success":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "error":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "existing":
      case "skipped":
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case "processing":
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      default:
        return <FileText className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (item: ImportStatus) => {
    const { status, processingStep, elapsedMs, qbQueued } = item;
    const elapsedStr = elapsedMs ? ` ${Math.round(elapsedMs/1000)}s` : "";
    switch (status) {
      case "success":
        return (
          <div className="flex gap-1">
            <Badge className="bg-green-500">✓{elapsedStr}</Badge>
            {qbQueued && <Badge variant="outline" className="text-xs">QB→</Badge>}
          </div>
        );
      case "error":
        return <Badge variant="destructive">Error{elapsedStr}</Badge>;
      case "existing":
        return <Badge variant="secondary">Existente</Badge>;
      case "skipped":
        return <Badge variant="outline">Omitido</Badge>;
      case "processing":
        return (
          <Badge className="bg-blue-500 max-w-[180px] truncate animate-pulse">
            {processingStep || "Procesando..."}
          </Badge>
        );
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
      <DialogContent className="sm:max-w-[800px] max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Importación Masiva de Facturas
            <Badge variant="secondary" className="ml-2">
              {PARALLEL_COUNT}x paralelo
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Pegue: Proveedor | Número de Factura (uno por línea)
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
                <Label htmlFor="invoice-numbers">Facturas Nov 2025 (Proveedor | Número)</Label>
                <Textarea
                  id="invoice-numbers"
                  placeholder="PETROLEOS DELTA COSTA RICA, S.A.	05800104010005503&#10;1-130-671556 SRL	00100001010000101223&#10;AMERICAN DATA NETWORKS S.A.	00100001041026182&#10;..."
                  value={invoiceNumbers}
                  onChange={(e) => setInvoiceNumbers(e.target.value)}
                  rows={6}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  {parsedLines.length} facturas detectadas - Solo Nov 2025
                </p>
              </div>

              {/* Vista previa simplificada */}
              {parsedLines.length > 0 && (
                <div className="border rounded-md p-3 bg-muted/30">
                  <Label className="text-xs font-semibold mb-2 block">Vista Previa:</Label>
                  <ScrollArea className="h-[120px]">
                    <div className="space-y-1 text-xs">
                      {parsedLines.slice(0, 8).map((line, idx) => (
                        <div key={idx} className="grid grid-cols-2 gap-2 p-1.5 bg-background rounded border">
                          <div className="truncate" title={line.vendorName}>
                            <span className={line.vendorName ? "font-medium" : "text-red-500"}>
                              {line.vendorName || "⚠️ Sin proveedor"}
                            </span>
                          </div>
                          <div className="font-mono text-primary font-bold truncate">
                            {line.invoiceNumber}
                          </div>
                        </div>
                      ))}
                      {parsedLines.length > 8 && (
                        <p className="text-muted-foreground text-center py-1">
                          ... y {parsedLines.length - 8} más
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              )}

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="auto-publish-batch"
                  checked={autoPublish}
                  onCheckedChange={(checked) => setAutoPublish(checked as boolean)}
                />
                <Label htmlFor="auto-publish-batch" className="text-sm">
                  Publicar automáticamente a QuickBooks
                </Label>
              </div>
            </>
          )}

          {(isProcessing || importStatuses.length > 0) && (
            <div className="space-y-3">
              {/* Progress bar */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span>Progreso: {Math.round(progress)}%</span>
                  <span className="text-muted-foreground">
                    {importStatuses.filter(s => s.status !== "pending" && s.status !== "processing").length} / {importStatuses.length}
                  </span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>

              {/* Status badges */}
              <div className="flex gap-2 flex-wrap">
                <Badge variant="outline" className="gap-1">
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                  {counts.success || 0}
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <AlertCircle className="h-3 w-3 text-yellow-500" />
                  {counts.existing || 0}
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <XCircle className="h-3 w-3 text-red-500" />
                  {counts.error || 0}
                </Badge>
                {pendingCount > 0 && (
                  <Badge variant="outline" className="gap-1">
                    <Clock className="h-3 w-3" />
                    {pendingCount}
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-6 px-2 text-xs"
                  onClick={() => setShowLog(!showLog)}
                >
                  <Terminal className="h-3 w-3 mr-1" />
                  {showLog ? "Ocultar Log" : "Ver Log"}
                </Button>
              </div>

              {/* Live Log Panel */}
              {showLog && liveLog.length > 0 && (
                <div 
                  ref={logScrollRef}
                  className="h-[100px] bg-black/90 text-green-400 font-mono text-[10px] p-2 rounded overflow-y-auto"
                >
                  {liveLog.map((entry, idx) => (
                    <div 
                      key={idx} 
                      className={`${
                        entry.type === "error" ? "text-red-400" : 
                        entry.type === "success" ? "text-green-400" : 
                        entry.type === "warning" ? "text-yellow-400" : "text-gray-300"
                      }`}
                    >
                      <span className="text-gray-500">
                        [{new Date(entry.timestamp).toLocaleTimeString('es-CR')}]
                      </span>{" "}
                      {entry.message}
                    </div>
                  ))}
                </div>
              )}

              {/* Invoice list */}
              <ScrollArea className="h-[250px] border rounded-md">
                <div className="p-2 space-y-1">
                  {importStatuses.map((status, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center gap-2 p-2 rounded text-xs border-b last:border-0 ${
                        status.status === "processing" ? "bg-blue-50 dark:bg-blue-950" : 
                        status.status === "success" ? "bg-green-50/50 dark:bg-green-950/30" :
                        status.status === "error" ? "bg-red-50/50 dark:bg-red-950/30" : ""
                      }`}
                    >
                      {getStatusIcon(status.status)}
                      <span className="font-mono font-bold text-primary truncate max-w-[140px]">
                        {status.invoiceNumber.slice(-12)}
                      </span>
                      <span className="truncate flex-1 text-muted-foreground">
                        {status.supplierName || status.inputVendorName || ""}
                      </span>
                      {status.totalAmount && (
                        <span className="font-mono text-xs whitespace-nowrap">
                          {status.currency || 'CRC'} {status.totalAmount.toLocaleString('es-CR')}
                        </span>
                      )}
                      {getStatusBadge(status)}
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
              disabled={parsedLines.length === 0}
            >
              <Upload className="mr-2 h-4 w-4" />
              Importar ({parsedLines.length})
            </Button>
          )}
          {isProcessing && (
            <Button variant="destructive" onClick={handleAbort} className="gap-2">
              <Square className="h-4 w-4 fill-current" />
              Cancelar
            </Button>
          )}
          {!isProcessing && importStatuses.length > 0 && pendingCount > 0 && (
            <Button onClick={() => handleStartImport(true)}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Continuar ({pendingCount})
            </Button>
          )}
          {!isProcessing && importStatuses.length > 0 && pendingCount === 0 && (
            <Button onClick={() => {
              setImportStatuses([]);
              setProgress(0);
              clearSavedProgress();
              setLiveLog([]);
            }}>
              Nueva Importación
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
