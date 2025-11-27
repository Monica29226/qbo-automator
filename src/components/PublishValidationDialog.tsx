import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, CheckCircle2, XCircle, Clock } from "lucide-react";

interface ValidationResult {
  isValid: boolean;
  warnings: string[];
  errors: string[];
  stats: {
    pendingCount: number;
    qboConnected: boolean;
    tokenExpired: boolean;
    tokenExpiresAt?: string;
    invalidAccounts?: Array<{
      vendor: string;
      account: string;
      docCount: number;
    }>;
  };
}

interface PublishValidationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  documentIds?: string[];
}

export const PublishValidationDialog = ({
  open,
  onOpenChange,
  onConfirm,
  documentIds,
}: PublishValidationDialogProps) => {
  const { activeOrganization } = useAuth();
  const [isValidating, setIsValidating] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);

  useEffect(() => {
    if (open && activeOrganization) {
      validatePublishConditions();
    }
  }, [open, activeOrganization]);

  const validatePublishConditions = async () => {
    if (!activeOrganization) return;

    setIsValidating(true);
    const warnings: string[] = [];
    const errors: string[] = [];
    let isValid = true;

    try {
      console.log("⚡ Starting PARALLEL validation...");
      
      // OPTIMIZACIÓN: Ejecutar TODAS las consultas en PARALELO
      const [
        qboAccountResult,
        pendingCountResult,
        docsWithoutVendorResult
      ] = await Promise.all([
        // 1. Verificar conexión a QuickBooks
        supabase
          .from("integration_accounts")
          .select("credentials, is_active")
          .eq("organization_id", activeOrganization)
          .eq("service_type", "quickbooks")
          .eq("is_active", true)
          .maybeSingle(),
        
        // 2. Contar documentos pendientes
        (async () => {
          let query = supabase
            .from("processed_documents")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", activeOrganization)
            .is("qbo_entity_id", null)
            .in("status", ["pending", "processed"]);

          if (documentIds && documentIds.length > 0) {
            query = query.in("id", documentIds);
          }

          return query;
        })(),
        
        // 3. Contar vendors sin asignar
        supabase
          .from("processed_documents")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", activeOrganization)
          .is("vendor_id", null)
          .in("status", ["pending", "processed"])
      ]);

      const qboAccount = qboAccountResult.data;
      const pendingCount = pendingCountResult.count;
      const docsWithoutVendor = docsWithoutVendorResult.count;

      console.log("✓ Parallel queries completed:", {
        qboConnected: !!qboAccount?.is_active,
        pendingCount,
        docsWithoutVendor
      });

      const qboConnected = !!qboAccount?.is_active;
      
      if (!qboConnected) {
        errors.push("QuickBooks no está conectado");
        isValid = false;
      }

      // Verificar expiración del token
      let tokenExpired = false;
      let tokenExpiresAt: string | undefined;
      
      if (qboAccount?.credentials) {
        const credentials = qboAccount.credentials as any;
        tokenExpiresAt = credentials.expires_at;
        
        if (tokenExpiresAt) {
          const expiresDate = new Date(tokenExpiresAt);
          const now = new Date();
          tokenExpired = expiresDate < now;
          
          if (tokenExpired) {
            warnings.push("El token de QuickBooks está expirado. Se intentará renovar automáticamente.");
          } else {
            const hoursUntilExpiry = (expiresDate.getTime() - now.getTime()) / (1000 * 60 * 60);
            if (hoursUntilExpiry < 24) {
              warnings.push(`El token de QuickBooks expirará en ${Math.round(hoursUntilExpiry)} horas.`);
            }
          }
        }
      }

      if (!pendingCount || pendingCount === 0) {
        warnings.push("No hay documentos para publicar");
      }

      if (docsWithoutVendor && docsWithoutVendor > 0) {
        warnings.push(`${docsWithoutVendor} documento${docsWithoutVendor !== 1 ? 's' : ''} sin vendor asignado. Se crearán automáticamente en QuickBooks.`);
      }

      // OPTIMIZACIÓN: Saltar validación de cuentas si hay MUCHOS documentos (> 20)
      // Esto evita consultas pesadas cuando hay lotes grandes
      const skipAccountValidation = (pendingCount || 0) > 20;
      
      let invalidAccounts: Array<{ vendor: string; account: string; docCount: number }> = [];
      
      if (skipAccountValidation) {
        console.log("⚡ Skipping account validation for large batch (>20 docs)");
        warnings.push("Validación de cuentas omitida por lote grande. Las cuentas se validarán durante la publicación.");
      } else if (qboConnected && !tokenExpired) {
        console.log("🔍 Validating account codes...");
        try {
          // Obtener cuentas válidas de QuickBooks
          const { data: qboData, error: qboError } = await supabase.functions.invoke(
            "list-quickbooks-accounts",
            {
              body: { organization_id: activeOrganization },
            }
          );

          if (qboError) throw qboError;

          if (qboData?.success) {
            const validAccountCodes = new Set(
              qboData.accounts
                .filter((acc: any) => acc.active && acc.accountNumber)
                .map((acc: any) => acc.accountNumber)
            );

            console.log(`✓ Found ${validAccountCodes.size} valid QuickBooks accounts`);

            // Obtener vendors y sus cuentas de los documentos pendientes
            let docsQuery = supabase
              .from("processed_documents")
              .select(`
                id,
                supplier_name,
                vendor_id,
                vendors!inner(vendor_name, default_account_ref)
              `)
              .eq("organization_id", activeOrganization)
              .is("qbo_entity_id", null)
              .in("status", ["pending", "processed"]);

            if (documentIds && documentIds.length > 0) {
              docsQuery = docsQuery.in("id", documentIds);
            }

            const { data: docsWithVendors } = await docsQuery;

            if (docsWithVendors && docsWithVendors.length > 0) {
              // Agrupar por cuenta contable y contar documentos
              const accountUsage = new Map<string, { vendor: string; count: number }>();
              
              docsWithVendors.forEach((doc: any) => {
                const account = doc.vendors?.default_account_ref;
                const vendor = doc.vendors?.vendor_name || doc.supplier_name;
                
                if (account) {
                  const key = `${vendor}|${account}`;
                  const existing = accountUsage.get(key);
                  if (existing) {
                    existing.count++;
                  } else {
                    accountUsage.set(key, { vendor, count: 1 });
                  }
                }
              });

              // Verificar cuáles cuentas son inválidas
              accountUsage.forEach((data, key) => {
                const account = key.split('|')[1];
                if (!validAccountCodes.has(account)) {
                  invalidAccounts.push({
                    vendor: data.vendor,
                    account: account,
                    docCount: data.count,
                  });
                }
              });

              if (invalidAccounts.length > 0) {
                const totalInvalidDocs = invalidAccounts.reduce((sum, item) => sum + item.docCount, 0);
                errors.push(
                  `${totalInvalidDocs} documento(s) con cuentas contables inválidas no se podrán publicar`
                );
                isValid = false;
                console.log("❌ Invalid accounts found:", invalidAccounts);
              } else {
                console.log("✓ All accounts are valid");
              }
            }
          }
        } catch (error) {
          console.error("Error validating accounts:", error);
          warnings.push("No se pudo validar las cuentas contables. Continúe con precaución.");
        }
      }


      setValidation({
        isValid,
        warnings,
        errors,
        stats: {
          pendingCount: pendingCount || 0,
          qboConnected,
          tokenExpired,
          tokenExpiresAt,
          invalidAccounts: invalidAccounts.length > 0 ? invalidAccounts : undefined,
        },
      });
      
      console.log("✅ Validation completed:", { isValid, pendingCount, warnings: warnings.length, errors: errors.length });
    } catch (error) {
      console.error("Error validating publish conditions:", error);
      setValidation({
        isValid: false,
        warnings: [],
        errors: ["Error al validar las condiciones de publicación"],
        stats: {
          pendingCount: 0,
          qboConnected: false,
          tokenExpired: false,
        },
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Validación de Publicación</AlertDialogTitle>
          <AlertDialogDescription>
            Verificando las condiciones antes de publicar en QuickBooks...
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-4">
          {isValidating ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : validation ? (
            <>
              {/* Estado de conexión */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Estado de Integración</h4>
                <div className="flex items-center gap-2">
                  {validation.stats.qboConnected ? (
                    <>
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                      <span className="text-sm">QuickBooks conectado</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-5 w-5 text-destructive" />
                      <span className="text-sm">QuickBooks no conectado</span>
                    </>
                  )}
                </div>

                {validation.stats.tokenExpiresAt && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>
                      Token expira:{" "}
                      {new Date(validation.stats.tokenExpiresAt).toLocaleString("es-CR")}
                    </span>
                  </div>
                )}
              </div>

              {/* Estadísticas */}
              <div className="rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Documentos a publicar:</span>
                  <Badge variant={validation.stats.pendingCount > 0 ? "default" : "secondary"}>
                    {validation.stats.pendingCount}
                  </Badge>
                </div>
              </div>

              {/* Errores */}
              {validation.errors.length > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <ul className="list-disc list-inside space-y-1">
                      {validation.errors.map((error, idx) => (
                        <li key={idx}>{error}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {/* Detalles de cuentas inválidas */}
              {validation.stats.invalidAccounts && validation.stats.invalidAccounts.length > 0 && (
                <div className="mt-4 p-4 bg-destructive/10 rounded-lg border border-destructive/20">
                  <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-destructive" />
                    Cuentas Contables Inválidas
                  </h4>
                  <div className="space-y-2 text-sm">
                    {validation.stats.invalidAccounts.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-background/50 p-2 rounded">
                        <div className="flex-1">
                          <div className="font-medium">{item.vendor}</div>
                          <div className="text-xs text-muted-foreground">
                            Cuenta: <code className="bg-destructive/20 px-1 rounded">{item.account}</code>
                          </div>
                        </div>
                        <Badge variant="destructive">{item.docCount} doc(s)</Badge>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground">
                    💡 Solución: Ve a <strong>Configurar Vendors</strong> y actualiza las cuentas contables 
                    de estos proveedores con códigos válidos de QuickBooks.
                  </div>
                </div>
              )}

              {/* Advertencias */}
              {validation.warnings.length > 0 && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <ul className="list-disc list-inside space-y-1">
                      {validation.warnings.map((warning, idx) => (
                        <li key={idx} className="text-sm">{warning}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {/* Mensaje de éxito si todo está bien */}
              {validation.isValid && validation.warnings.length === 0 && (
                <Alert className="border-green-200 bg-green-50">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-800">
                    Todo listo para publicar en QuickBooks
                  </AlertDescription>
                </Alert>
              )}
            </>
          ) : null}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={!validation || !validation.isValid || validation.stats.pendingCount === 0}
          >
            Continuar Publicación
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
