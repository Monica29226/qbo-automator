import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, RefreshCw, Download, AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface AuditRow {
  document_id: string;
  doc_number: string;
  supplier_name: string;
  issue_date: string;
  currency: string;
  xml_total: number;
  xml_tax: number;
  qbo_total: number;
  qbo_tax: number;
  qbo_mode: string;
  qbo_entity_id: string;
  status: "ok" | "tax_separated" | "total_mismatch" | "both" | "error";
  notes: string;
  error?: string;
}

interface Summary {
  total: number;
  ok: number;
  tax_separated: number;
  total_mismatch: number;
  both: number;
  error: number;
  iva_as_expense: boolean;
}

const today = new Date().toISOString().split("T")[0];
const monthAgo = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split("T")[0];
})();

const statusLabel: Record<AuditRow["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  ok: { label: "OK", variant: "secondary" },
  tax_separated: { label: "IVA separado", variant: "destructive" },
  total_mismatch: { label: "Total no cuadra", variant: "destructive" },
  both: { label: "IVA + Total", variant: "destructive" },
  error: { label: "Error", variant: "outline" },
};

export default function AuditIvaMode() {
  const { activeOrganization } = useAuth();
  const [dateFrom, setDateFrom] = useState(monthAgo);
  const [dateTo, setDateTo] = useState(today);
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(false);
  const [republishing, setRepublishing] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [results, setResults] = useState<AuditRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState<"all" | "issues">("issues");

  const runAudit = async () => {
    if (!activeOrganization) {
      toast.error("Selecciona una organización");
      return;
    }
    setLoading(true);
    setResults([]);
    setSummary(null);
    try {
      const { data, error } = await supabase.functions.invoke("audit-iva-mode-vs-qbo", {
        body: {
          organization_id: activeOrganization.id,
          date_from: dateFrom,
          date_to: dateTo,
          limit,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Auditoría falló");
      setResults(data.results || []);
      setSummary(data.summary);
      toast.success(`Auditoría completa: ${data.summary.total} facturas analizadas`);
    } catch (err: any) {
      toast.error(err?.message || "Error en auditoría");
    } finally {
      setLoading(false);
    }
  };

  const republish = async (documentId: string) => {
    setRepublishing(documentId);
    try {
      const { data, error } = await supabase.functions.invoke("republish-from-extracted-data", {
        body: { document_id: documentId, force_uses_tax: false },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Republicado con IVA al gasto");
      setResults((prev) => prev.filter((r) => r.document_id !== documentId));
    } catch (err: any) {
      toast.error(err?.message || "Error republicando");
    } finally {
      setRepublishing(null);
    }
  };

  const republishAllIssues = async () => {
    const targets = results.filter((r) => r.status === "tax_separated" || r.status === "both");
    if (!targets.length) {
      toast.info("Nada para republicar");
      return;
    }
    if (!confirm(`¿Republicar ${targets.length} factura(s) con IVA al gasto? Esto las borrará de QBO y volverá a crearlas.`)) return;
    setBulkRunning(true);
    let ok = 0;
    let fail = 0;
    for (const t of targets) {
      try {
        const { data, error } = await supabase.functions.invoke("republish-from-extracted-data", {
          body: { document_id: t.document_id, force_uses_tax: false },
        });
        if (error || data?.error) fail++;
        else ok++;
      } catch {
        fail++;
      }
    }
    toast.success(`Republicación: ${ok} ok, ${fail} fallaron`);
    setBulkRunning(false);
    runAudit();
  };

  const downloadCsv = () => {
    if (!results.length) return;
    const header = ["Fecha", "Proveedor", "Factura", "Moneda", "Total XML", "IVA XML", "Total QBO", "IVA QBO", "Modo QBO", "Estado", "Notas", "QBO ID"];
    const rows = results.map((r) => [
      r.issue_date,
      `"${(r.supplier_name || "").replace(/"/g, '""')}"`,
      r.doc_number,
      r.currency,
      r.xml_total,
      r.xml_tax,
      r.qbo_total,
      r.qbo_tax,
      r.qbo_mode,
      statusLabel[r.status].label,
      `"${(r.notes || r.error || "").replace(/"/g, '""')}"`,
      r.qbo_entity_id,
    ]);
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auditoria-iva-${activeOrganization?.name || "org"}-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = filter === "issues" ? results.filter((r) => r.status !== "ok") : results;
  const issuesCount = results.filter((r) => r.status !== "ok" && r.status !== "error").length;

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-7xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/dashboard"><ArrowLeft className="h-4 w-4 mr-1" /> Dashboard</Link>
        </Button>
        <h1 className="text-2xl font-bold">Auditoría: IVA como Gasto vs QBO</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Parámetros</CardTitle>
          <CardDescription>
            Compara las facturas publicadas en QuickBooks contra el XML para detectar IVA separado incorrectamente
            (cuando la organización está configurada para mandar el IVA al gasto) y diferencias de totales.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-sm text-muted-foreground">Desde</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Hasta</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Límite</label>
              <Input type="number" value={limit} onChange={(e) => setLimit(Number(e.target.value) || 100)} className="w-24" />
            </div>
            <Button onClick={runAudit} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Auditando..." : "Ejecutar auditoría"}
            </Button>
            {results.length > 0 && (
              <Button variant="outline" onClick={downloadCsv}>
                <Download className="h-4 w-4 mr-2" /> CSV
              </Button>
            )}
          </div>
          {summary && (
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <Badge variant="outline">Total: {summary.total}</Badge>
              <Badge variant="secondary"><CheckCircle2 className="h-3 w-3 mr-1" /> OK: {summary.ok}</Badge>
              {summary.tax_separated > 0 && <Badge variant="destructive">IVA separado: {summary.tax_separated}</Badge>}
              {summary.total_mismatch > 0 && <Badge variant="destructive">Total no cuadra: {summary.total_mismatch}</Badge>}
              {summary.both > 0 && <Badge variant="destructive">Ambos: {summary.both}</Badge>}
              {summary.error > 0 && <Badge variant="outline">Errores: {summary.error}</Badge>}
              <Badge variant={summary.iva_as_expense ? "secondary" : "outline"}>
                Config: IVA {summary.iva_as_expense ? "al gasto" : "separado"}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Resultados ({filtered.length})</CardTitle>
              <CardDescription>
                {issuesCount > 0
                  ? `${issuesCount} factura(s) con problemas que se pueden republicar`
                  : "No se detectaron problemas en este rango"}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setFilter(filter === "all" ? "issues" : "all")}>
                {filter === "all" ? "Solo problemas" : "Mostrar todas"}
              </Button>
              {issuesCount > 0 && (
                <Button size="sm" disabled={bulkRunning} onClick={republishAllIssues}>
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  {bulkRunning ? "Republicando..." : `Republicar ${issuesCount}`}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Proveedor</TableHead>
                    <TableHead>Factura</TableHead>
                    <TableHead className="text-right">Total XML</TableHead>
                    <TableHead className="text-right">IVA XML</TableHead>
                    <TableHead className="text-right">Total QBO</TableHead>
                    <TableHead className="text-right">IVA QBO</TableHead>
                    <TableHead>Modo</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Notas</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.document_id}>
                      <TableCell className="text-xs">{r.issue_date}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={r.supplier_name}>{r.supplier_name}</TableCell>
                      <TableCell className="text-xs font-mono">{r.doc_number?.slice(-8)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.xml_total.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{r.xml_tax.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.qbo_total.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{r.qbo_tax.toLocaleString()}</TableCell>
                      <TableCell className="text-xs">{r.qbo_mode}</TableCell>
                      <TableCell>
                        <Badge variant={statusLabel[r.status].variant}>{statusLabel[r.status].label}</Badge>
                      </TableCell>
                      <TableCell className="text-xs max-w-[280px]">{r.notes || r.error}</TableCell>
                      <TableCell className="text-right">
                        {(r.status === "tax_separated" || r.status === "both") && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={republishing === r.document_id}
                            onClick={() => republish(r.document_id)}
                          >
                            {republishing === r.document_id ? "..." : "Republicar"}
                          </Button>
                        )}
                        {r.qbo_entity_id && (
                          <Button size="sm" variant="ghost" asChild>
                            <a
                              href={`https://app.qbo.intuit.com/app/bill?txnId=${r.qbo_entity_id}`}
                              target="_blank"
                              rel="noreferrer"
                              title="Ver en QBO"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
