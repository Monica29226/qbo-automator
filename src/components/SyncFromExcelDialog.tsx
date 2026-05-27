import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Upload, CheckCircle2, XCircle, AlertCircle, FileText } from "lucide-react";

interface SyncResult {
  total: number;
  already_in_qbo: number;
  already_in_db: number;
  found_and_processed: number;
  not_found: number;
  failed: number;
  details?: Array<{
    doc_number: string;
    emisor: string;
    status: string;
    error?: string;
  }>;
}

export const SyncFromExcelDialog = () => {
  const { activeOrganization } = useAuth();
  const [open, setOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !activeOrganization) return;

    setIsProcessing(true);
    setResult(null);
    setOpen(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("organization_id", activeOrganization);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No session");

      const { data, error } = await supabase.functions.invoke("sync-from-excel", {
        body: formData,
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (error) throw error;

      setResult(data as SyncResult);

      if (data.found_and_processed > 0) {
        toast.success(`✅ ${data.found_and_processed} documentos procesados exitosamente`);
        setTimeout(() => {
          window.location.reload();
        }, 3000);
      }
    } catch (error) {
      console.error("Error syncing from Excel:", error);
      toast.error("Error al procesar el archivo Excel");
      setOpen(false);
    } finally {
      setIsProcessing(false);
      event.target.value = "";
    }
  };

  const handleClose = () => {
    if (!isProcessing) {
      setOpen(false);
      setResult(null);
    }
  };

  return (
    <>
      <input
        type="file"
        accept=".xlsx,.xls"
        onChange={handleFileUpload}
        style={{ display: "none" }}
        id="excel-upload-dialog"
        disabled={isProcessing}
      />
      <Button
        onClick={() => document.getElementById("excel-upload-dialog")?.click()}
        className="w-full"
        disabled={isProcessing}
      >
        <Upload className="h-4 w-4 mr-2" />
        Sincronizar desde Excel
      </Button>

      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sincronización desde Excel</DialogTitle>
            <DialogDescription>
              {isProcessing
                ? "Procesando documentos del archivo Excel..."
                : "Resultado de la sincronización"}
            </DialogDescription>
          </DialogHeader>

          {isProcessing && (
            <div className="space-y-4 py-4">
              <div className="flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
              </div>
              <Progress value={undefined} className="w-full" />
              <p className="text-center text-sm text-muted-foreground">
                Buscando documentos en todos los correos conectados (Hostinger, Bluehost, Gmail, Outlook) y procesándolos...
              </p>
            </div>
          )}

          {!isProcessing && result && (
            <div className="space-y-4 py-4">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-secondary/50 rounded-lg p-3 border">
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Total</span>
                  </div>
                  <p className="text-2xl font-bold">{result.total}</p>
                </div>

                {result.found_and_processed > 0 && (
                  <div className="bg-green-500/10 rounded-lg p-3 border border-green-500/20">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span className="text-sm font-medium">Procesados</span>
                    </div>
                    <p className="text-2xl font-bold text-green-600">{result.found_and_processed}</p>
                  </div>
                )}

                {result.already_in_qbo > 0 && (
                  <div className="bg-blue-500/10 rounded-lg p-3 border border-blue-500/20">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle2 className="h-4 w-4 text-blue-600" />
                      <span className="text-sm font-medium">Ya en QuickBooks</span>
                    </div>
                    <p className="text-2xl font-bold text-blue-600">{result.already_in_qbo}</p>
                  </div>
                )}

                {result.already_in_db > 0 && (
                  <div className="bg-yellow-500/10 rounded-lg p-3 border border-yellow-500/20">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertCircle className="h-4 w-4 text-yellow-600" />
                      <span className="text-sm font-medium">Ya en Base de Datos</span>
                    </div>
                    <p className="text-2xl font-bold text-yellow-600">{result.already_in_db}</p>
                  </div>
                )}

                {result.not_found > 0 && (
                  <div className="bg-orange-500/10 rounded-lg p-3 border border-orange-500/20">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertCircle className="h-4 w-4 text-orange-600" />
                      <span className="text-sm font-medium">No encontrados</span>
                    </div>
                    <p className="text-2xl font-bold text-orange-600">{result.not_found}</p>
                  </div>
                )}

                {result.failed > 0 && (
                  <div className="bg-red-500/10 rounded-lg p-3 border border-red-500/20">
                    <div className="flex items-center gap-2 mb-1">
                      <XCircle className="h-4 w-4 text-red-600" />
                      <span className="text-sm font-medium">Fallidos</span>
                    </div>
                    <p className="text-2xl font-bold text-red-600">{result.failed}</p>
                  </div>
                )}
              </div>

              {/* Details List */}
              {result.details && result.details.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium mb-2">Detalles:</h4>
                  <div className="max-h-60 overflow-y-auto space-y-2 bg-secondary/30 rounded-lg p-3">
                    {result.details.map((detail, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-2 text-xs p-2 bg-background rounded border"
                      >
                        {detail.status === "processed_and_published" && (
                          <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                        )}
                        {detail.status === "already_published" && (
                          <CheckCircle2 className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                        )}
                        {detail.status === "not_found_in_gmail" && (
                          <AlertCircle className="h-4 w-4 text-orange-600 flex-shrink-0 mt-0.5" />
                        )}
                        {detail.status === "failed" && (
                          <XCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                        )}
                        {detail.status !== "processed_and_published" &&
                          detail.status !== "already_published" &&
                          detail.status !== "not_found_in_gmail" &&
                          detail.status !== "failed" && (
                            <AlertCircle className="h-4 w-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                          )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{detail.doc_number}</p>
                          <p className="text-muted-foreground truncate">{detail.emisor}</p>
                          {detail.error && (
                            <p className="text-red-600 mt-1">{detail.error}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end mt-4">
                <Button onClick={handleClose}>Cerrar</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
