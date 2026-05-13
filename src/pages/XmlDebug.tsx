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
import { Loader2, Upload, CheckCircle2, XCircle, AlertTriangle, Info } from "lucide-react";

interface TraceStep {
  step: string;
  status: "ok" | "warn" | "error" | "info";
  message: string;
  data?: unknown;
}

interface DebugResult {
  success: boolean;
  parsed?: unknown;
  trace: TraceStep[];
  organization?: unknown;
  error?: string;
}

const StatusIcon = ({ status }: { status: TraceStep["status"] }) => {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (status === "error") return <XCircle className="h-4 w-4 text-destructive" />;
  if (status === "warn") return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  return <Info className="h-4 w-4 text-muted-foreground" />;
};

export default function XmlDebug() {
  const { activeOrganization } = useAuth();
  const [xml, setXml] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DebugResult | null>(null);

  const handleFile = async (file: File) => {
    const text = await file.text();
    setXml(text);
    setResult(null);
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

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <DashboardSidebar />
        <main className="flex-1 p-6 space-y-6">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <div>
              <h1 className="text-2xl font-bold">Depuración de XML</h1>
              <p className="text-sm text-muted-foreground">
                Ver el XML crudo, el JSON parseado y cada paso de validación.
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
                <Button onClick={analyze} disabled={loading || !xml.trim()} size="sm">
                  {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Analizar
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setXml(""); setResult(null); }}>
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
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="trace">
                  <TabsList>
                    <TabsTrigger value="trace">Validaciones por paso</TabsTrigger>
                    <TabsTrigger value="parsed">JSON parseado</TabsTrigger>
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
