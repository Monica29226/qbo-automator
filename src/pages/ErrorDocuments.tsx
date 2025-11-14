import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft, RefreshCw, FileText, Database } from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { PublishAllButton } from "@/components/PublishAllButton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ErrorDiagnostic } from "@/components/dashboard/ErrorDiagnostic";

interface ErrorDocument {
  id: string;
  doc_number: string;
  supplier_name: string;
  issue_date: string;
  total_amount: number;
  error_message: string;
  created_at: string;
}

const ErrorDocuments = () => {
  const { activeOrganization } = useAuth();
  const [documents, setDocuments] = useState<ErrorDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (activeOrganization) {
      fetchErrorDocuments();
    }
  }, [activeOrganization]);

  const fetchErrorDocuments = async () => {
    if (!activeOrganization) return;

    setIsLoading(true);
    const { data, error } = await supabase
      .from("processed_documents")
      .select("id, doc_number, supplier_name, issue_date, total_amount, error_message, created_at")
      .eq("organization_id", activeOrganization)
      .eq("status", "error")
      .order("created_at", { ascending: false });

    if (!error && data) {
      setDocuments(data);
    }
    setIsLoading(false);
  };

  const getErrorSummary = (errorMessage: string) => {
    if (errorMessage.includes("[PERMANENTE]")) {
      return {
        type: "Error Permanente",
        description: errorMessage.replace("[PERMANENTE] Max retries reached (3 attempts) - Original: ", ""),
        solution: "Usar botón 'Forzar Reintento' para resetear contador"
      };
    }
    if (errorMessage.includes("Falta el parámetro Line requerido")) {
      return {
        type: "Sin líneas de detalle",
        description: "El XML no contiene líneas de detalle válidas",
        solution: "Revisar el XML original - puede estar incompleto"
      };
    }
    if (errorMessage.includes("Número no válido") && errorMessage.includes("Gastos por clasificar")) {
      return {
        type: "Cuenta contable inválida",
        description: 'La cuenta "Gastos por clasificar" no existe en QuickBooks',
        solution: "Configurar regla de vendor con cuenta válida"
      };
    }
    if (errorMessage.includes("La longitud de la cadena") && errorMessage.includes("DocNumber")) {
      return {
        type: "Número de factura muy largo",
        description: "QuickBooks acepta máximo 21 caracteres",
        solution: "El número debe acortarse manualmente"
      };
    }
    if (errorMessage.includes("Failed to create vendor")) {
      return {
        type: "Error al crear proveedor",
        description: "No se pudo crear el vendor en QuickBooks",
        solution: "Verificar permisos y conectividad con QuickBooks"
      };
    }
    if (errorMessage.includes("No se pudo determinar cuenta contable")) {
      return {
        type: "Sin regla de clasificación",
        description: "El proveedor no tiene configurada una cuenta contable",
        solution: "Ir a Configuración → Reglas de Vendors y agregar regla"
      };
    }
    return {
      type: "Error desconocido",
      description: errorMessage.substring(0, 100) + "...",
      solution: "Revisar logs completos"
    };
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-CR', {
      style: 'currency',
      currency: 'CRC',
      minimumFractionDigits: 2
    }).format(amount);
  };

  const handleRetry = async (docId: string, docNumber: string) => {
    if (!activeOrganization) return;

    const toastId = toast.loading(`Reintentando procesar ${docNumber}...`);
    
    try {
      // Use the new enhanced retry function that re-extracts and republishes
      const { data, error } = await supabase.functions.invoke("retry-failed-bills", {
        body: { 
          documentId: docId,
          organizationId: activeOrganization
        },
      });

      if (error) throw error;

      if (data.success) {
        toast.success(`✓ ${docNumber} procesado y publicado exitosamente`, { id: toastId });
        // Refresh the list after short delay
        setTimeout(() => fetchErrorDocuments(), 1000);
      } else {
        toast.error(data.message || `Error: ${data.error}`, { id: toastId });
      }

    } catch (error: any) {
      console.error("Error retrying document:", error);
      toast.error(`Error al reintentar: ${error.message}`, { id: toastId });
    }
  };

  const handleRetryAll = async (forceRetry = false) => {
    if (!activeOrganization || documents.length === 0) return;

    const message = forceRetry 
      ? `Forzando reintento de ${documents.length} facturas (incluyendo permanentes)...`
      : `Procesando ${documents.length} facturas con error...`;
    
    const toastId = toast.loading(message);
    
    try {
      const documentIds = documents.map(d => d.id);
      const { data, error } = await supabase.functions.invoke("retry-error-documents", {
        body: { 
          organization_id: activeOrganization,
          document_ids: documentIds,
          force_retry: forceRetry
        },
      });

      if (error) throw error;

      // Show detailed results
      const { fixed, published, skipped_duplicates, failed, errors } = data;
      
      if (published > 0 && failed === 0) {
        toast.success(
          `✓ ${published} factura${published !== 1 ? 's' : ''} publicada${published !== 1 ? 's' : ''} exitosamente` +
          (skipped_duplicates > 0 ? ` (${skipped_duplicates} duplicada${skipped_duplicates !== 1 ? 's' : ''})` : ''),
          { id: toastId, duration: 5000 }
        );
      } else if (published > 0 && failed > 0) {
        toast.warning(
          `${published} publicada${published !== 1 ? 's' : ''}, ${failed} fallida${failed !== 1 ? 's' : ''}` +
          (skipped_duplicates > 0 ? `, ${skipped_duplicates} duplicada${skipped_duplicates !== 1 ? 's' : ''}` : ''),
          { id: toastId, duration: 6000 }
        );
      } else {
        toast.error(
          `No se pudieron procesar las facturas (${failed} error${failed !== 1 ? 'es' : ''})`,
          { id: toastId, duration: 6000 }
        );
      }

      // Refresh the list
      setTimeout(() => fetchErrorDocuments(), 1500);

    } catch (error: any) {
      console.error("Error in retry all:", error);
      toast.error(`Error al reintentar: ${error.message}`, { id: toastId });
    }
  };

  const handleRepublishFromData = async () => {
    if (!activeOrganization) return;

    const toastId = toast.loading("Republicando facturas desde datos extraídos...");

    try {
      const { data, error } = await supabase.functions.invoke("republish-from-extracted-data", {
        body: {
          organization_id: activeOrganization,
        },
      });

      if (error) throw error;

      const { published, failed, skipped } = data.results;

      if (published > 0 && failed === 0) {
        toast.success(
          `✓ ${published} factura${published !== 1 ? 's' : ''} republicada${published !== 1 ? 's' : ''} exitosamente`,
          { id: toastId, duration: 5000 }
        );
      } else if (published > 0 && failed > 0) {
        toast.warning(
          `${published} republicada${published !== 1 ? 's' : ''}, ${failed} fallida${failed !== 1 ? 's' : ''}`,
          { id: toastId, duration: 6000 }
        );
      } else if (skipped > 0) {
        toast.info(
          `No se encontraron facturas con datos extraídos para republicar`,
          { id: toastId, duration: 5000 }
        );
      } else {
        toast.error(
          `No se pudieron republicar las facturas`,
          { id: toastId, duration: 6000 }
        );
      }

      setTimeout(() => fetchErrorDocuments(), 1500);

    } catch (error: any) {
      console.error("Error republishing:", error);
      toast.error(`Error al republicar: ${error.message}`, { id: toastId });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">Cargando facturas con error...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" asChild>
                <Link to="/dashboard">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Volver
                </Link>
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Facturas con Error</h1>
                <p className="text-sm text-muted-foreground">
                  {documents.length} factura{documents.length !== 1 ? 's' : ''} requieren atención
                </p>
              </div>
            </div>
            {documents.length > 0 && (
              <div className="flex gap-2">
                <Button 
                  onClick={handleRepublishFromData}
                  variant="default"
                  className="gap-2"
                >
                  <Database className="h-4 w-4" />
                  Republicar desde Datos
                </Button>
                <Button 
                  onClick={() => handleRetryAll(false)}
                  variant="outline"
                  className="gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Reintentar Todas
                </Button>
                <Button 
                  onClick={() => handleRetryAll(true)}
                  variant="destructive"
                  className="gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Forzar Reintento
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {/* Diagnostic Section */}
        {documents.length > 0 && (
          <div className="mb-8">
            <ErrorDiagnostic />
          </div>
        )}

        {documents.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="text-muted-foreground space-y-4">
              <p className="text-lg mb-2">¡No hay facturas con error! 🎉</p>
              <p className="text-sm">Todas las facturas se han procesado correctamente.</p>
              <div className="mt-6">
                <PublishAllButton />
              </div>
            </div>
          </Card>
        ) : (
          <div className="space-y-4">
            {documents.map((doc) => {
              const errorInfo = getErrorSummary(doc.error_message);
              return (
                <Card key={doc.doc_number} className="p-6 hover:shadow-lg transition-shadow">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-start gap-3 mb-3">
                        <AlertCircle className="h-5 w-5 text-destructive mt-1 flex-shrink-0" />
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="font-semibold text-lg">
                              Factura #{doc.doc_number}
                            </h3>
                            <Badge variant="destructive" className="text-xs">
                              {errorInfo.type}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mb-1">
                            <span className="font-medium">Proveedor:</span> {doc.supplier_name}
                          </p>
                          <p className="text-sm text-muted-foreground mb-1">
                            <span className="font-medium">Fecha:</span> {new Date(doc.issue_date).toLocaleDateString('es-CR')}
                          </p>
                          <p className="text-sm text-muted-foreground mb-3">
                            <span className="font-medium">Monto:</span> {formatCurrency(doc.total_amount)}
                          </p>
                        </div>
                      </div>

                      <div className="bg-muted/30 border border-muted rounded-lg p-4 space-y-2">
                        <div>
                          <p className="text-sm font-medium text-foreground mb-1">
                            📋 Descripción del error:
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {errorInfo.description}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground mb-1">
                            💡 Solución sugerida:
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {errorInfo.solution}
                          </p>
                        </div>
                        
                        {doc.error_message?.includes("[PERMANENTE]") && (
                          <div className="mt-3 p-3 bg-destructive/10 rounded-lg border border-destructive/20">
                            <p className="text-sm font-semibold text-destructive">
                              ⚠️ Error Permanente - Límite de reintentos alcanzado (3 intentos)
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Usa el botón "Forzar Reintento" para resetear el contador e intentar de nuevo
                            </p>
                          </div>
                        )}
                        
                        <div className="pt-2 border-t border-border">
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="gap-2">
                                <FileText className="h-4 w-4" />
                                Ver Error Completo
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-3xl">
                              <DialogHeader>
                                <DialogTitle>Mensaje de Error Completo</DialogTitle>
                                <DialogDescription>
                                  Factura #{doc.doc_number} - {doc.supplier_name}
                                </DialogDescription>
                              </DialogHeader>
                              <ScrollArea className="max-h-[60vh] w-full">
                                <div className="bg-muted/50 p-4 rounded-lg">
                                  <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                                    {doc.error_message}
                                  </pre>
                                </div>
                              </ScrollArea>
                            </DialogContent>
                          </Dialog>
                        </div>
                      </div>

                      {doc.doc_number.length > 21 && (
                        <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                          <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                            ⚠️ Número muy largo: {doc.doc_number.length} caracteres (máx: 21)
                          </p>
                          <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                            Sugerencia: {doc.doc_number.substring(0, 21)}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRetry(doc.id, doc.doc_number)}
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Reintentar
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default ErrorDocuments;
