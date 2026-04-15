import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBankImports } from "@/hooks/useBankImports";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BankUploadDialog({ open, onOpenChange }: Props) {
  const { configs, createJob, processJob, refetchJobs } = useBankImports();
  const { activeOrganization } = useAuth();
  const [selectedConfig, setSelectedConfig] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);

  const handleUpload = async () => {
    if (!selectedConfig || !file) {
      toast.error("Selecciona un banco y un archivo");
      return;
    }

    setProcessing(true);
    try {
      // For XLSX files, read as base64 and send to server
      const isXlsx = file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls");
      let contentPayload: any;

      if (isXlsx) {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        contentPayload = { xlsx_base64: btoa(binary) };
      } else {
        contentPayload = { csv_content: await file.text() };
      }

      // Compute hash
      const data = new Uint8Array(await file.arrayBuffer());
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const fileHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

      // Create job
      const job = await createJob.mutateAsync({
        bank_import_config_id: selectedConfig,
        onedrive_file_name: file.name,
        file_hash: fileHash,
        status: "PENDING",
      });

      // Process
      const { data: processResult, error: processError } = await supabase.functions.invoke("process-bank-statement", {
        body: {
          action: isXlsx ? "process_xlsx_content" : "process_csv_content",
          job_id: job.id,
          ...contentPayload,
          organization_id: activeOrganization,
          config_id: selectedConfig,
        },
      });

      if (processError) throw processError;

      if (processResult?.success) {
        toast.success(`Procesado: ${processResult.valid} válidas, ${processResult.invalid} con errores`);

        // Auto-generate CSV
        toast.info("Generando CSV para QuickBooks...");
        const { data: csvResult } = await supabase.functions.invoke("process-bank-statement", {
          body: {
            action: "generate_qbo_csv",
            job_id: job.id,
            organization_id: activeOrganization,
          },
        });

        if (csvResult?.success) {
          toast.success(`CSV listo: ${csvResult.rows_exported} transacciones exportadas`);
        }
      }

      await refetchJobs();
      setFile(null);
      setSelectedConfig("");
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Error procesando archivo");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Subir Estado de Cuenta</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Banco / Configuración</Label>
            {configs.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-1">
                No hay bancos configurados. Ve a la pestaña "Configuración" primero.
              </p>
            ) : (
              <Select value={selectedConfig} onValueChange={setSelectedConfig}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Seleccionar banco..." />
                </SelectTrigger>
                <SelectContent>
                  {configs.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.bank_name} ({c.currency})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div>
            <Label>Archivo (CSV / XLSX)</Label>
            <div className="mt-1">
              <input
                type="file"
                accept=".csv,.txt,.xlsx,.xls"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
              />
            </div>
            {file && (
              <p className="text-xs text-muted-foreground mt-1">
                {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!selectedConfig || !file || processing}
          >
            {processing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Procesando...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Subir y Procesar
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
