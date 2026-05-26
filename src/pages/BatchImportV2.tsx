import { useState, useCallback, useMemo } from "react";
import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Upload, Download, FileWarning, CheckCircle2, Clock, X } from "lucide-react";

type ItemStatus = "accepted" | "pending_hacienda" | "rejected" | "duplicate";

interface ResultRow {
  filename: string;
  status: ItemStatus;
  reason?: string;
  doc_key?: string;
  doc_number?: string;
  supplier_name?: string;
  issue_date?: string;
  total_amount?: number;
  currency?: string;
}

interface IncomingFile {
  filename: string;
  data: string; // base64
  kind: "xml" | "pdf";
}

const CHUNK = 30; // files per edge call

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function extractFiles(input: File[]): Promise<IncomingFile[]> {
  const out: IncomingFile[] = [];
  for (const f of input) {
    const lower = f.name.toLowerCase();
    if (lower.endsWith(".zip")) {
      const zip = await JSZip.loadAsync(await f.arrayBuffer());
      const entries = Object.values(zip.files).filter((e) => !e.dir);
      for (const entry of entries) {
        const ln = entry.name.toLowerCase();
        if (ln.endsWith(".xml")) {
          const bytes = await entry.async("uint8array");
          out.push({ filename: entry.name, data: bytesToBase64(bytes), kind: "xml" });
        } else if (ln.endsWith(".pdf")) {
          const bytes = await entry.async("uint8array");
          out.push({ filename: entry.name, data: bytesToBase64(bytes), kind: "pdf" });
        }
      }
    } else if (lower.endsWith(".xml") || lower.endsWith(".pdf")) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      out.push({
        filename: f.name,
        data: bytesToBase64(bytes),
        kind: lower.endsWith(".pdf") ? "pdf" : "xml",
      });
    }
  }
  return out;
}

function detectMissingConsecutives(rows: ResultRow[]): { supplier: string; gaps: string[] }[] {
  const bySupplier = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.supplier_name || !r.doc_number) continue;
    if (!bySupplier.has(r.supplier_name)) bySupplier.set(r.supplier_name, new Set());
    bySupplier.get(r.supplier_name)!.add(r.doc_number);
  }
  const out: { supplier: string; gaps: string[] }[] = [];
  for (const [supplier, set] of bySupplier) {
    const nums = [...set]
      .map((c) => ({ raw: c, tail: parseInt(c.slice(-10), 10) }))
      .filter((x) => Number.isFinite(x.tail))
      .sort((a, b) => a.tail - b.tail);
    if (nums.length < 2) continue;
    const gaps: string[] = [];
    for (let i = 1; i < nums.length; i++) {
      const diff = nums[i].tail - nums[i - 1].tail;
      if (diff > 1 && diff < 50) {
        for (let g = nums[i - 1].tail + 1; g < nums[i].tail; g++) gaps.push(String(g));
      }
    }
    if (gaps.length > 0) out.push({ supplier, gaps });
  }
  return out;
}

function rowsToCSV(rows: ResultRow[]): string {
  const headers = ["Archivo", "Clave", "Consecutivo", "Emisor", "Fecha", "Total", "Moneda", "Estado", "Motivo"];
  const esc = (s: unknown) => {
    const v = String(s ?? "");
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.filename,
        r.doc_key ?? "",
        r.doc_number ?? "",
        r.supplier_name ?? "",
        r.issue_date ?? "",
        r.total_amount ?? "",
        r.currency ?? "",
        r.status,
        r.reason ?? "",
      ]
        .map(esc)
        .join(",")
    );
  }
  return lines.join("\n");
}

const statusBadge = (s: ItemStatus) => {
  if (s === "accepted")
    return (
      <Badge className="bg-green-600 hover:bg-green-700">
        <CheckCircle2 className="h-3 w-3 mr-1" />Importada
      </Badge>
    );
  if (s === "pending_hacienda")
    return (
      <Badge variant="secondary">
        <Clock className="h-3 w-3 mr-1" />Pendiente Hacienda
      </Badge>
    );
  if (s === "duplicate")
    return (
      <Badge className="bg-amber-500 hover:bg-amber-600">
        <FileWarning className="h-3 w-3 mr-1" />Duplicada
      </Badge>
    );
  return (
    <Badge variant="destructive">
      <X className="h-3 w-3 mr-1" />Rechazada
    </Badge>
  );
};

export default function BatchImportV2() {
  const [files, setFiles] = useState<File[]>([]);
  const [monthFilter, setMonthFilter] = useState<string>("");
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);

  const counts = useMemo(() => {
    return {
      total: results.length,
      accepted: results.filter((r) => r.status === "accepted").length,
      pending: results.filter((r) => r.status === "pending_hacienda").length,
      rejected: results.filter((r) => r.status === "rejected").length,
      duplicate: results.filter((r) => r.status === "duplicate").length,
    };
  }, [results]);

  const missingConsec = useMemo(() => detectMissingConsecutives(results), [results]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files);
    setFiles((prev) => [...prev, ...dropped]);
  }, []);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    e.target.value = "";
  };

  const handleProcess = async () => {
    if (files.length === 0) {
      toast.error("Agregá XMLs, PDFs o ZIPs primero");
      return;
    }
    setProcessing(true);
    setProgress(2);
    setResults([]);

    try {
      // Resolve active org
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sesión expirada");
      const { data: active } = await supabase
        .from("user_active_organization")
        .select("organization_id")
        .eq("user_id", user.id)
        .maybeSingle();
      const orgId = active?.organization_id;
      if (!orgId) throw new Error("Sin organización activa");

      // Create batch header
      const { data: batch, error: batchErr } = await supabase
        .from("batch_imports")
        .insert({
          organization_id: orgId,
          created_by: user.id,
          month_filter: monthFilter || null,
          status: "processing",
        })
        .select()
        .single();
      if (batchErr || !batch) throw batchErr ?? new Error("No se pudo crear el lote");
      setBatchId(batch.id);

      // Extract
      toast.info("Extrayendo archivos…");
      const extracted = await extractFiles(files);
      if (extracted.length === 0) throw new Error("No se encontraron XMLs/PDFs en los archivos");

      setProgress(10);

      // Chunked process
      const all: ResultRow[] = [];
      const chunks = Math.ceil(extracted.length / CHUNK);
      for (let i = 0; i < chunks; i++) {
        const slice = extracted.slice(i * CHUNK, (i + 1) * CHUNK);
        const { data, error } = await supabase.functions.invoke("batch-import-process", {
          body: {
            organization_id: orgId,
            batch_id: batch.id,
            month_filter: monthFilter || null,
            files: slice,
          },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        if (Array.isArray(data?.results)) all.push(...data.results);
        setProgress(10 + Math.round(((i + 1) / chunks) * 80));
        setResults([...all]);
      }

      // Finalize (compute missing consecutives + email)
      const missing = detectMissingConsecutives(all);
      await supabase.functions.invoke("batch-import-finalize", {
        body: {
          batch_id: batch.id,
          organization_id: orgId,
          missing_consecutives: missing,
        },
      });

      setProgress(100);
      toast.success(`Lote procesado: ${all.length} archivos`);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Error procesando el lote");
    } finally {
      setProcessing(false);
    }
  };

  const downloadCSV = () => {
    const csv = rowsToCSV(results);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lote-${batchId ?? "reporte"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <h1 className="text-2xl font-bold mb-1">Importación por Lote v2</h1>
      <p className="text-muted-foreground mb-6">
        Subí ZIPs o archivos sueltos (XML factura, XML mensaje receptor de Hacienda y PDF).
      </p>

      <Card className="p-6 mb-6">
        <div className="grid md:grid-cols-[1fr_200px] gap-4 mb-4">
          <div>
            <Label>Mes (opcional, formato YYYY-MM)</Label>
            <Input
              type="month"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              disabled={processing}
            />
          </div>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="border-2 border-dashed rounded-lg p-8 text-center hover:bg-muted/50 transition"
        >
          <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
          <p className="mb-2">Arrastrá archivos aquí o</p>
          <Input
            type="file"
            multiple
            accept=".zip,.xml,.pdf"
            onChange={onPick}
            disabled={processing}
            className="max-w-xs mx-auto"
          />
          {files.length > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              {files.length} archivo(s) seleccionado(s)
            </p>
          )}
        </div>

        <div className="flex gap-2 mt-4">
          <Button onClick={handleProcess} disabled={processing || files.length === 0}>
            {processing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
            Procesar lote
          </Button>
          {files.length > 0 && !processing && (
            <Button variant="outline" onClick={() => setFiles([])}>
              Limpiar
            </Button>
          )}
        </div>

        {processing && (
          <div className="mt-4">
            <Progress value={progress} />
            <p className="text-xs text-muted-foreground mt-1">{progress}%</p>
          </div>
        )}
      </Card>

      {results.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <Card className="p-4">
              <div className="text-2xl font-bold">{counts.total}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </Card>
            <Card className="p-4">
              <div className="text-2xl font-bold text-green-600">{counts.accepted}</div>
              <div className="text-xs text-muted-foreground">Aceptadas</div>
            </Card>
            <Card className="p-4">
              <div className="text-2xl font-bold text-amber-600">{counts.pending}</div>
              <div className="text-xs text-muted-foreground">Pendiente Hacienda</div>
            </Card>
            <Card className="p-4">
              <div className="text-2xl font-bold text-amber-700">{counts.duplicate}</div>
              <div className="text-xs text-muted-foreground">Duplicadas</div>
            </Card>
            <Card className="p-4">
              <div className="text-2xl font-bold text-destructive">{counts.rejected}</div>
              <div className="text-xs text-muted-foreground">Rechazadas</div>
            </Card>
          </div>

          {missingConsec.length > 0 && (
            <Alert className="mb-4">
              <FileWarning className="h-4 w-4" />
              <AlertDescription>
                <b>Posibles facturas faltantes por consecutivo:</b>
                <ul className="mt-2 text-sm list-disc list-inside">
                  {missingConsec.map((m) => (
                    <li key={m.supplier}>
                      {m.supplier}: {m.gaps.slice(0, 10).join(", ")}
                      {m.gaps.length > 10 ? ` … (+${m.gaps.length - 10})` : ""}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-semibold">Detalle</h2>
            <Button variant="outline" onClick={downloadCSV}>
              <Download className="h-4 w-4 mr-2" />
              Descargar CSV
            </Button>
          </div>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Archivo</TableHead>
                  <TableHead>Consecutivo</TableHead>
                  <TableHead>Emisor</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{r.filename}</TableCell>
                    <TableCell className="font-mono text-xs">{r.doc_number ?? "—"}</TableCell>
                    <TableCell>{r.supplier_name ?? "—"}</TableCell>
                    <TableCell>{r.issue_date ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {r.total_amount != null
                        ? `${r.currency ?? ""} ${r.total_amount.toLocaleString()}`
                        : "—"}
                    </TableCell>
                    <TableCell>{statusBadge(r.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.reason ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
