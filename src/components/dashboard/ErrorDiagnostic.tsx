import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RefreshCw, Database, FileText, AlertTriangle, CheckCircle, Upload, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface DiagnosticResult {
  id: string;
  doc_number: string;
  supplier_name: string;
  error_message: string;
  has_xml_data: boolean;
  has_xml_content: boolean;
  category: "ready" | "needs_processing" | "missing_data";
}

export const ErrorDiagnostic = () => {
  const { activeOrganization } = useAuth();
  const [diagnostics, setDiagnostics] = useState<DiagnosticResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set());
  const [isPublishingAll, setIsPublishingAll] = useState(false);
  const [stats, setStats] = useState({
    ready: 0,
    needs_processing: 0,
    missing_data: 0,
  });

  const runDiagnostic = async () => {
    if (!activeOrganization) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("processed_documents")
        .select("id, doc_number, supplier_name, error_message, xml_data, file_path")
        .eq("organization_id", activeOrganization)
        .eq("status", "error")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const results: DiagnosticResult[] = (data || []).map((doc: any) => {
        const has_xml_data = doc.xml_data !== null;
        const has_xml_content = doc.file_path !== null;

        let category: "ready" | "needs_processing" | "missing_data";
        if (has_xml_data) {
          category = "ready";
        } else if (has_xml_content) {
          category = "needs_processing";
        } else {
          category = "missing_data";
        }

        return {
          id: doc.id,
          doc_number: doc.doc_number,
          supplier_name: doc.supplier_name,
          error_message: doc.error_message || "",
          has_xml_data,
          has_xml_content,
          category,
        };
      });

      setDiagnostics(results);
      setStats({
        ready: results.filter((r) => r.category === "ready").length,
        needs_processing: results.filter((r) => r.category === "needs_processing").length,
        missing_data: results.filter((r) => r.category === "missing_data").length,
      });

      toast.success(`Diagnóstico completado: ${results.length} documentos analizados`);
    } catch (error: any) {
      console.error("Error running diagnostic:", error);
      toast.error("Error al ejecutar diagnóstico");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (activeOrganization) {
      runDiagnostic();
    }
  }, [activeOrganization]);

  const handleRepublishSingle = async (doc: DiagnosticResult) => {
    if (!activeOrganization) return;
    setPublishingIds(prev => new Set(prev).add(doc.id));
    toast.info(`Republicando ${doc.doc_number}...`);
    try {
      const { data, error } = await supabase.functions.invoke("retry-failed-bills", {
        body: { documentId: doc.id, organizationId: activeOrganization },
      });
      if (error) throw error;
      if (data.success) {
        toast.success(`✓ ${doc.doc_number} publicada exitosamente`);
        runDiagnostic();
      } else {
        toast.error(`Error: ${data.message || data.error}`);
      }
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
    } finally {
      setPublishingIds(prev => { const s = new Set(prev); s.delete(doc.id); return s; });
    }
  };

  const handleRepublishAllReady = async () => {
    if (!activeOrganization) return;
    const readyDocs = diagnostics.filter(d => d.category === "ready");
    if (readyDocs.length === 0) return;
    setIsPublishingAll(true);
    toast.info(`Republicando ${readyDocs.length} facturas...`);
    try {
      const { data, error } = await supabase.functions.invoke("republish-from-extracted-data", {
        body: { organization_id: activeOrganization },
      });
      if (error) throw error;
      const { published, failed } = data.results;
      if (published > 0) {
        toast.success(`✓ ${published} factura${published !== 1 ? 's' : ''} republicada${published !== 1 ? 's' : ''}`);
      }
      if (failed > 0) {
        toast.warning(`${failed} factura${failed !== 1 ? 's' : ''} fallida${failed !== 1 ? 's' : ''}`);
      }
      runDiagnostic();
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
    } finally {
      setIsPublishingAll(false);
    }
  };

  const getCategoryInfo = (category: string) => {
    switch (category) {
      case "ready":
        return {
          label: "Listo para republicar",
          icon: <CheckCircle className="h-4 w-4" />,
          color: "bg-green-500/10 text-green-600 border-green-500/20",
          description: "Tiene datos extraídos (xml_data)",
        };
      case "needs_processing":
        return {
          label: "Necesita reprocesar",
          icon: <FileText className="h-4 w-4" />,
          color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
          description: "Tiene XML sin procesar",
        };
      case "missing_data":
        return {
          label: "Sin datos disponibles",
          icon: <AlertTriangle className="h-4 w-4" />,
          color: "bg-red-500/10 text-red-600 border-red-500/20",
          description: "Requiere re-subida manual",
        };
      default:
        return {
          label: "Desconocido",
          icon: <Database className="h-4 w-4" />,
          color: "bg-muted",
          description: "",
        };
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Diagnóstico de Errores
            </CardTitle>
            <CardDescription>
              Análisis de disponibilidad de datos para recuperación
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {stats.ready > 0 && (
              <Button
                onClick={handleRepublishAllReady}
                disabled={isPublishingAll}
                size="sm"
                variant="default"
                className="bg-green-600 hover:bg-green-700"
              >
                {isPublishingAll ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Republicar Todos ({stats.ready})
              </Button>
            )}
            <Button
              onClick={runDiagnostic}
              disabled={isLoading}
              size="sm"
              variant="outline"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              Actualizar
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Stats Summary */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card className="border-green-500/20 bg-green-500/5">
            <CardContent className="pt-6 text-center">
              <div className="text-3xl font-bold text-green-600">{stats.ready}</div>
              <div className="text-sm text-muted-foreground mt-1">
                Listos para republicar
              </div>
            </CardContent>
          </Card>
          <Card className="border-yellow-500/20 bg-yellow-500/5">
            <CardContent className="pt-6 text-center">
              <div className="text-3xl font-bold text-yellow-600">{stats.needs_processing}</div>
              <div className="text-sm text-muted-foreground mt-1">
                Necesitan reprocesar
              </div>
            </CardContent>
          </Card>
          <Card className="border-red-500/20 bg-red-500/5">
            <CardContent className="pt-6 text-center">
              <div className="text-3xl font-bold text-red-600">{stats.missing_data}</div>
              <div className="text-sm text-muted-foreground mt-1">
                Sin datos disponibles
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Detailed List */}
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-3">
            {diagnostics.map((doc, index) => {
              const categoryInfo = getCategoryInfo(doc.category);
              return (
                <Card key={doc.id} className="border-border/50">
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-medium text-sm">{doc.doc_number}</span>
                          <Badge variant="outline" className={categoryInfo.color}>
                            {categoryInfo.icon}
                            <span className="ml-1">{categoryInfo.label}</span>
                          </Badge>
                        </div>
                        <div className="text-sm text-muted-foreground mb-1">
                          {doc.supplier_name}
                        </div>
                        <div className="text-xs text-muted-foreground italic">
                          {categoryInfo.description}
                        </div>
                      </div>
                      {doc.category === "ready" && (
                        <Button
                          onClick={() => handleRepublishSingle(doc)}
                          disabled={publishingIds.has(doc.id) || isPublishingAll}
                          size="sm"
                          variant="default"
                          className="bg-green-600 hover:bg-green-700 flex-shrink-0"
                        >
                          {publishingIds.has(doc.id) ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <Upload className="h-3 w-3 mr-1" />
                          )}
                          Republicar
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </ScrollArea>

        {diagnostics.length === 0 && !isLoading && (
          <div className="text-center py-8 text-muted-foreground">
            <Database className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p>No hay documentos con error para diagnosticar</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
