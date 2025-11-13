import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { TestTube, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const TestSingleInvoiceButton = () => {
  const { activeOrganization } = useAuth();
  const [isTesting, setIsTesting] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleTest = async () => {
    if (!activeOrganization) return;

    setIsTesting(true);
    toast.info("Iniciando prueba con factura 00100001010000448004...");

    try {
      const { data, error } = await supabase.functions.invoke("test-single-invoice", {
        body: {
          organization_id: activeOrganization,
          doc_number: "00100001010000448004",
        },
      });

      if (error) throw error;

      setResult(data);
      setShowResult(true);

      if (data.success) {
        toast.success("✓ Prueba completada exitosamente");
      } else {
        toast.error(`Error en la prueba: ${data.error}`);
      }
    } catch (error) {
      console.error("Error testing invoice:", error);
      toast.error("Error al probar la factura");
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <>
      <Button 
        onClick={handleTest}
        disabled={isTesting}
        variant="outline"
        className="w-full"
      >
        {isTesting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Procesando...
          </>
        ) : (
          <>
            <TestTube className="h-4 w-4 mr-2" />
            Probar Factura 00100001010000448004
          </>
        )}
      </Button>

      <Dialog open={showResult} onOpenChange={setShowResult}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Resultado de la Prueba</DialogTitle>
            <DialogDescription>
              Factura: 00100001010000448004
            </DialogDescription>
          </DialogHeader>

          {result && (
            <div className="space-y-4">
              <div className={`p-4 rounded-lg ${result.success ? 'bg-green-50 dark:bg-green-950' : 'bg-red-50 dark:bg-red-950'}`}>
                <div className="font-semibold">
                  {result.success ? '✓ Éxito' : '✗ Error'}
                </div>
                {result.error && (
                  <div className="text-sm mt-2 text-red-600 dark:text-red-400">
                    {result.error}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold">Pasos Ejecutados:</h3>
                {result.steps.map((step: any, index: number) => (
                  <div key={index} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">
                        {step.step}. {step.name}
                      </div>
                      <div className={`text-sm px-2 py-1 rounded ${
                        step.status === 'completed' ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300' :
                        step.status === 'running' ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300' :
                        step.status === 'skipped' ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300' :
                        'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
                      }`}>
                        {step.status}
                      </div>
                    </div>

                    {step.found !== undefined && (
                      <div className="text-sm mt-2 text-muted-foreground">
                        Encontrados: {step.found}
                      </div>
                    )}

                    {step.xml_found !== undefined && (
                      <div className="text-sm mt-2 text-muted-foreground">
                        XML: {step.xml_found ? '✓' : '✗'} | PDF: {step.pdf_found ? '✓' : '✗'}
                      </div>
                    )}

                    {step.document_id && (
                      <div className="text-sm mt-2 text-muted-foreground">
                        ID: {step.document_id} | Cuenta: {step.account_code} | Estado: {step.doc_status}
                      </div>
                    )}

                    {step.published !== undefined && (
                      <div className="text-sm mt-2 text-muted-foreground">
                        Publicados: {step.published} | Fallidos: {step.failed}
                      </div>
                    )}

                    {step.reason && (
                      <div className="text-sm mt-2 text-yellow-600 dark:text-yellow-400">
                        {step.reason}
                      </div>
                    )}

                    {step.errors && step.errors.length > 0 && (
                      <div className="text-sm mt-2 text-red-600 dark:text-red-400">
                        Errores: {JSON.stringify(step.errors)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
