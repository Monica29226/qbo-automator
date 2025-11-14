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
      // 1. Verificar conexión a QuickBooks
      const { data: qboAccount } = await supabase
        .from("integration_accounts")
        .select("credentials, is_active")
        .eq("organization_id", activeOrganization)
        .eq("service_type", "quickbooks")
        .maybeSingle();

      const qboConnected = !!qboAccount?.is_active;
      
      if (!qboConnected) {
        errors.push("QuickBooks no está conectado");
        isValid = false;
      }

      // 2. Verificar expiración del token
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

      // 3. Contar documentos pendientes
      let query = supabase
        .from("processed_documents")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", activeOrganization)
        .is("qbo_entity_id", null)
        .in("status", ["pending", "processed"]);

      if (documentIds && documentIds.length > 0) {
        query = query.in("id", documentIds);
      }

      const { count: pendingCount } = await query;

      if (!pendingCount || pendingCount === 0) {
        warnings.push("No hay documentos para publicar");
      }

      // 4. Verificar vendors sin asignar
      const { count: docsWithoutVendor } = await supabase
        .from("processed_documents")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", activeOrganization)
        .is("vendor_id", null)
        .in("status", ["pending", "processed"]);

      if (docsWithoutVendor && docsWithoutVendor > 0) {
        warnings.push(`${docsWithoutVendor} documento${docsWithoutVendor !== 1 ? 's' : ''} sin vendor asignado. Se crearán automáticamente en QuickBooks.`);
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
        },
      });
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
