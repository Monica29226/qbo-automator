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
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [xmlFile, setXmlFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleXmlFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setXmlFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setXmlContent(content);
    };
    reader.readAsText(file);
  };

  const handlePdfFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPdfFile(file);
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
      // Extraer clave del documento para nombrar archivos
      const docKeyMatch = xmlContent.match(/<Clave>(.*?)<\/Clave>/);
      const docKey = docKeyMatch ? docKeyMatch[1] : `doc_${Date.now()}`;

      let pdfPath = null;
      let xmlPath = null;

      // Subir PDF si existe
      if (pdfFile) {
        const pdfFileName = `${activeOrganization}/${docKey}/${docKey}.pdf`;
        const { error: pdfError } = await supabase.storage
          .from("company-documents")
          .upload(pdfFileName, pdfFile, { upsert: true });

        if (pdfError) {
          console.error("Error uploading PDF:", pdfError);
          toast.error("Error al subir PDF");
          return;
        }
        pdfPath = pdfFileName;
      }

      // Subir XML si existe como archivo
      if (xmlFile) {
        const xmlFileName = `${activeOrganization}/${docKey}/${docKey}.xml`;
        const { error: xmlError } = await supabase.storage
          .from("company-documents")
          .upload(xmlFileName, xmlFile, { upsert: true });

        if (xmlError) {
          console.error("Error uploading XML:", xmlError);
          toast.error("Error al subir XML");
          return;
        }
        xmlPath = xmlFileName;
      } else if (xmlContent.trim()) {
        // Si no hay archivo XML pero hay contenido, crear un Blob y subirlo
        const xmlBlob = new Blob([xmlContent], { type: "application/xml" });
        const xmlFileName = `${activeOrganization}/${docKey}/${docKey}.xml`;
        const { error: xmlError } = await supabase.storage
          .from("company-documents")
          .upload(xmlFileName, xmlBlob, { upsert: true });

        if (xmlError) {
          console.error("Error uploading XML:", xmlError);
          toast.error("Error al subir XML");
          return;
        }
        xmlPath = xmlFileName;
      }

      const { data, error } = await supabase.functions.invoke("process-document", {
        body: { 
          xml_content: xmlContent,
          organization_id: activeOrganization,
          pdf_path: pdfPath,
          xml_path: xmlPath,
          doc_key: docKey,
        },
      });

      if (error) {
        throw error;
      }

      setResult(data);

      if (data.success) {
        if (data.status === "processed") {
          toast.success("Documento procesado y almacenado exitosamente");
        } else if (data.status === "review") {
          toast.warning("Documento almacenado y requiere revisión manual");
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
            <h2 className="text-lg font-semibold mb-4">Cargar Documentos</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="xml-upload" className="cursor-pointer">
                    <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary transition-colors">
                      <FileText className="h-10 w-10 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm font-medium mb-1">
                        Cargar XML
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Factura electrónica
                      </p>
                      {xmlFile && (
                        <p className="text-xs text-success mt-2">✓ {xmlFile.name}</p>
                      )}
                    </div>
                    <input
                      id="xml-upload"
                      type="file"
                      accept=".xml"
                      className="hidden"
                      onChange={handleXmlFileUpload}
                    />
                  </label>
                </div>

                <div>
                  <label htmlFor="pdf-upload" className="cursor-pointer">
                    <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary transition-colors">
                      <FileText className="h-10 w-10 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm font-medium mb-1">
                        Cargar PDF
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Documento visual
                      </p>
                      {pdfFile && (
                        <p className="text-xs text-success mt-2">✓ {pdfFile.name}</p>
                      )}
                    </div>
                    <input
                      id="pdf-upload"
                      type="file"
                      accept=".pdf"
                      className="hidden"
                      onChange={handlePdfFileUpload}
                    />
                  </label>
                </div>
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
                      setPdfFile(null);
                      setXmlFile(null);
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
