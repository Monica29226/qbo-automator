import { useState } from "react";
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
import { Loader2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | null;
  onImported?: () => void;
}

function firstOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SikuImportDialog({ open, onOpenChange, organizationId, onImported }: Props) {
  const [fechaInicio, setFechaInicio] = useState(firstOfMonth());
  const [fechaFin, setFechaFin] = useState(today());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<{ msg: string; needsConfig?: boolean } | null>(null);

  const handleImport = async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data, error: invErr } = await supabase.functions.invoke("siku-fetch-invoices", {
        body: { organization_id: organizationId, fecha_inicio: fechaInicio, fecha_fin: fechaFin },
      });
      if (invErr) throw invErr;
      if (!data?.success) {
        if (data?.code === "no_credentials") {
          setError({ msg: "API key no configurada", needsConfig: true });
        } else {
          setError({ msg: data?.error || "Error al consultar Siku" });
        }
        return;
      }
      setResult(data);
      if ((data.inserted ?? 0) > 0 && onImported) onImported();
    } catch (e: any) {
      setError({ msg: e?.message || "Error al consultar Siku" });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => {
      setResult(null);
      setError(null);
    }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : handleClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar Ingresos desde Siku</DialogTitle>
          <DialogDescription>
            Consulta tus documentos emitidos en Siku y los importa como facturas de venta.
          </DialogDescription>
        </DialogHeader>

        {!result && !loading && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="siku-from">Desde</Label>
                <Input id="siku-from" type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="siku-to">Hasta</Label>
                <Input id="siku-to" type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
              </div>
            </div>
            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm flex gap-2">
                <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-destructive font-medium">{error.msg}</p>
                  {error.needsConfig && (
                    <p>
                      Configure las credenciales de Siku en{" "}
                      <Link to="/integrations" className="underline" onClick={handleClose}>
                        Integraciones
                      </Link>
                      .
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {loading && (
          <div className="py-8 flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Consultando API de Siku...</p>
          </div>
        )}

        {result && (
          <div className="space-y-2 text-sm">
            <p>✅ <strong>{result.inserted}</strong> nuevas facturas importadas</p>
            <p>⏭ <strong>{result.skipped}</strong> ya existían (duplicados)</p>
            <p>❌ <strong>{result.errors}</strong> con errores</p>
            <p className="text-muted-foreground">Total consultado: {result.fetched}</p>
          </div>
        )}

        <DialogFooter>
          {!result && (
            <Button onClick={handleImport} disabled={loading || !organizationId}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Importar
            </Button>
          )}
          <Button variant="outline" onClick={handleClose}>
            {result ? "Cerrar" : "Cancelar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
