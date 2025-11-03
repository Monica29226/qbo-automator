import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FileText, ArrowLeft, Loader2, Upload, FileCheck } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

const UploadDocument = () => {
  const navigate = useNavigate();
  const { activeOrganization } = useAuth();
  const [xmlContent, setXmlContent] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setXmlContent(content);
    };
    reader.readAsText(file);
  };

  const handleProcess = async () => {
    if (!xmlContent.trim()) {
      toast.error("Por favor pegue o cargue un XML");
      return;
    }

    if (!activeOrganization) {
      toast.error("No hay organización activa");
      return;
    }

    setIsProcessing(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke("process-document", {
        body: { 
          xml_content: xmlContent,
          organization_id: activeOrganization,
        },
      });

      if (error) {
        throw error;
      }

      setResult(data);

      if (data.success) {
        if (data.status === "processed") {
          toast.success("Documento procesado exitosamente");
        } else if (data.status === "review") {
          toast.warning("Documento requiere revisión manual");
        }
      } else {
        toast.error(data.message || "Error al procesar documento");
      }
    } catch (error) {
      console.error("Error processing document:", error);
      toast.error("Error al procesar documento");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/dashboard">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Volver
              </Link>
            </Button>
            <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
              <Upload className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Cargar Documento</h1>
              <p className="text-xs text-muted-foreground">Procesar factura o nota de crédito XML</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 max-w-4xl">
        <div className="grid gap-6">
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Cargar XML de Factura</h2>
            <div className="space-y-4">
              <div>
                <label htmlFor="file-upload" className="cursor-pointer">
                  <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary transition-colors">
                    <FileText className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-sm font-medium mb-1">
                      Haga clic para cargar archivo XML
                    </p>
                    <p className="text-xs text-muted-foreground">
                      o arrastre y suelte aquí
                    </p>
                  </div>
                  <input
                    id="file-upload"
                    type="file"
                    accept=".xml"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </label>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">O pegue el XML aquí</span>
                </div>
              </div>

              <Textarea
                placeholder="Pegue aquí el contenido del XML de factura electrónica..."
                value={xmlContent}
                onChange={(e) => setXmlContent(e.target.value)}
                className="min-h-[300px] font-mono text-sm"
              />

              <Button
                onClick={handleProcess}
                disabled={isProcessing || !xmlContent.trim()}
                className="w-full"
                size="lg"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Procesando documento...
                  </>
                ) : (
                  <>
                    <FileCheck className="mr-2 h-5 w-5" />
                    Procesar Documento
                  </>
                )}
              </Button>
            </div>
          </Card>

          {result && (
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">Resultado del Procesamiento</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <span className="text-sm font-medium">Estado:</span>
                  <span
                    className={`font-semibold ${
                      result.status === "processed"
                        ? "text-success"
                        : result.status === "review"
                        ? "text-warning"
                        : result.status === "duplicate"
                        ? "text-muted-foreground"
                        : "text-destructive"
                    }`}
                  >
                    {result.status === "processed"
                      ? "✓ Procesado"
                      : result.status === "review"
                      ? "⚠ En Revisión"
                      : result.status === "duplicate"
                      ? "Duplicado"
                      : "✗ Error"}
                  </span>
                </div>

                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-sm font-medium mb-1">Mensaje:</p>
                  <p className="text-sm text-muted-foreground">{result.message}</p>
                </div>

                {result.classification_reason && (
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm font-medium mb-1">Clasificación:</p>
                    <p className="text-sm text-muted-foreground">{result.classification_reason}</p>
                  </div>
                )}

                <div className="flex gap-3">
                  {result.status === "review" && (
                    <Button
                      variant="outline"
                      onClick={() => navigate("/review-queue")}
                      className="flex-1"
                    >
                      Ir a Cola de Revisión
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => {
                      setXmlContent("");
                      setResult(null);
                    }}
                    className="flex-1"
                  >
                    Procesar Otro
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
};

export default UploadDocument;
