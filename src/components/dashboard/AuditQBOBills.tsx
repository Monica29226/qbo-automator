import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Search, CheckCircle, XCircle, Loader2, AlertTriangle, RefreshCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";

interface AuditResult {
  id: string;
  doc_number: string;
  supplier_name: string;
  qbo_entity_id: string;
  total_amount: number;
  currency: string;
  issue_date: string;
  exists_in_qbo: boolean;
  qbo_error?: string;
}

export const AuditQBOBills = () => {
  const { activeOrganization } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isAuditing, setIsAuditing] = useState(false);
  const [isRepublishing, setIsRepublishing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<AuditResult[]>([]);
  const [summary, setSummary] = useState<{ total: number; found: number; missing: number } | null>(null);

  const runAudit = async () => {
    if (!activeOrganization) {
      toast.error("No hay organización activa");
      return;
    }

    setIsAuditing(true);
    setProgress(0);
    setResults([]);
    setSummary(null);

    try {
      // Obtener TODOS los documentos published con qbo_entity_id
      const { data: publishedDocs, error } = await supabase
        .from('processed_documents')
        .select('id, doc_number, supplier_name, qbo_entity_id, qbo_entity_type, total_amount, currency, issue_date')
        .eq('organization_id', activeOrganization)
        .eq('status', 'published')
        .not('qbo_entity_id', 'is', null)
        .order('updated_at', { ascending: false });

      if (error) throw error;

      if (!publishedDocs || publishedDocs.length === 0) {
        toast.info("No hay facturas publicadas para auditar");
        setIsAuditing(false);
        return;
      }

      toast.info(`Auditando ${publishedDocs.length} facturas contra QuickBooks...`);

      // Verificar en lotes de 10 para no saturar la API
      const batchSize = 10;
      const allResults: AuditResult[] = [];

      for (let i = 0; i < publishedDocs.length; i += batchSize) {
        const batch = publishedDocs.slice(i, i + batchSize);
        const billIds = batch.map(d => d.qbo_entity_id).filter(Boolean);

        try {
          const { data: verifyResult, error: verifyError } = await supabase.functions.invoke(
            'verify-qbo-bill-exists',
            {
              body: {
                organization_id: activeOrganization,
                bill_ids: billIds
              }
            }
          );

          if (verifyError) {
            console.error('Error verificando lote:', verifyError);
            // Marcar todos como error
            batch.forEach(doc => {
              allResults.push({
                ...doc,
                exists_in_qbo: false,
                qbo_error: verifyError.message
              });
            });
          } else {
            const qboResults = verifyResult.results || [];
            
            batch.forEach(doc => {
              const qboResult = qboResults.find((r: any) => r.bill_id === doc.qbo_entity_id);
              allResults.push({
                ...doc,
                exists_in_qbo: qboResult?.exists || false,
                qbo_error: qboResult?.error
              });
            });
          }
        } catch (err: any) {
          console.error('Error en lote:', err);
          batch.forEach(doc => {
            allResults.push({
              ...doc,
              exists_in_qbo: false,
              qbo_error: err.message
            });
          });
        }

        setProgress(Math.round(((i + batchSize) / publishedDocs.length) * 100));
        setResults([...allResults]);

        // Pequeña pausa entre lotes
        if (i + batchSize < publishedDocs.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      const found = allResults.filter(r => r.exists_in_qbo).length;
      const missing = allResults.filter(r => !r.exists_in_qbo).length;

      setSummary({
        total: allResults.length,
        found,
        missing
      });

      if (missing > 0) {
        toast.warning(`Auditoría completa: ${missing} facturas NO existen en QuickBooks`);
      } else {
        toast.success(`Auditoría completa: Todas las ${found} facturas existen en QuickBooks`);
      }

    } catch (error: any) {
      console.error("Audit error:", error);
      toast.error(`Error: ${error.message}`);
    } finally {
      setIsAuditing(false);
    }
  };

  const republishMissing = async () => {
    const missingDocs = results.filter(r => !r.exists_in_qbo);
    
    if (missingDocs.length === 0) {
      toast.info("No hay facturas faltantes para republicar");
      return;
    }

    setIsRepublishing(true);

    try {
      // Paso 1: Marcar los documentos faltantes para re-publicación
      const docIds = missingDocs.map(d => d.id);
      
      const { error: updateError } = await supabase
        .from('processed_documents')
        .update({
          qbo_entity_id: null,
          qbo_entity_type: null,
          status: 'pending',
          error_message: null
        })
        .in('id', docIds);

      if (updateError) throw updateError;

      toast.info(`${docIds.length} facturas marcadas para re-publicación. Publicando...`);

      // Paso 2: Publicar
      const { data, error } = await supabase.functions.invoke('publish-to-quickbooks', {
        body: { 
          organization_id: activeOrganization,
          document_ids: docIds
        }
      });

      if (error) throw error;

      const published = data?.published || 0;
      const failed = data?.failed || 0;

      if (published > 0) {
        toast.success(`✅ ${published} facturas republicadas exitosamente`);
      }
      if (failed > 0) {
        toast.warning(`⚠️ ${failed} facturas fallaron al republicar`);
      }

      // Re-ejecutar auditoría
      await runAudit();

    } catch (error: any) {
      console.error("Republish error:", error);
      toast.error(`Error al republicar: ${error.message}`);
    } finally {
      setIsRepublishing(false);
    }
  };

  const formatCurrency = (amount: number, currency: string) => {
    const symbol = currency === "USD" ? "$" : "₡";
    return `${symbol}${amount?.toLocaleString("es-CR", { minimumFractionDigits: 2 })}`;
  };

  const missingCount = results.filter(r => !r.exists_in_qbo).length;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Search className="h-4 w-4 mr-2" />
          Auditar QBO
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Auditoría: Sistema vs QuickBooks</DialogTitle>
          <DialogDescription>
            Verifica que TODAS las facturas marcadas como "published" realmente existan en QuickBooks
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Button 
              onClick={runAudit} 
              disabled={isAuditing || isRepublishing}
              className="flex-1"
            >
              {isAuditing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Auditando... {progress}%
                </>
              ) : (
                <>
                  <Search className="h-4 w-4 mr-2" />
                  Ejecutar Auditoría Completa
                </>
              )}
            </Button>

            {missingCount > 0 && (
              <Button 
                onClick={republishMissing} 
                disabled={isAuditing || isRepublishing}
                variant="destructive"
              >
                {isRepublishing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Republicando...
                  </>
                ) : (
                  <>
                    <RefreshCcw className="h-4 w-4 mr-2" />
                    Republicar {missingCount} faltantes
                  </>
                )}
              </Button>
            )}
          </div>

          {isAuditing && (
            <Progress value={progress} className="w-full" />
          )}

          {summary && (
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-muted text-center">
                <div className="text-2xl font-bold">{summary.total}</div>
                <div className="text-sm text-muted-foreground">Total Auditadas</div>
              </div>
              <div className="p-4 rounded-lg bg-green-100 dark:bg-green-900/30 text-center">
                <div className="text-2xl font-bold text-green-700 dark:text-green-400">{summary.found}</div>
                <div className="text-sm text-green-600 dark:text-green-500">✓ Existen en QBO</div>
              </div>
              <div className={`p-4 rounded-lg text-center ${summary.missing > 0 ? 'bg-red-100 dark:bg-red-900/30' : 'bg-muted'}`}>
                <div className={`text-2xl font-bold ${summary.missing > 0 ? 'text-red-700 dark:text-red-400' : ''}`}>
                  {summary.missing}
                </div>
                <div className={`text-sm ${summary.missing > 0 ? 'text-red-600 dark:text-red-500' : 'text-muted-foreground'}`}>
                  {summary.missing > 0 ? '✗ NO existen en QBO' : 'Sin faltantes'}
                </div>
              </div>
            </div>
          )}

          {results.length > 0 && (
            <ScrollArea className="h-[400px] rounded-md border">
              <div className="p-4 space-y-2">
                {/* Mostrar primero las faltantes */}
                {results.filter(r => !r.exists_in_qbo).length > 0 && (
                  <>
                    <h4 className="font-semibold text-red-600 dark:text-red-400 mb-2">
                      <AlertTriangle className="h-4 w-4 inline mr-2" />
                      Facturas que NO existen en QuickBooks:
                    </h4>
                    {results.filter(r => !r.exists_in_qbo).map((result) => (
                      <div 
                        key={result.id}
                        className="p-3 rounded-lg border bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <XCircle className="h-4 w-4 text-red-600" />
                            <span className="font-mono text-sm">{result.doc_number}</span>
                            <Badge variant="destructive">Bill ID: {result.qbo_entity_id}</Badge>
                          </div>
                          <span className="font-semibold">{formatCurrency(result.total_amount, result.currency)}</span>
                        </div>
                        <div className="ml-6 text-sm text-muted-foreground mt-1">
                          {result.supplier_name} • {new Date(result.issue_date).toLocaleDateString('es-CR')}
                        </div>
                        {result.qbo_error && (
                          <div className="ml-6 text-xs text-red-600 mt-1">Error: {result.qbo_error}</div>
                        )}
                      </div>
                    ))}
                  </>
                )}

                {/* Luego las que sí existen */}
                {results.filter(r => r.exists_in_qbo).length > 0 && (
                  <>
                    <h4 className="font-semibold text-green-600 dark:text-green-400 mb-2 mt-4">
                      <CheckCircle className="h-4 w-4 inline mr-2" />
                      Facturas verificadas en QuickBooks ({results.filter(r => r.exists_in_qbo).length}):
                    </h4>
                    {results.filter(r => r.exists_in_qbo).slice(0, 20).map((result) => (
                      <div 
                        key={result.id}
                        className="p-2 rounded-lg border bg-green-50/50 dark:bg-green-900/10 border-green-200/50"
                      >
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="h-3 w-3 text-green-600" />
                            <span className="font-mono">{result.doc_number}</span>
                            <span className="text-muted-foreground">{result.supplier_name}</span>
                          </div>
                          <span>{formatCurrency(result.total_amount, result.currency)}</span>
                        </div>
                      </div>
                    ))}
                    {results.filter(r => r.exists_in_qbo).length > 20 && (
                      <div className="text-center text-sm text-muted-foreground py-2">
                        ... y {results.filter(r => r.exists_in_qbo).length - 20} más
                      </div>
                    )}
                  </>
                )}
              </div>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
