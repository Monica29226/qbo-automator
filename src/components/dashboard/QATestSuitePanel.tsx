import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { CheckCircle2, XCircle, MinusCircle, Play, Loader2, FlaskConical } from "lucide-react";
import { toast } from "sonner";

interface TestResult {
  id: string;
  name: string;
  status: "pass" | "fail" | "skip";
  message: string;
  details?: any;
  duration_ms?: number;
}

const TESTS = [
  { id: "valid_invoice", name: "1. Factura válida → publicable en QBO" },
  { id: "duplicate", name: "2. Factura duplicada → debe bloquearse" },
  { id: "debit_only", name: "3. Factura solo débitos → procesamiento OK" },
  { id: "malformed_xml", name: "4. XML malformado → fallar con mensaje claro" },
  { id: "special_iva", name: "5. IVA especial (13/4/1%) → mapeo correcto" },
];

export const QATestSuitePanel = () => {
  const { activeOrganization } = useAuth();
  const [results, setResults] = useState<TestResult[]>([]);
  const [running, setRunning] = useState(false);
  const [runningTest, setRunningTest] = useState<string | null>(null);

  const runAll = async () => {
    if (!activeOrganization) return;
    setRunning(true);
    setResults([]);
    try {
      toast.info("🧪 Ejecutando suite QA completa...");
      const { data, error } = await supabase.functions.invoke("qa-test-suite", {
        body: { organization_id: activeOrganization },
      });
      if (error) throw error;
      setResults((data as any).results || []);
      const passed = (data as any).results.filter((r: TestResult) => r.status === "pass").length;
      toast.success(`✅ Suite completada: ${passed}/${TESTS.length} tests pasaron`);
    } catch (err) {
      console.error(err);
      toast.error("Error al ejecutar suite QA");
    } finally {
      setRunning(false);
    }
  };

  const runSingle = async (testId: string) => {
    if (!activeOrganization) return;
    setRunningTest(testId);
    try {
      const { data, error } = await supabase.functions.invoke("qa-test-suite", {
        body: { organization_id: activeOrganization, test_id: testId },
      });
      if (error) throw error;
      const newResult = (data as any).results[0];
      setResults((prev) => {
        const filtered = prev.filter((r) => r.id !== testId);
        return [...filtered, newResult];
      });
    } catch (err) {
      console.error(err);
      toast.error("Error al ejecutar test");
    } finally {
      setRunningTest(null);
    }
  };

  const getStatusIcon = (status: TestResult["status"]) => {
    switch (status) {
      case "pass": return <CheckCircle2 className="h-4 w-4 text-success" />;
      case "fail": return <XCircle className="h-4 w-4 text-destructive" />;
      case "skip": return <MinusCircle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: TestResult["status"]) => {
    const variants = {
      pass: "bg-success/20 text-success",
      fail: "bg-destructive/20 text-destructive",
      skip: "bg-muted text-muted-foreground",
    } as const;
    return <Badge variant="secondary" className={variants[status]}>{status.toUpperCase()}</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5" />
          Suite de Pruebas QA
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Ejecuta los 5 casos de prueba críticos contra los datos reales de la organización activa.
          </p>
          <Button onClick={runAll} disabled={running || !activeOrganization}>
            {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            Ejecutar Todo
          </Button>
        </div>

        <div className="space-y-2">
          {TESTS.map((test) => {
            const result = results.find((r) => r.id === test.id);
            const isRunning = runningTest === test.id;
            return (
              <div key={test.id} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1">
                    {result ? getStatusIcon(result.status) : <MinusCircle className="h-4 w-4 text-muted-foreground" />}
                    <span className="text-sm font-medium">{test.name}</span>
                    {result && getStatusBadge(result.status)}
                    {result?.duration_ms && (
                      <span className="text-xs text-muted-foreground">({result.duration_ms}ms)</span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => runSingle(test.id)}
                    disabled={isRunning || running || !activeOrganization}
                  >
                    {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  </Button>
                </div>
                {result && (
                  <p className="text-xs text-muted-foreground pl-6">{result.message}</p>
                )}
                {result?.details && (
                  <details className="pl-6">
                    <summary className="text-xs text-muted-foreground cursor-pointer">Ver detalles</summary>
                    <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto">
                      {JSON.stringify(result.details, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
