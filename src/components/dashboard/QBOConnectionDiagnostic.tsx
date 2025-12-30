import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Activity, CheckCircle, XCircle, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";

interface DiagnosticResult {
  step: string;
  status: 'success' | 'error' | 'warning' | 'pending';
  message: string;
  details?: any;
}

interface BillCheckResult {
  bill_id: string;
  exists: boolean;
  doc_number?: string;
  txn_date?: string;
  total_amount?: number;
  accounts?: Array<{
    account_id: string;
    account_name: string;
    amount: number;
  }>;
  error?: string;
}

export const QBOConnectionDiagnostic = () => {
  const { activeOrganization } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [diagnosticResults, setDiagnosticResults] = useState<DiagnosticResult[]>([]);
  const [billChecks, setBillChecks] = useState<BillCheckResult[]>([]);

  const addResult = (result: DiagnosticResult) => {
    setDiagnosticResults(prev => [...prev, result]);
  };

  const runDiagnostic = async () => {
    if (!activeOrganization) {
      toast.error("No hay organización activa");
      return;
    }

    setIsRunning(true);
    setDiagnosticResults([]);
    setBillChecks([]);
    
    try {
      // Step 1: Check organization settings
      addResult({
        step: "Configuración de Organización",
        status: 'pending',
        message: "Verificando configuración..."
      });

      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .select('id, name, quickbooks_connected, qbo_realm_id, settings')
        .eq('id', activeOrganization)
        .single();

      if (orgError || !org) {
        addResult({
          step: "Configuración de Organización",
          status: 'error',
          message: "No se pudo obtener la organización",
          details: orgError
        });
        return;
      }

      const settings = org.settings as any;
      addResult({
        step: "Configuración de Organización",
        status: 'success',
        message: `${org.name} - QuickBooks ${org.quickbooks_connected ? 'Conectado' : 'No conectado'}`,
        details: {
          realm_id: org.qbo_realm_id,
          tax_handling: settings?.tax_handling || 'standard',
          description: settings?.description
        }
      });

      // Step 2: Check integration credentials
      addResult({
        step: "Credenciales QuickBooks",
        status: 'pending',
        message: "Verificando token..."
      });

      const { data: integration, error: integrationError } = await supabase
        .from('integration_accounts')
        .select('id, is_active, account_name, credentials, updated_at')
        .eq('organization_id', activeOrganization)
        .eq('service_type', 'quickbooks')
        .maybeSingle();

      if (integrationError || !integration) {
        addResult({
          step: "Credenciales QuickBooks",
          status: 'error',
          message: "No hay integración de QuickBooks configurada",
          details: integrationError
        });
        return;
      }

      const credentials = integration.credentials as any;
      const expiresAt = new Date(credentials?.expires_at || 0);
      const isExpired = expiresAt < new Date();

      addResult({
        step: "Credenciales QuickBooks",
        status: isExpired ? 'error' : 'success',
        message: isExpired 
          ? `Token EXPIRADO (${expiresAt.toLocaleString()})` 
          : `Token válido hasta ${expiresAt.toLocaleString()}`,
        details: {
          realm_id: credentials?.realm_id,
          account_name: integration.account_name,
          is_active: integration.is_active,
          token_length: credentials?.access_token?.length || 0
        }
      });

      if (isExpired) {
        return;
      }

      // Step 3: Check system settings
      addResult({
        step: "System Settings",
        status: 'pending',
        message: "Verificando configuración..."
      });

      const { data: systemSettings } = await supabase
        .from('system_settings')
        .select('key, value')
        .eq('organization_id', activeOrganization);

      const settingsMap = (systemSettings || []).reduce((acc: any, s) => {
        acc[s.key] = s.value;
        return acc;
      }, {});

      addResult({
        step: "System Settings",
        status: 'success',
        message: `${(systemSettings || []).length} configuraciones encontradas`,
        details: {
          dry_run: settingsMap.dry_run,
          default_uses_tax: settingsMap.default_uses_tax,
          duplicate_window_days: settingsMap.duplicate_window_days,
          min_publish_date: settingsMap.min_publish_date
        }
      });

      // Step 4: Check recent published documents
      addResult({
        step: "Documentos Publicados",
        status: 'pending',
        message: "Verificando documentos..."
      });

      const { data: publishedDocs, error: docsError } = await supabase
        .from('processed_documents')
        .select('id, doc_number, supplier_name, qbo_entity_id, qbo_entity_type, issue_date, total_amount, default_account_ref')
        .eq('organization_id', activeOrganization)
        .eq('status', 'published')
        .not('qbo_entity_id', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(10);

      if (docsError) {
        addResult({
          step: "Documentos Publicados",
          status: 'error',
          message: "Error al obtener documentos",
          details: docsError
        });
      } else {
        addResult({
          step: "Documentos Publicados",
          status: 'success',
          message: `${publishedDocs?.length || 0} documentos recientes con QBO ID`,
          details: publishedDocs?.slice(0, 5).map(d => ({
            doc: d.doc_number,
            bill_id: d.qbo_entity_id,
            account: d.default_account_ref
          }))
        });

        // Step 5: Verify bills in QuickBooks
        if (publishedDocs && publishedDocs.length > 0) {
          addResult({
            step: "Verificación en QuickBooks",
            status: 'pending',
            message: "Verificando Bills en QuickBooks..."
          });

          const billIds = publishedDocs.slice(0, 5).map(d => d.qbo_entity_id).filter(Boolean);

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
              addResult({
                step: "Verificación en QuickBooks",
                status: 'error',
                message: "Error al verificar Bills",
                details: verifyError
              });
            } else {
              const results = verifyResult.results || [];
              const found = results.filter((r: BillCheckResult) => r.exists).length;
              const missing = results.filter((r: BillCheckResult) => !r.exists).length;

              setBillChecks(results);

              addResult({
                step: "Verificación en QuickBooks",
                status: missing > 0 ? 'warning' : 'success',
                message: `${found}/${billIds.length} Bills encontrados en QuickBooks${missing > 0 ? ` (${missing} faltantes)` : ''}`,
                details: {
                  realm_id: verifyResult.realm_id,
                  found,
                  missing
                }
              });
            }
          } catch (err: any) {
            addResult({
              step: "Verificación en QuickBooks",
              status: 'error',
              message: `Error: ${err.message}`,
              details: err
            });
          }
        }
      }

      toast.success("Diagnóstico completado");

    } catch (error: any) {
      console.error("Diagnostic error:", error);
      toast.error(`Error: ${error.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const getStatusIcon = (status: DiagnosticResult['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'error':
        return <XCircle className="h-5 w-5 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'pending':
        return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Activity className="h-4 w-4 mr-2" />
          Diagnóstico QBO
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Diagnóstico de Conexión QuickBooks</DialogTitle>
          <DialogDescription>
            Verifica la conexión y si los Bills realmente existen en QuickBooks
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Button 
            onClick={runDiagnostic} 
            disabled={isRunning}
            className="w-full"
          >
            {isRunning ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Ejecutando diagnóstico...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Ejecutar Diagnóstico Completo
              </>
            )}
          </Button>

          {diagnosticResults.length > 0 && (
            <ScrollArea className="h-[400px] rounded-md border p-4">
              <div className="space-y-4">
                {diagnosticResults.map((result, index) => (
                  <div key={index} className="space-y-2">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(result.status)}
                      <span className="font-medium">{result.step}</span>
                      <Badge variant={
                        result.status === 'success' ? 'default' :
                        result.status === 'error' ? 'destructive' :
                        result.status === 'warning' ? 'secondary' : 'outline'
                      }>
                        {result.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground ml-7">{result.message}</p>
                    {result.details && (
                      <pre className="text-xs bg-muted p-2 rounded ml-7 overflow-x-auto">
                        {JSON.stringify(result.details, null, 2)}
                      </pre>
                    )}
                    {index < diagnosticResults.length - 1 && <Separator />}
                  </div>
                ))}

                {billChecks.length > 0 && (
                  <>
                    <Separator className="my-4" />
                    <h4 className="font-semibold">Detalle de Bills Verificados:</h4>
                    <div className="space-y-3 mt-2">
                      {billChecks.map((bill, index) => (
                        <div 
                          key={index}
                          className={`p-3 rounded-lg border ${
                            bill.exists 
                              ? 'bg-green-50 dark:bg-green-900/20 border-green-200' 
                              : 'bg-red-50 dark:bg-red-900/20 border-red-200'
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            {bill.exists ? (
                              <CheckCircle className="h-4 w-4 text-green-600" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-600" />
                            )}
                            <span className="font-mono text-sm">Bill ID: {bill.bill_id}</span>
                          </div>
                          
                          {bill.exists && (
                            <div className="grid grid-cols-2 gap-1 text-xs ml-6">
                              <span>Doc: {bill.doc_number}</span>
                              <span>Fecha: {bill.txn_date}</span>
                              <span>Total: ₡{bill.total_amount?.toLocaleString()}</span>
                              <span className="col-span-2">
                                Cuenta: {bill.accounts?.[0]?.account_name} (ID: {bill.accounts?.[0]?.account_id})
                              </span>
                            </div>
                          )}
                          
                          {!bill.exists && bill.error && (
                            <p className="text-xs text-red-600 ml-6">{bill.error}</p>
                          )}
                        </div>
                      ))}
                    </div>
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
