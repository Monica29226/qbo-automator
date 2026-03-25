import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { CheckCircle, AlertTriangle, XCircle, Search, ChevronDown, RefreshCw, Scale } from "lucide-react";

interface ComparisonField {
  field: string;
  xml_value: string | number | null;
  qbo_value: string | number | null;
  match: boolean;
  severity: "ok" | "minor" | "critical";
}

interface ReconcileResult {
  document_id: string;
  doc_number: string;
  supplier_name: string;
  issue_date: string;
  currency: string;
  status: "match" | "minor" | "critical" | "error";
  fields: ComparisonField[];
  error?: string;
}

interface Summary {
  total: number;
  match: number;
  minor: number;
  critical: number;
  error: number;
}

export function ReconcileXmlQboButton() {
  const { activeOrganization } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [results, setResults] = useState<ReconcileResult[]>([]);

  const handleReconcile = async () => {
    if (!activeOrganization) return;
    setLoading(true);
    setSummary(null);
    setResults([]);

    try {
      const { data, error } = await supabase.functions.invoke("reconcile-xml-vs-qbo", {
        body: {
          organization_id: activeOrganization,
          date_from: dateFrom,
          date_to: dateTo,
          limit: 100,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Error desconocido");

      setSummary(data.summary);
      setResults(data.results);

      if (data.summary.critical > 0) {
        toast.error(`${data.summary.critical} facturas con discrepancias críticas`);
      } else if (data.summary.minor > 0) {
        toast.warning(`${data.summary.minor} facturas con discrepancias menores`);
      } else {
        toast.success(`✓ ${data.summary.match} facturas coinciden exactamente`);
      }
    } catch (err: any) {
      toast.error(err.message || "Error al cotejar");
    } finally {
      setLoading(false);
    }
  };

  const handleRepublish = async (documentId: string) => {
    if (!activeOrganization) return;
    toast.info("Republicando factura...");
    try {
      const { data, error } = await supabase.functions.invoke("force-publish-document", {
        body: { organization_id: activeOrganization, document_id: documentId },
      });
      if (error) throw error;
      toast.success(data?.message || "Factura republicada");
    } catch (err: any) {
      toast.error(err.message || "Error al republicar");
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "match": return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "minor": return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case "critical": return <XCircle className="h-4 w-4 text-destructive" />;
      default: return <XCircle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const severityIcon = (severity: string) => {
    switch (severity) {
      case "ok": return <CheckCircle className="h-3 w-3 text-green-600" />;
      case "minor": return <AlertTriangle className="h-3 w-3 text-yellow-500" />;
      case "critical": return <XCircle className="h-3 w-3 text-destructive" />;
      default: return null;
    }
  };

  const formatValue = (v: string | number | null) => {
    if (v === null || v === undefined) return "—";
    if (typeof v === "number") return v.toLocaleString("es-CR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return v;
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2">
        <Scale className="h-4 w-4" />
        Cotejar XML vs QBO
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5" />
              Cotejo XML vs QuickBooks
            </DialogTitle>
            <DialogDescription>
              Compara los datos del XML original contra lo registrado en QuickBooks
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <Label className="text-xs">Desde</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
            </div>
            <div>
              <Label className="text-xs">Hasta</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
            </div>
            <Button onClick={handleReconcile} disabled={loading} className="gap-2">
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {loading ? "Cotejando..." : "Iniciar Cotejo"}
            </Button>
          </div>

          {summary && (
            <div className="flex flex-wrap gap-2 mb-3">
              <Badge variant="default" className="bg-green-600 gap-1">
                <CheckCircle className="h-3 w-3" /> {summary.match} exactas
              </Badge>
              {summary.minor > 0 && (
                <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 gap-1">
                  <AlertTriangle className="h-3 w-3" /> {summary.minor} menores
                </Badge>
              )}
              {summary.critical > 0 && (
                <Badge variant="destructive" className="gap-1">
                  <XCircle className="h-3 w-3" /> {summary.critical} críticas
                </Badge>
              )}
              {summary.error > 0 && (
                <Badge variant="outline" className="gap-1">
                  {summary.error} errores API
                </Badge>
              )}
              <Badge variant="outline">{summary.total} total</Badge>
            </div>
          )}

          <ScrollArea className="max-h-[50vh]">
            <div className="space-y-2">
              {results.map((r) => (
                <Collapsible key={r.document_id}>
                  <div className="border rounded-lg">
                    <CollapsibleTrigger className="w-full p-3 flex items-center justify-between hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-3">
                        {statusIcon(r.status)}
                        <div className="text-left">
                          <span className="text-sm font-medium">{r.supplier_name}</span>
                          <span className="text-xs text-muted-foreground ml-2">{r.doc_number}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{r.issue_date}</span>
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      <div className="px-3 pb-3 border-t">
                        {r.error && (
                          <p className="text-xs text-destructive mt-2">{r.error}</p>
                        )}

                        {r.fields.length > 0 && (
                          <table className="w-full text-xs mt-2">
                            <thead>
                              <tr className="text-muted-foreground">
                                <th className="text-left py-1">Campo</th>
                                <th className="text-right py-1">XML</th>
                                <th className="text-right py-1">QBO</th>
                                <th className="text-center py-1 w-8"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.fields.map((f, i) => (
                                <tr key={i} className={f.severity === "critical" ? "bg-destructive/10" : f.severity === "minor" ? "bg-yellow-50" : ""}>
                                  <td className="py-1 font-medium">{f.field}</td>
                                  <td className="text-right py-1 font-mono">{formatValue(f.xml_value)}</td>
                                  <td className="text-right py-1 font-mono">{formatValue(f.qbo_value)}</td>
                                  <td className="text-center py-1">{severityIcon(f.severity)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}

                        {r.status === "critical" && (
                          <div className="mt-2 flex justify-end">
                            <Button size="sm" variant="destructive" onClick={() => handleRepublish(r.document_id)}>
                              Republicar
                            </Button>
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              ))}

              {results.length === 0 && !loading && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Selecciona un rango de fechas y presiona "Iniciar Cotejo"
                </p>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
