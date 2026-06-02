import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: {
    id: string;
    supplier_name: string;
    doc_number: string;
    total_amount: number;
    currency: string;
  } | null;
  onSuccess: () => void;
}

const ACCEPTED = ".pdf,.jpg,.jpeg,.png,.webp";
const MAX_BYTES = 10 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function PayInvoiceDialog({ open, onOpenChange, invoice, onSuccess }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState("");
  const [method, setMethod] = useState("Transferencia");
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setReference("");
    setMethod("Transferencia");
    setLoading(false);
  };

  const handleFile = (f: File | undefined | null) => {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      toast.error("El archivo supera 10 MB");
      return;
    }
    setFile(f);
  };

  const handleSubmit = async () => {
    if (!invoice || !file) return;
    setLoading(true);
    try {
      const base64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("mark-invoice-paid", {
        body: {
          document_id: invoice.id,
          payment_proof_base64: base64,
          filename: file.name,
          payment_reference: reference || undefined,
          payment_method: method || undefined,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Factura marcada como pagada");
      reset();
      onOpenChange(false);
      onSuccess();
    } catch (e: any) {
      toast.error(`Error: ${e.message || "no se pudo marcar como pagada"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Marcar como pagada</DialogTitle>
          <DialogDescription>
            {invoice && (
              <>
                <strong>{invoice.supplier_name}</strong> · {invoice.doc_number} ·{" "}
                {new Intl.NumberFormat("es-CR", {
                  style: "currency",
                  currency: invoice.currency || "CRC",
                  minimumFractionDigits: 0,
                }).format(invoice.total_amount)}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label>Comprobante de transferencia *</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED}
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            {!file ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-2 w-full border-2 border-dashed border-border rounded-md p-6 text-center hover:bg-muted/50 transition-colors"
              >
                <Upload className="mx-auto h-6 w-6 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  Haz clic para seleccionar PDF o imagen
                </p>
                <p className="text-xs text-muted-foreground mt-1">Máx. 10 MB</p>
              </button>
            ) : (
              <div className="mt-2 flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2">
                <span className="text-sm truncate flex-1">{file.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setFile(null)}
                  disabled={loading}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="reference">Referencia (opcional)</Label>
            <Input
              id="reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="# de transferencia / SINPE"
              disabled={loading}
            />
          </div>

          <div>
            <Label htmlFor="method">Método de pago</Label>
            <Input
              id="method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              placeholder="Transferencia, SINPE, Cheque..."
              disabled={loading}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!file || loading}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Subiendo...
              </>
            ) : (
              "Marcar como pagada"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
