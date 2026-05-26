import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Download, Loader2, CheckCircle2, AlertCircle, FileDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

interface ImportResult {
  emailsFound: number;
  emailsWithXml: number;
  emailsWithPdf: number;
  importedNew: number;
  existingSkipped: number;
  missingPdf: number;
  failed: number;
  errorsDetail: string[];
  skippedDetail: Array<{ doc_key?: string; filename?: string; reason: string }>;
  partial: boolean;
  nextSkipCount?: number;
  totalMessagesInRange?: number;
  processedThisSession: number;
}

interface ImportBatchDialogProps {
  onSuccess?: () => void;
}

const MONTHS = [
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

const YEARS = ["2024", "2025", "2026"];

export function ImportBatchDialog({ onSuccess }: ImportBatchDialogProps) {
  const { activeOrganization, organizations } = useAuth();
  const [open, setOpen] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [selectedOrg, setSelectedOrg] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [liveStats, setLiveStats] = useState<ImportResult | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [drainAll, setDrainAll] = useState(false);

  const handleOpen = (val: boolean) => {
    setOpen(val);
    if (val) {
      setSelectedOrg(activeOrganization || "");
      setResult(null);
      setLiveStats(null);
      setProgress(0);
      setStatusMessage("");
    }
  };

  const getOrgIntegrationType = async (orgId: string): Promise<string | null> => {
    const { data } = await supabase
      .from("integration_accounts")
      .select("service_type")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .in("service_type", ["gmail", "bluehost", "hostinger", "outlook", "outlook_imap"])
      .limit(1);
    return data?.[0]?.service_type || null;
  };

  const getFetchFunction = (serviceType: string) => {
    switch (serviceType) {
      case "gmail": return "gmail-fetch-invoices";
      case "bluehost": return "bluehost-fetch-invoices";
      case "hostinger": return "hostinger-fetch-invoices";
      case "outlook": return "outlook-fetch-invoices";
      case "outlook_imap": return "outlook-imap-fetch-invoices";
      default: return null;
    }
  };

  const handleImport = async () => {
    if (!selectedMonth || !selectedYear || !selectedOrg) {
      toast.error("Selecciona mes, año y empresa");
      return;
    }

    setIsProcessing(true);
    setResult(null);
    setLiveStats({
      emailsFound: 0,
      emailsWithXml: 0,
      emailsWithPdf: 0,
      importedNew: 0,
      existingSkipped: 0,
      missingPdf: 0,
      failed: 0,
      errorsDetail: [],
      skippedDetail: [],
      partial: false,
      processedThisSession: 0,
    });
    setProgress(10);
    setStatusMessage("Detectando integración de correo...");

    try {
      const serviceType = await getOrgIntegrationType(selectedOrg);
      if (!serviceType) {
        toast.error("Esta empresa no tiene integración de correo configurada. Ve a Integraciones para conectar una.");
        setIsProcessing(false);
        setProgress(0);
        return;
      }

      const fnName = getFetchFunction(serviceType);
      if (!fnName) {
        toast.error(`Tipo de integración no soportado: ${serviceType}`);
        setIsProcessing(false);
        return;
      }

      setProgress(20);
      setStatusMessage(`Conectando a ${serviceType}...`);

      let totalProcessed = 0;
      let totalFailed = 0;
      let totalEmails = 0;
      let totalEmailsWithXml = 0;
      let totalEmailsWithPdf = 0;
      let totalExistingSkipped = 0;
      let totalMissingPdf = 0;
      const allErrors: string[] = [];
      const allSkipped: Array<{ doc_key?: string; filename?: string; reason: string }> = [];
      let continueProcessing = true;
      // Reanudar desde cursor persistido si el flujo previo quedó parcial (mismo org+proveedor+mes/año)
      const cursorKey = `import_resume_${selectedOrg}_${serviceType}_${selectedYear}_${selectedMonth}`;
      let skipCount = 0;
      try {
        const saved = localStorage.getItem(cursorKey);
        if (saved) {
          const n = parseInt(saved, 10);
          if (Number.isFinite(n) && n > 0) {
            skipCount = n;
            console.log(`[ImportBatch] Resuming from skip_count=${skipCount}`);
          }
        }
      } catch {
        // ignore localStorage errors
      }
      let iteration = 0;
      const maxIterations = drainAll ? 1000 : 80;
      let stagnantStreak = 0;
      let lastNextSkipCount: number | undefined;
      let lastTotalMessages: number | undefined;

      while (continueProcessing && iteration < maxIterations) {
        iteration++;
        setStatusMessage(`Procesando lote ${iteration}...`);
        setProgress(20 + Math.min(70, (iteration / maxIterations) * 70));

        const body: Record<string, unknown> = {
          organization_id: selectedOrg,
          month: parseInt(selectedMonth),
          year: parseInt(selectedYear),
        };

        if (serviceType === "bluehost" || serviceType === "hostinger") {
          body.skip_count = skipCount;
        }

        const { data, error } = await supabase.functions.invoke(fnName, { body });

        if (error) throw error;

        if (data?.success === false) {
          toast.error(data.message || "Error en la importación");
          break;
        }

        const processed = data.invoices_processed || 0;
        const failed = data.invoices_failed || 0;
        totalProcessed += processed;
        totalFailed += failed;
        totalEmails = Math.max(totalEmails, Number(data.total_messages_in_range || data.messages_found || 0));
        totalEmailsWithXml += Number(data.emails_with_xml || 0);
        totalEmailsWithPdf += Number(data.emails_with_pdf || 0);
        totalExistingSkipped += Number(data.invoices_existing_skipped || 0);
        totalMissingPdf += Number(data.invoices_missing_pdf || 0);

        if (Array.isArray(data.errors)) {
          for (const err of data.errors) {
            const detail = typeof err?.error === "string" ? err.error : JSON.stringify(err);
            allErrors.push(detail);
          }
        }
        if (Array.isArray(data.skipped)) {
          for (const s of data.skipped) {
            allSkipped.push({
              doc_key: s?.doc_key,
              filename: s?.filename,
              reason: typeof s?.reason === "string" ? s.reason : JSON.stringify(s),
            });
          }
        }

        lastNextSkipCount = typeof data.next_skip_count === "number" ? data.next_skip_count : undefined;
        lastTotalMessages = Number(data.total_messages_in_range || data.messages_found || totalEmails);

        const updatedStats: ImportResult = {
          emailsFound: totalEmails,
          emailsWithXml: totalEmailsWithXml,
          emailsWithPdf: totalEmailsWithPdf,
          importedNew: totalProcessed,
          existingSkipped: totalExistingSkipped,
          missingPdf: totalMissingPdf,
          failed: totalFailed,
          errorsDetail: allErrors,
          skippedDetail: allSkipped,
          partial: !!data.partial,
          nextSkipCount: lastNextSkipCount,
          totalMessagesInRange: lastTotalMessages,
          processedThisSession: skipCount,
        };
        setLiveStats(updatedStats);
        setStatusMessage(
          `Lote ${iteration}: ${totalProcessed} importadas, ${totalExistingSkipped} omitidas, ${totalFailed} con error (correo ${skipCount}/${lastTotalMessages ?? "?"})`
        );

        if (data.partial && typeof data.next_skip_count === "number" && data.next_skip_count > skipCount) {
          skipCount = data.next_skip_count;
          stagnantStreak = 0;
          try { localStorage.setItem(cursorKey, String(skipCount)); } catch { /* ignore */ }
        } else if (data.partial && drainAll) {
          // Server says partial but skip didn't advance — count stagnant iterations
          stagnantStreak++;
          if (stagnantStreak >= 3) {
            console.warn("[ImportBatch] Drain mode: 3 stagnant iterations, stopping");
            continueProcessing = false;
          }
        } else {
          continueProcessing = false;
        }
      }

      // Si terminamos completamente (no parcial), limpiamos el cursor
      const finishedFully = !continueProcessing && !(lastNextSkipCount && lastTotalMessages && lastNextSkipCount < lastTotalMessages);
      if (finishedFully) {
        try { localStorage.removeItem(cursorKey); } catch { /* ignore */ }
      }

      setProgress(100);
      setStatusMessage("¡Importación completada!");

      const importResult: ImportResult = {
        emailsFound: totalEmails,
        emailsWithXml: totalEmailsWithXml,
        emailsWithPdf: totalEmailsWithPdf,
        importedNew: totalProcessed,
        existingSkipped: totalExistingSkipped,
        missingPdf: totalMissingPdf,
        failed: totalFailed,
        errorsDetail: allErrors,
        skippedDetail: allSkipped,
        partial: !finishedFully,
        nextSkipCount: lastNextSkipCount,
        totalMessagesInRange: lastTotalMessages,
        processedThisSession: skipCount,
      };
      setResult(importResult);

      if (totalProcessed > 0) {
        toast.success(`✓ ${totalProcessed} factura${totalProcessed !== 1 ? "s" : ""} importada${totalProcessed !== 1 ? "s" : ""}`);
      } else if (totalExistingSkipped > 0 || totalEmailsWithXml > 0 || totalEmails > 0) {
        toast.info(
          `Se encontraron correos/facturas, pero no hubo nuevas para importar (${totalExistingSkipped} existentes, ${totalFailed} con error).`
        );
      } else {
        toast.info("No se encontraron correos con facturas para ese período");
      }

      onSuccess?.();
    } catch (error: unknown) {
      console.error("Error importing batch:", error);
      const msg = error instanceof Error ? error.message : "Error desconocido";
      toast.error(`Error: ${msg}`);
      setStatusMessage(`Error: ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button className="w-full h-14 text-base font-semibold shadow-md">
          <Download className="h-5 w-5 mr-2" />
          Importar Lote
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Importar Lote de Facturas
          </DialogTitle>
          <DialogDescription>
            Importa todas las facturas de un mes completo desde el correo configurado de la empresa.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Empresa</Label>
            <Select value={selectedOrg} onValueChange={setSelectedOrg} disabled={isProcessing}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar empresa" />
              </SelectTrigger>
              <SelectContent>
                {organizations.map((org) => (
                  <SelectItem key={org.id} value={org.id}>
                    {org.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Mes</Label>
              <Select value={selectedMonth} onValueChange={setSelectedMonth} disabled={isProcessing}>
                <SelectTrigger>
                  <SelectValue placeholder="Mes" />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Año</Label>
              <Select value={selectedYear} onValueChange={setSelectedYear} disabled={isProcessing}>
                <SelectTrigger>
                  <SelectValue placeholder="Año" />
                </SelectTrigger>
                <SelectContent>
                  {YEARS.map((y) => (
                    <SelectItem key={y} value={y}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-md border p-3 bg-muted/30">
            <Checkbox
              id="drain-all"
              checked={drainAll}
              onCheckedChange={(v) => setDrainAll(!!v)}
              disabled={isProcessing}
              className="mt-0.5"
            />
            <div className="space-y-0.5">
              <Label htmlFor="drain-all" className="text-sm font-medium cursor-pointer">
                Drenar todo el mes (sin límite de iteraciones)
              </Label>
              <p className="text-xs text-muted-foreground">
                Continúa hasta vaciar el mailbox. Úsalo para cerrar el mes en una sola corrida.
              </p>
            </div>
          </div>


          {isProcessing && (
            <div className="space-y-2">
              <Progress value={progress} className="h-2" />
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                {statusMessage}
              </p>
              {liveStats && (
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground rounded-md border p-2">
                  <span>Correos encontrados:</span><span className="text-right font-medium">{liveStats.emailsFound}</span>
                  <span>Correos con XML:</span><span className="text-right font-medium">{liveStats.emailsWithXml}</span>
                  <span>Correos con PDF:</span><span className="text-right font-medium">{liveStats.emailsWithPdf}</span>
                  <span>Facturas nuevas:</span><span className="text-right font-medium">{liveStats.importedNew}</span>
                  <span>Ya existentes:</span><span className="text-right font-medium">{liveStats.existingSkipped}</span>
                  <span>Sin PDF:</span><span className="text-right font-medium">{liveStats.missingPdf}</span>
                  <span>Con error:</span><span className="text-right font-medium">{liveStats.failed}</span>
                </div>
              )}
            </div>
          )}

          {result && (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <span className="font-semibold text-sm">Resultado de Importación</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">Correos encontrados:</span>
                <Badge variant="outline">{result.emailsFound}</Badge>
                <span className="text-muted-foreground">Correos con XML:</span>
                <Badge variant="outline">{result.emailsWithXml}</Badge>
                <span className="text-muted-foreground">Correos con PDF:</span>
                <Badge variant="outline">{result.emailsWithPdf}</Badge>
                <span className="text-muted-foreground">Facturas nuevas:</span>
                <Badge variant="default">{result.importedNew}</Badge>
                <span className="text-muted-foreground">Ya existentes (omitidas):</span>
                <Badge variant="secondary">{result.existingSkipped}</Badge>
                <span className="text-muted-foreground">Importadas sin PDF:</span>
                <Badge variant="secondary">{result.missingPdf}</Badge>
                {result.failed > 0 && (
                  <>
                    <span className="text-muted-foreground">Fallidas:</span>
                    <Badge variant="destructive">{result.failed}</Badge>
                  </>
                )}
              </div>
              {result.partial && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-200">
                  <div className="font-medium mb-1">Importación parcial</div>
                  <p>
                    Se quedaron correos sin recorrer (procesados {result.processedThisSession}
                    {result.totalMessagesInRange ? ` / ${result.totalMessagesInRange}` : ""}).
                    Vuelve a presionar <b>Importar</b> con el mismo mes/empresa para continuar desde donde quedó.
                  </p>
                </div>
              )}
              {result.skippedDetail.length > 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
                  <div className="mb-1 font-medium">Motivos de omisión ({result.skippedDetail.length})</div>
                  <ul className="space-y-1 text-muted-foreground max-h-40 overflow-auto">
                    {result.skippedDetail.slice(0, 20).map((s, idx) => (
                      <li key={`${s.doc_key ?? s.filename ?? idx}-${idx}`}>
                        • {s.doc_key ? s.doc_key.slice(-10) + " " : ""}{s.filename ? `(${s.filename}) ` : ""}— {s.reason}
                      </li>
                    ))}
                    {result.skippedDetail.length > 20 && (
                      <li className="italic">… y {result.skippedDetail.length - 20} más</li>
                    )}
                  </ul>
                </div>
              )}
              {result.errorsDetail.length > 0 && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
                  <div className="mb-1 flex items-center gap-1 font-medium text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    Detalle de errores
                  </div>
                  <ul className="space-y-1 text-muted-foreground">
                    {result.errorsDetail.slice(0, 5).map((error, idx) => (
                      <li key={`${error}-${idx}`}>• {error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isProcessing}>
            Cerrar
          </Button>
          <Button
            onClick={handleImport}
            disabled={isProcessing || !selectedMonth || !selectedYear || !selectedOrg}
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Importando...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Importar
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
