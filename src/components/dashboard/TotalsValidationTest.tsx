import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { PlayCircle, CheckCircle, XCircle, Loader2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface TestResult {
  name: string;
  formula: string;
  input: {
    subtotal: number;
    descuentos: number;
    iva: number;
    total: number;
  };
  calculation: {
    subtotalAfterDiscount: number;
    calculatedTotal: number;
    diff: number;
    isValid: boolean;
  };
  expected: string;
  result: string;
  passed: boolean;
  status: string;
}

interface TestResponse {
  success: boolean;
  summary: {
    total: number;
    passed: number;
    failed: number;
    successRate: string;
  };
  results: TestResult[];
  timestamp: string;
}

export const TotalsValidationTest = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [testResults, setTestResults] = useState<TestResponse | null>(null);

  const runTests = async () => {
    setIsRunning(true);
    toast.info("Ejecutando pruebas de validación...");

    try {
      const { data, error } = await supabase.functions.invoke("test-totals-validation");

      if (error) throw error;

      setTestResults(data);
      
      if (data.summary.failed === 0) {
        toast.success(`✅ Todas las pruebas pasaron (${data.summary.passed}/${data.summary.total})`);
      } else {
        toast.warning(`⚠️ ${data.summary.failed} prueba(s) fallaron de ${data.summary.total}`);
      }
    } catch (error) {
      console.error("Error running tests:", error);
      toast.error("Error al ejecutar las pruebas");
    } finally {
      setIsRunning(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-CR', {
      style: 'currency',
      currency: 'CRC',
      minimumFractionDigits: 2
    }).format(amount);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <PlayCircle className="h-5 w-5 text-primary" />
              Pruebas de Validación de Totales
            </CardTitle>
            <CardDescription>
              Validar fórmulas de cálculo: (Subtotal - Descuentos) + IVA = Total
            </CardDescription>
          </div>
          <Button
            onClick={runTests}
            disabled={isRunning}
            size="sm"
          >
            {isRunning ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Ejecutando...
              </>
            ) : (
              <>
                <PlayCircle className="h-4 w-4 mr-2" />
                Ejecutar Pruebas
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      {testResults && (
        <CardContent>
          <div className="mb-6 p-4 bg-accent/50 rounded-lg">
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold">{testResults.summary.total}</div>
                <div className="text-sm text-muted-foreground">Total</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-600">{testResults.summary.passed}</div>
                <div className="text-sm text-muted-foreground">Pasadas</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-600">{testResults.summary.failed}</div>
                <div className="text-sm text-muted-foreground">Fallidas</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-blue-600">{testResults.summary.successRate}%</div>
                <div className="text-sm text-muted-foreground">Éxito</div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {testResults.results.map((result, index) => (
              <Collapsible key={index}>
                <div className="border rounded-lg">
                  <CollapsibleTrigger className="w-full p-4 hover:bg-accent/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {result.passed ? (
                          <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
                        )}
                        <div className="text-left">
                          <div className="font-medium">{result.name}</div>
                          <div className="text-xs text-muted-foreground">{result.formula}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={result.passed ? "default" : "destructive"}>
                          {result.status}
                        </Badge>
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  
                  <CollapsibleContent>
                    <div className="p-4 border-t bg-accent/20 space-y-3">
                      <div>
                        <div className="text-sm font-semibold mb-2">Valores de Entrada:</div>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>Subtotal: {formatCurrency(result.input.subtotal)}</div>
                          <div>Descuentos: {formatCurrency(result.input.descuentos)}</div>
                          <div>IVA: {formatCurrency(result.input.iva)}</div>
                          <div className="font-semibold">Total: {formatCurrency(result.input.total)}</div>
                        </div>
                      </div>
                      
                      <div>
                        <div className="text-sm font-semibold mb-2">Cálculos:</div>
                        <div className="space-y-1 text-sm">
                          <div>Subtotal después de descuento: {formatCurrency(result.calculation.subtotalAfterDiscount)}</div>
                          <div>Total calculado: {formatCurrency(result.calculation.calculatedTotal)}</div>
                          <div className={result.calculation.diff > 1 ? "text-red-600 font-semibold" : "text-green-600"}>
                            Diferencia: {formatCurrency(result.calculation.diff)}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between pt-2 border-t">
                        <div className="text-sm">
                          <span className="font-semibold">Esperado:</span> {result.expected}
                        </div>
                        <div className="text-sm">
                          <span className="font-semibold">Resultado:</span> {result.result}
                        </div>
                      </div>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            ))}
          </div>

          <div className="mt-4 text-xs text-muted-foreground text-right">
            Ejecutado: {new Date(testResults.timestamp).toLocaleString('es-CR')}
          </div>
        </CardContent>
      )}
    </Card>
  );
};
