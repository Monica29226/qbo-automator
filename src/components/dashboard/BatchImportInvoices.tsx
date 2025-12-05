import { useState, useRef, useEffect } from "react";
import { Upload, Loader2, CheckCircle2, XCircle, AlertCircle, FileText, RotateCcw, Square } from "lucide-react";
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
  processingStep?: string; // Paso actual del proceso
  processingStartTime?: number; // Para mostrar tiempo transcurrido
  // Datos de entrada del Excel
  inputVendorName?: string;
  inputAmount?: number;
  // Detalles de la factura importada
  supplierName?: string;
  issueDate?: string;
  docNumber?: string;
  totalAmount?: number;
  currency?: string;
}

interface ParsedInvoiceLine {
  vendorName: string;
  invoiceNumber: string;
  amount: number;
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
  const [autoPublish, setAutoPublish] = useState(false); // Desactivado por defecto para importación rápida
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

  // Parse lines with format: VendorName | InvoiceNumber | Amount
  // Supports: tab-separated, pipe-separated, or smart detection using invoice number pattern
  const parseInvoiceLines = (text: string): ParsedInvoiceLine[] => {
    return text
      .split(/[\n]+/)
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        // Try tab-separated first (most common from Excel)
        let parts = line.split('\t');
        if (parts.length >= 3) {
          const vendorName = parts[0].trim();
          const invoiceNumber = parts[1].trim();
          const amountStr = parts[2].trim().replace(/[^\d.,\-]/g, '').replace(',', '');
          const amount = parseFloat(amountStr) || 0;
          console.log(`✅ Tab-parsed: vendor="${vendorName}", invoice="${invoiceNumber}", amount=${amount}`);
          return { vendorName, invoiceNumber, amount };
        }
        
        // Try pipe-separated
        parts = line.split('|');
        if (parts.length >= 3) {
          const vendorName = parts[0].trim();
          const invoiceNumber = parts[1].trim();
          const amountStr = parts[2].trim().replace(/[^\d.,\-]/g, '').replace(',', '');
          const amount = parseFloat(amountStr) || 0;
          console.log(`✅ Pipe-parsed: vendor="${vendorName}", invoice="${invoiceNumber}", amount=${amount}`);
          return { vendorName, invoiceNumber, amount };
        }
        
        // Smart detection: find invoice number (20 digits starting with 00)
        const invoiceMatch = line.match(/\b(00\d{18})\b/);
        if (invoiceMatch) {
          const invoiceNumber = invoiceMatch[1];
          const invoiceIndex = line.indexOf(invoiceNumber);
          const vendorName = line.substring(0, invoiceIndex).trim();
          const afterInvoice = line.substring(invoiceIndex + invoiceNumber.length).trim();
          const amountStr = afterInvoice.replace(/[^\d.,\-]/g, '').replace(',', '');
          const amount = parseFloat(amountStr) || 0;
          console.log(`✅ Smart-parsed: vendor="${vendorName}", invoice="${invoiceNumber}", amount=${amount}`);
          return { vendorName, invoiceNumber, amount };
        }
        
        // Try multiple spaces
        parts = line.split(/\s{2,}/);
        if (parts.length >= 3) {
          const vendorName = parts[0].trim();
          const invoiceNumber = parts[1].trim();
          const amountStr = parts[2].trim().replace(/[^\d.,\-]/g, '').replace(',', '');
          const amount = parseFloat(amountStr) || 0;
          console.log(`✅ Space-parsed: vendor="${vendorName}", invoice="${invoiceNumber}", amount=${amount}`);
          return { vendorName, invoiceNumber, amount };
        }
        
        // Fallback: just invoice number
        console.log(`⚠️ Fallback (no parse): line="${line}"`);
        return { vendorName: '', invoiceNumber: line.trim(), amount: 0 };
      })
      .filter(item => item.invoiceNumber.length > 0);
  };
  
  const parsedLines = parseInvoiceLines(invoiceNumbers);

  const processInvoice = async (
    invoiceLine: ParsedInvoiceLine,
    index: number,
    orgId: string,
    autoPub: boolean,
    updateStep?: (idx: number, step: string) => void
  ): Promise<ImportStatus> => {
    console.log(`🔄 [${index}] Iniciando proceso para: ${invoiceLine.invoiceNumber}`);
    console.log(`   Vendor: ${invoiceLine.vendorName}, Monto: ${invoiceLine.amount}`);
    
    try {
      // Paso 1: Llamar edge function
      updateStep?.(index, "📡 Llamando servidor...");
      console.log(`📡 [${index}] Llamando edge function search-import-invoice...`);
      const startTime = Date.now();
      
      // Simular progreso mientras esperamos la respuesta
      const progressInterval = setInterval(() => {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        if (elapsed < 5) {
          updateStep?.(index, `🔍 Buscando en Gmail... (${elapsed}s)`);
        } else if (elapsed < 15) {
          updateStep?.(index, `📄 Procesando XML... (${elapsed}s)`);
        } else if (elapsed < 25) {
          updateStep?.(index, `✅ Validando datos... (${elapsed}s)`);
        } else {
          updateStep?.(index, `📤 Publicando a QB... (${elapsed}s)`);
        }
      }, 1000);
      
      const { data, error } = await supabase.functions.invoke("search-import-invoice", {
        body: {
          organization_id: orgId,
          invoice_number: invoiceLine.invoiceNumber,
          expected_vendor: invoiceLine.vendorName,
          expected_amount: invoiceLine.amount,
          auto_publish: autoPub,
          validate_november_2025: true, // Solo facturas de noviembre 2025
        },
      });
      
      clearInterval(progressInterval);

      const elapsed = Date.now() - startTime;
      console.log(`⏱️ [${index}] Respuesta recibida en ${elapsed}ms`);

      if (error) {
        console.error(`❌ [${index}] Error de supabase:`, error);
        throw error;
      }

      console.log(`📦 [${index}] Data recibida:`, data);

      if (data.success) {
        console.log(`✅ [${index}] Éxito: ${data.message}`);
        const doc = data.document;
        return { 
          invoiceNumber: invoiceLine.invoiceNumber,
          inputVendorName: invoiceLine.vendorName,
          inputAmount: invoiceLine.amount,
          status: "success", 
          message: data.message,
          supplierName: doc?.supplier_name,
          issueDate: doc?.issue_date,
          docNumber: doc?.doc_number,
          totalAmount: doc?.total_amount,
          currency: doc?.currency,
        };
      } else if (data.existing) {
        console.log(`📋 [${index}] Ya existe en sistema`);
        const existing = data.existing;
        return { 
          invoiceNumber: invoiceLine.invoiceNumber,
          inputVendorName: invoiceLine.vendorName,
          inputAmount: invoiceLine.amount,
          status: "existing", 
          message: "Ya existe en el sistema",
          docNumber: existing?.doc_number,
        };
      } else {
        console.log(`⚠️ [${index}] Fallo: ${data.message}`);
        return { 
          invoiceNumber: invoiceLine.invoiceNumber,
          inputVendorName: invoiceLine.vendorName,
          inputAmount: invoiceLine.amount,
          status: "error", 
          message: data.message 
        };
      }
    } catch (error: any) {
      console.error(`💥 [${index}] Exception:`, error);
      return { 
        invoiceNumber: invoiceLine.invoiceNumber,
        inputVendorName: invoiceLine.vendorName,
        inputAmount: invoiceLine.amount,
        status: "error", 
        message: error.message || "Error desconocido" 
      };
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
      const lines = parseInvoiceLines(invoiceNumbers);
      
      if (lines.length === 0) {
        toast({
          title: "Error",
          description: "No hay facturas válidas. Formato: Nombre | Número | Monto",
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
        inputAmount: line.amount,
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
      
      console.log(`📦 Procesando lote ${Math.floor(i/PARALLEL_COUNT) + 1}: indices ${batchIndices.join(', ')}`);
      
      // Mark batch as processing with initial step
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

      // Process batch in parallel with step updates
      console.log(`🚀 Iniciando ${batchIndices.length} procesos en paralelo...`);
      const batchStart = Date.now();
      
      // Función para actualizar paso de una factura específica
      const updateStep = (idx: number, step: string) => {
        setImportStatuses(prev => {
          const updated = [...prev];
          if (updated[idx]?.status === "processing") {
            updated[idx] = { ...updated[idx], processingStep: step };
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
            amount: status.inputAmount || 0,
          };
          console.log(`   → [${idx}] ${line.invoiceNumber} (${line.vendorName})`);
          
          // Actualizar paso: Buscando en Gmail
          updateStep(idx, "🔍 Buscando en Gmail...");
          
          const result = await processInvoice(line, idx, orgId, autoPub, updateStep);
          return result;
        })
      );
      
      console.log(`✅ Lote completado en ${Date.now() - batchStart}ms`);

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

  const getStatusBadge = (status: ImportStatus["status"], processingStep?: string) => {
    switch (status) {
      case "success":
        return <Badge className="bg-green-500">Importada</Badge>;
      case "error":
        return <Badge variant="destructive">Error</Badge>;
      case "existing":
        return <Badge variant="secondary">Existente</Badge>;
      case "processing":
        return (
          <Badge className="bg-blue-500 max-w-[200px] truncate animate-pulse">
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
                <Label htmlFor="invoice-numbers">Facturas de Noviembre 2025 (Nombre | Número | Monto)</Label>
                <Textarea
                  id="invoice-numbers"
                  placeholder="PETROLEOS DELTA COSTA RICA, S.A.	05800104010005503	21302&#10;1-130-671556 SRL	00100001010000101223	32026&#10;AMERICAN DATA NETWORKS S.A.	00100001041026182	258284635&#10;..."
                  value={invoiceNumbers}
                  onChange={(e) => setInvoiceNumbers(e.target.value)}
                  rows={8}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  {parsedLines.length} facturas detectadas - Solo se importarán facturas de Nov 2025
                </p>
              </div>

              {/* Vista previa de datos parseados */}
              {parsedLines.length > 0 && (
                <div className="border rounded-md p-3 bg-muted/30">
                  <Label className="text-xs font-semibold mb-2 block">Vista Previa (verificar parsing):</Label>
                  <ScrollArea className="h-[150px]">
                    <div className="space-y-1 text-xs">
                      {parsedLines.slice(0, 10).map((line, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-2 p-1 bg-background rounded border">
                          <div className="col-span-5 truncate" title={line.vendorName}>
                            <span className="text-muted-foreground">Proveedor:</span>{" "}
                            <span className={line.vendorName ? "font-medium" : "text-red-500"}>
                              {line.vendorName || "⚠️ NO DETECTADO"}
                            </span>
                          </div>
                          <div className="col-span-4 font-mono">
                            <span className="text-muted-foreground">Número:</span>{" "}
                            <span className="font-bold text-primary">{line.invoiceNumber}</span>
                          </div>
                          <div className="col-span-3 font-mono text-right">
                            <span className={line.amount ? "" : "text-red-500"}>
                              {line.amount ? `₡${line.amount.toLocaleString('es-CR')}` : "⚠️ $0"}
                            </span>
                          </div>
                        </div>
                      ))}
                      {parsedLines.length > 10 && (
                        <p className="text-muted-foreground text-center py-2">
                          ... y {parsedLines.length - 10} más
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

              <ScrollArea className="h-[350px] border rounded-md">
                <div className="p-2 space-y-1">
                  {importStatuses.map((status, idx) => (
                    <div
                      key={idx}
                      className={`flex flex-col gap-2 p-3 rounded text-sm border-b last:border-0 ${
                        status.status === "processing" ? "bg-blue-50 dark:bg-blue-950 border-blue-200" : 
                        status.status === "success" ? "bg-green-50/50 dark:bg-green-950/30" :
                        status.status === "error" ? "bg-red-50/50 dark:bg-red-950/30" : ""
                      }`}
                    >
                      {/* Header row: invoice number + status badge */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          {getStatusIcon(status.status)}
                          <span className="font-mono font-bold text-xs text-primary">{status.invoiceNumber}</span>
                        </div>
                        {getStatusBadge(status.status, status.processingStep)}
                      </div>
                      
                      {/* Input data row - always show for pending/processing */}
                      {(status.status === "pending" || status.status === "processing") && (
                        <div className="grid grid-cols-2 gap-2 pl-6 text-xs border-l-2 border-blue-300 ml-2">
                          <div>
                            <span className="text-muted-foreground">Proveedor: </span>
                            <span className="font-medium">{status.inputVendorName || "(sin nombre)"}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Monto: </span>
                            <span className="font-mono font-medium">
                              {status.inputAmount ? `₡${status.inputAmount.toLocaleString('es-CR')}` : "(sin monto)"}
                            </span>
                          </div>
                        </div>
                      )}
                      
                      {/* Detail row: vendor name, date, amount */}
                      {(status.supplierName || status.issueDate || status.totalAmount) && (
                        <div className="flex items-center gap-3 pl-6 text-xs">
                          {status.supplierName && (
                            <span className="text-foreground font-medium truncate max-w-[200px]" title={status.supplierName}>
                              {status.supplierName}
                            </span>
                          )}
                          {status.issueDate && (
                            <span className="text-muted-foreground whitespace-nowrap">
                              {new Date(status.issueDate).toLocaleDateString('es-CR')}
                            </span>
                          )}
                          {status.totalAmount && (
                            <span className="text-muted-foreground font-mono whitespace-nowrap">
                              {status.currency || 'CRC'} {status.totalAmount.toLocaleString('es-CR', { minimumFractionDigits: 2 })}
                            </span>
                          )}
                        </div>
                      )}
                      
                      {/* Error/message row */}
                      {status.message && status.status === "error" && (
                        <div className="pl-6 text-xs text-destructive truncate" title={status.message}>
                          {status.message}
                        </div>
                      )}
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
              Iniciar Importación ({parsedLines.length})
            </Button>
          )}
          {isProcessing && (
            <Button variant="destructive" onClick={handleAbort} className="gap-2">
              <Square className="h-4 w-4 fill-current" />
              Cancelar Importación
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
