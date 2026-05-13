import { useState } from "react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Upload, CheckCircle2, XCircle, AlertTriangle, Info, GitCompare } from "lucide-react";

interface TraceStep {
  step: string;
  status: "ok" | "warn" | "error" | "info";
  message: string;
  data?: unknown;
}

interface DebugResult {
  success: boolean;
  parsed?: any;
  trace: TraceStep[];
  organization?: unknown;
  error?: string;
}

interface ProcessResult {
  success: boolean;
  dry_run?: boolean;
  status?: string;
  account_code?: string | null;
  document?: any;
  error?: string;
  rejected?: boolean;
  message?: string;
  reason?: string;
}

interface DiffRow {
  field: string;
  debug: any;
  process: any;
  equal: boolean;
}

const StatusIcon = ({ status }: { status: TraceStep["status"] }) => {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (status === "error") return <XCircle className="h-4 w-4 text-destructive" />;
  if (status === "warn") return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  return <Info className="h-4 w-4 text-muted-foreground" />;
};

// Normalize numbers/strings for comparison
const normVal = (v: any): any => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Math.round(v * 100) / 100;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (!Number.isNaN(n) && /^-?\d+(\.\d+)?$/.test(v.trim())) return Math.round(n * 100) / 100;
    return v.trim();
  }
  return v;
};

const isEqual = (a: any, b: any): boolean => {
  const na = normVal(a);
  const nb = normVal(b);
  if (na === null && nb === null) return true;
  if (typeof na === "object" || typeof nb === "object") {
    return JSON.stringify(na) === JSON.stringify(nb);
  }
  return na === nb;
};

const fmt = (v: any): string => {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

// Build comparable map from debug-xml-parse parsed object
const fromDebug = (p: any) => {
  if (!p) return {};
  return {
    doc_key: p.clave ?? p.doc_key,
    doc_number: p.numeroConsecutivo ?? p.consecutivo,
    doc_type: p.tipoDocumento ?? p.doc_type,
    issue_date: (p.fechaEmision || "").toString().split("T")[0] || null,
    supplier_name: p.emisor?.nombre,
    supplier_tax_id: p.emisor?.identificacion ?? p.emisor?.numero,
    supplier_email: p.emisor?.correo ?? p.emisor?.email,
    receptor_nombre: p.receptor?.nombre,
    receptor_identificacion: p.receptor?.identificacion ?? p.receptor?.numero,
    currency: p.moneda ?? p.codigoMoneda ?? "CRC",
    exchange_rate: p.tipoCambio,
    subtotal: p.subTotal ?? p.totalVentaNeta,
    total_discount: p.totalDescuentos,
    total_tax: p.totalImpuesto,
    total_amount: p.totalComprobante,
    line_count: Array.isArray(p.detalle) ? p.detalle.length : (Array.isArray(p.lineas) ? p.lineas.length : null),
  };
};

// Build comparable map from process-document-xml dry-run document
const fromProcess = (doc: any) => {
  if (!doc) return {};
  const xd = doc.xml_data || {};
  return {
    doc_key: doc.doc_key,
    doc_number: doc.doc_number,
    doc_type: doc.doc_type,
    issue_date: doc.issue_date,
    supplier_name: doc.supplier_name,
    supplier_tax_id: doc.supplier_tax_id,
    supplier_email: doc.supplier_email,
    receptor_nombre: xd.receptor?.nombre,
    receptor_identificacion: xd.receptor?.identificacion,
    currency: doc.currency,
    exchange_rate: doc.exchange_rate,
    subtotal: xd.subTotal,
    total_discount: doc.total_discount,
    total_tax: doc.total_tax,
    total_amount: doc.total_amount,
    line_count: Array.isArray(xd.detalle) ? xd.detalle.length : null,
  };
};

const buildDiff = (debugParsed: any, processDoc: any): DiffRow[] => {
  const a = fromDebug(debugParsed);
  const b = fromProcess(processDoc);
  const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
  return keys.map((k) => ({
    field: k,
    debug: (a as any)[k],
    process: (b as any)[k],
    equal: isEqual((a as any)[k], (b as any)[k]),
  }));
};

export default function XmlDebug() {
  const { activeOrganization, isAdmin, signOut } = useAuth();
  const [xml, setXml] = useState("");
  const [loading, setLoading] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [result, setResult] = useState<DebugResult | null>(null);
  const [processResult, setProcessResult] = useState<ProcessResult | null>(null);
  const [diff, setDiff] = useState<DiffRow[] | null>(null);

  const handleFile = async (file: File) => {
    const text = await file.text();
    setXml(text);
    setResult(null);
    setProcessResult(null);
    setDiff(null);
  };

  const analyze = async () => {
    if (!xml.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("debug-xml-parse", {
        body: { xml_content: xml, organization_id: activeOrganization },
      });
      if (error) throw error;
      setResult(data as DebugResult);
    } catch (e: any) {
      setResult({ success: false, trace: [{ step: "Invocación", status: "error", message: e?.message || "Error" }] });
    } finally {
      setLoading(false);
    }
  };

  const compare = async () => {
    if (!xml.trim() || !activeOrganization) return;
    setComparing(true);
    setProcessResult(null);
    setDiff(null);
    try {
      // Run both in parallel
      const [debugRes, processRes] = await Promise.all([
        supabase.functions.invoke("debug-xml-parse", {
          body: { xml_content: xml, organization_id: activeOrganization },
        }),
        supabase.functions.invoke("process-document-xml", {
          body: { xml_content: xml, organization_id: activeOrganization, dry_run: true },
        }),
      ]);

      if (debugRes.error) throw debugRes.error;
      const debugData = debugRes.data as DebugResult;
      setResult(debugData);

      const procData = (processRes.data || {}) as ProcessResult;
      if (processRes.error) {
        setProcessResult({ success: false, error: processRes.error.message || "Error" });
        return;
      }
      setProcessResult(procData);

      if (debugData.parsed && procData.document) {
        setDiff(buildDiff(debugData.parsed, procData.document));
      }
    } catch (e: any) {
      setProcessResult({ success: false, error: e?.message || "Error" });
    } finally {
      setComparing(false);
    }
  };

  const diffCount = diff?.filter((d) => !d.equal).length ?? 0;

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <DashboardSidebar isAdmin={isAdmin} reviewCount={0} onSignOut={signOut} />
        <main className="flex-1 p-6 space-y-6">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <div>
              <h1 className="text-2xl font-bold">Depuración de XML</h1>
              <p className="text-sm text-muted-foreground">
                Ver el XML crudo, el JSON parseado y comparar contra el procesador real.
              </p>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>1. Cargar XML</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <label>
                    <Upload className="h-4 w-4 mr-2" />
                    Subir archivo .xml
                    <input
                      type="file"
                      accept=".xml,text/xml,application/xml"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                    />
                  </label>
                </Button>
                <Button onClick={analyze} disabled={loading || comparing || !xml.trim()} size="sm">
                  {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Analizar (debug)
                </Button>
                <Button
                  onClick={compare}
                  disabled={loading || comparing || !xml.trim() || !activeOrganization}
                  size="sm"
                  variant="secondary"
                >
                  {comparing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <GitCompare className="h-4 w-4 mr-2" />
                  )}
                  Comparar con process-document-xml
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setXml(""); setResult(null); setProcessResult(null); setDiff(null); }}>
                  Limpiar
                </Button>
              </div>
              <Textarea
                value={xml}
                onChange={(e) => setXml(e.target.value)}
                placeholder="Pega aquí el contenido del XML..."
                className="font-mono text-xs min-h-[180px]"
              />
            </CardContent>
          </Card>

          {result && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Resultado
                  <Badge variant={result.success ? "default" : "destructive"}>
                    {result.success ? "OK" : "Error"}
                  </Badge>
                  {diff && (
                    <Badge variant={diffCount === 0 ? "default" : "destructive"}>
                      {diffCount === 0 ? "Sin diferencias" : `${diffCount} campo(s) difieren`}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue={diff ? "diff" : "trace"}>
                  <TabsList>
                    <TabsTrigger value="trace">Validaciones</TabsTrigger>
                    <TabsTrigger value="parsed">JSON debug</TabsTrigger>
                    {diff && <TabsTrigger value="diff">Comparación</TabsTrigger>}
                    {processResult && <TabsTrigger value="process">JSON process</TabsTrigger>}
                    <TabsTrigger value="raw">XML crudo</TabsTrigger>
                  </TabsList>

                  <TabsContent value="trace" className="space-y-2 mt-4">
                    {result.trace.map((s, i) => (
                      <div key={i} className="border rounded-md p-3">
                        <div className="flex items-start gap-2">
                          <StatusIcon status={s.status} />
                          <div className="flex-1">
                            <div className="font-medium text-sm">{s.step}</div>
                            <div className="text-sm text-muted-foreground">{s.message}</div>
                            {s.data !== undefined && s.data !== null && (
                              <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-auto max-h-64">
                                {JSON.stringify(s.data, null, 2)}
                              </pre>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    {result.error && (
                      <Alert variant="destructive">
                        <AlertDescription>{result.error}</AlertDescription>
                      </Alert>
                    )}
                  </TabsContent>

                  <TabsContent value="parsed" className="mt-4">
                    <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-[600px]">
                      {JSON.stringify(result.parsed ?? {}, null, 2)}
                    </pre>
                  </TabsContent>

                  {diff && (
                    <TabsContent value="diff" className="mt-4 space-y-3">
                      {processResult?.rejected && (
                        <Alert variant="destructive">
                          <AlertDescription>
                            process-document-xml rechazó el XML: {processResult.message || processResult.reason}
                          </AlertDescription>
                        </Alert>
                      )}
                      {processResult?.error && (
                        <Alert variant="destructive">
                          <AlertDescription>process-document-xml: {processResult.error}</AlertDescription>
                        </Alert>
                      )}
                      <div className="overflow-auto border rounded-md">
                        <table className="w-full text-sm">
                          <thead className="bg-muted">
                            <tr>
                              <th className="text-left p-2 w-8"></th>
                              <th className="text-left p-2">Campo</th>
                              <th className="text-left p-2">debug-xml-parse</th>
                              <th className="text-left p-2">process-document-xml</th>
                            </tr>
                          </thead>
                          <tbody>
                            {diff.map((d) => (
                              <tr
                                key={d.field}
                                className={d.equal ? "" : "bg-destructive/10"}
                              >
                                <td className="p-2 align-top">
                                  {d.equal ? (
                                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                                  ) : (
                                    <XCircle className="h-4 w-4 text-destructive" />
                                  )}
                                </td>
                                <td className="p-2 align-top font-mono text-xs">{d.field}</td>
                                <td className="p-2 align-top font-mono text-xs break-all">{fmt(d.debug)}</td>
                                <td className="p-2 align-top font-mono text-xs break-all">{fmt(d.process)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        process-document-xml se ejecutó en modo <code>dry_run</code> (sin guardar en la base de datos).
                      </p>
                    </TabsContent>
                  )}

                  {processResult && (
                    <TabsContent value="process" className="mt-4">
                      <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-[600px]">
                        {JSON.stringify(processResult, null, 2)}
                      </pre>
                    </TabsContent>
                  )}

                  <TabsContent value="raw" className="mt-4">
                    <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-[600px] whitespace-pre-wrap">
                      {xml}
                    </pre>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}
        </main>
      </div>
    </SidebarProvider>
  );
}
