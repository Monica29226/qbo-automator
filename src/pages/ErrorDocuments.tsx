import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft, RefreshCw, FileText, Database, Wrench, Settings2, Filter, Ban, CheckCircle, Trash2, Eye } from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ErrorDiagnostic } from "@/components/dashboard/ErrorDiagnostic";
import { useQBOAccounts } from "@/hooks/useQBOAccounts";
import { Label } from "@/components/ui/label";
import { AccountCombobox } from "@/components/AccountCombobox";
import { PdfViewer } from "@/components/PdfViewer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ErrorDocument {
  id: string;
  doc_number: string;
  doc_type: string;
  supplier_name: string;
  issue_date: string;
  total_amount: number;
  currency: string;
  error_message: string;
  created_at: string;
  default_account_ref?: string | null;
  pdf_attachment_url?: string | null;
  organization_id?: string | null;
}

type ErrorCategory = "all" | "fixable" | "not_publishable" | "account_error" | "permanent" | "totals_error";

const ErrorDocuments = () => {
  const { activeOrganization } = useAuth();
  const { accounts, isLoading: isLoadingAccounts } = useQBOAccounts();
  const [documents, setDocuments] = useState<ErrorDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [changeAccountDoc, setChangeAccountDoc] = useState<ErrorDocument | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [isUpdatingAccount, setIsUpdatingAccount] = useState(false);
  const [activeTab, setActiveTab] = useState<ErrorCategory>("all");
  const [selectedPdfDoc, setSelectedPdfDoc] = useState<ErrorDocument | null>(null);
  useEffect(() => {
    if (activeOrganization) {
      fetchErrorDocuments();
    } else {
      setIsLoading(false);
    }
  }, [activeOrganization]);

  const fetchErrorDocuments = async () => {
    if (!activeOrganization) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("processed_documents")
        .select("id, doc_number, doc_type, supplier_name, issue_date, total_amount, currency, error_message, created_at, default_account_ref, pdf_attachment_url, organization_id")
        .eq("organization_id", activeOrganization)
        .eq("status", "error")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching error documents:", error);
        toast.error("Error al cargar documentos: " + error.message);
      } else if (data) {
        setDocuments(data);
      }
    } catch (err: any) {
      console.error("Exception fetching error documents:", err);
      toast.error("Error inesperado al cargar documentos");
    } finally {
      setIsLoading(false);
    }
  };

  // Categorize error for filtering
  const categorizeError = (doc: ErrorDocument): ErrorCategory => {
    const msg = doc.error_message || "";
    const docType = doc.doc_type?.toLowerCase() || "";
    
    // Not publishable - TiqueteElectronico
    if (docType.includes("tiquete") || docType === "tiqueteelectronico") {
      return "not_publishable";
    }
    
    // Permanent errors
    if (msg.includes("[PERMANENTE]")) {
      return "permanent";
    }
    
    // Totals errors - can be force published
    if (msg.includes("TOTALES NO COINCIDEN") || 
        msg.includes("MONTO INCORRECTO") ||
        msg.includes("error_totals")) {
      return "totals_error";
    }
    
    // Account errors - fixable
    if (msg.includes("no existe en QuickBooks") || 
        msg.includes("Account not found") ||
        msg.includes("Cuenta") ||
        msg.includes("No account configured") ||
        msg.includes("No se pudo determinar cuenta")) {
      return "account_error";
    }
    
    // Potentially fixable
    return "fixable";
  };

  const getErrorSummary = (doc: ErrorDocument) => {
    const errorMessage = doc.error_message || "";
    const docType = doc.doc_type?.toLowerCase() || "";
    
    // TiqueteElectronico - No se puede publicar
    if (docType.includes("tiquete") || docType === "tiqueteelectronico") {
      return {
        type: "No Publicable",
        description: "Los Tiquetes Electrónicos no se publican en QuickBooks (solo facturas)",
        solution: "Descartar este documento o eliminarlo de la lista de errores",
        canRetry: false,
        canChangeAccount: false,
        canForcePublish: false
      };
    }
    
    if (errorMessage.includes("[PERMANENTE]")) {
      return {
        type: "Error Permanente",
        description: errorMessage.replace("[PERMANENTE] Max retries reached (3 attempts) - Original: ", ""),
        solution: "Usar botón 'Forzar Reintento' para resetear contador",
        canRetry: true,
        canChangeAccount: false,
        canForcePublish: true
      };
    }
    if (errorMessage.includes("Falta el parámetro Line requerido")) {
      return {
        type: "Sin líneas de detalle",
        description: "El XML no contiene líneas de detalle válidas",
        solution: "Revisar el XML original - puede estar incompleto",
        canRetry: true,
        canChangeAccount: false,
        canForcePublish: true
      };
    }
    if (errorMessage.includes("Número no válido") && errorMessage.includes("Gastos por clasificar")) {
      return {
        type: "Cuenta contable inválida",
        description: 'La cuenta "Gastos por clasificar" no existe en QuickBooks',
        solution: "Configurar regla de vendor con cuenta válida",
        canRetry: false,
        canChangeAccount: true,
        canForcePublish: false
      };
    }
    if (errorMessage.includes("La longitud de la cadena") && errorMessage.includes("DocNumber")) {
      return {
        type: "Número de factura muy largo",
        description: "QuickBooks acepta máximo 21 caracteres",
        solution: "El número debe acortarse manualmente",
        canRetry: false,
        canChangeAccount: false,
        canForcePublish: true
      };
    }
    if (errorMessage.includes("Failed to create vendor")) {
      return {
        type: "Error al crear proveedor",
        description: "No se pudo crear el vendor en QuickBooks",
        solution: "Verificar permisos y conectividad con QuickBooks",
        canRetry: true,
        canChangeAccount: false,
        canForcePublish: false
      };
    }
    if (errorMessage.includes("No se pudo determinar cuenta contable")) {
      return {
        type: "Sin regla de clasificación",
        description: "El proveedor no tiene configurada una cuenta contable",
        solution: "Ir a Configuración → Reglas de Vendors y agregar regla",
        canRetry: false,
        canChangeAccount: true,
        canForcePublish: false
      };
    }
    if (errorMessage.includes("no existe en QuickBooks") && errorMessage.includes("Cuenta")) {
      const match = errorMessage.match(/Cuenta\s+(\d+)/i);
      return {
        type: "Código de cuenta incorrecto",
        description: `El código "${match?.[1] || '?'}" no corresponde a una cuenta válida en QuickBooks`,
        solution: "Cambiar la cuenta usando el botón 'Cambiar Cuenta'",
        canRetry: false,
        canChangeAccount: true,
        canForcePublish: false
      };
    }
    if (errorMessage.includes("No account configured")) {
      return {
        type: "Sin cuenta configurada",
        description: "La factura no tiene una cuenta contable asignada",
        solution: "Asignar cuenta usando el botón 'Cambiar Cuenta'",
        canRetry: false,
        canChangeAccount: true,
        canForcePublish: false
      };
    }
    if (errorMessage.includes("TOTALES NO COINCIDEN") || errorMessage.includes("MONTO INCORRECTO")) {
      return {
        type: "Error de totales",
        description: "El cálculo de líneas no coincide con el total del documento",
        solution: "Usar 'Forzar Publicación' para subir con el monto total del documento",
        canRetry: true,
        canChangeAccount: false,
        canForcePublish: true
      };
    }
    // Vendor/Customer name conflict
    if (errorMessage.includes("tipo de nombre asignado") || 
        errorMessage.includes("Name Already Used") ||
        errorMessage.includes("Vendor/Customer conflict")) {
      return {
        type: "Conflicto de nombre Vendor/Cliente",
        description: "El nombre del proveedor ya existe como Cliente en QuickBooks. QBO no permite el mismo nombre para ambos.",
        solution: "Usar 'Reintentar' (agrega sufijo automáticamente) o 'Forzar Publicación'",
        canRetry: true,
        canChangeAccount: false,
        canForcePublish: true
      };
    }

    // Body already consumed - transient error
    if (errorMessage.includes("Body already consumed") || errorMessage.includes("body already consumed")) {
      return {
        type: "Error transitorio",
        description: "Error técnico al leer la respuesta de QuickBooks (body already consumed)",
        solution: "Reintentar - este error suele resolverse automáticamente",
        canRetry: true,
        canChangeAccount: false,
        canForcePublish: true
      };
    }

    return {
      type: "Error desconocido",
      description: errorMessage.substring(0, 100) + "...",
      solution: "Revisar logs completos",
      canRetry: true,
      canChangeAccount: false,
      canForcePublish: true
    };
  };

  // Filter documents by category
  const filteredDocuments = useMemo(() => {
    if (activeTab === "all") return documents;
    return documents.filter(doc => categorizeError(doc) === activeTab);
  }, [documents, activeTab]);

  // Count by category
  const errorCounts = useMemo(() => {
    const counts: Record<ErrorCategory, number> = {
      all: documents.length,
      fixable: 0,
      not_publishable: 0,
      account_error: 0,
      permanent: 0,
      totals_error: 0
    };
    
    documents.forEach(doc => {
      const cat = categorizeError(doc);
      counts[cat]++;
    });
    
    return counts;
  }, [documents]);

  const formatCurrency = (amount: number, currency: string = "CRC") => {
    return new Intl.NumberFormat('es-CR', {
      style: 'currency',
      currency: currency === "USD" ? "USD" : "CRC",
      minimumFractionDigits: 2
    }).format(amount);
  };

  const handleDismissError = async (docId: string, docNumber: string) => {
    if (!activeOrganization) return;

    const toastId = toast.loading(`Descartando ${docNumber}...`);
    
    try {
      const { error } = await supabase
        .from("processed_documents")
        .update({ 
          status: "dismissed",
          error_message: `[DESCARTADO] ${documents.find(d => d.id === docId)?.error_message || "No publicable"}`
        })
        .eq("id", docId);

      if (error) throw error;

      toast.success(`✓ ${docNumber} descartado`, { id: toastId });
      fetchErrorDocuments();
    } catch (error: any) {
      console.error("Error dismissing document:", error);
      toast.error(`Error: ${error.message}`, { id: toastId });
    }
  };

  const handleDismissAllNotPublishable = async () => {
    if (!activeOrganization) return;

    const notPublishable = documents.filter(doc => categorizeError(doc) === "not_publishable");
    if (notPublishable.length === 0) {
      toast.info("No hay documentos para descartar");
      return;
    }

    const toastId = toast.loading(`Descartando ${notPublishable.length} documentos no publicables...`);
    
    try {
      const { error } = await supabase
        .from("processed_documents")
        .update({ 
          status: "dismissed",
          error_message: "[DESCARTADO] TiqueteElectronico - No publicable en QuickBooks"
        })
        .in("id", notPublishable.map(d => d.id));

      if (error) throw error;

      toast.success(`✓ ${notPublishable.length} documentos descartados`, { id: toastId });
      fetchErrorDocuments();
    } catch (error: any) {
      console.error("Error dismissing documents:", error);
      toast.error(`Error: ${error.message}`, { id: toastId });
    }
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

  const handleSyncErrorAccounts = async (dryRun = true) => {
    if (!activeOrganization) return;

    const toastId = toast.loading(dryRun 
      ? "Analizando errores y buscando cuentas corregidas..." 
      : "Sincronizando cuentas corregidas y republicando...");

    try {
      const { data, error } = await supabase.functions.invoke("sync-error-accounts", {
        body: { 
          organization_id: activeOrganization,
          dry_run: dryRun
        },
      });

      if (error) throw error;

      const { updated, not_found, already_correct, total_errors } = data;

      if (dryRun) {
        // Solo análisis
        if (updated > 0) {
          toast.success(
            `📊 Análisis: ${updated} factura${updated !== 1 ? 's' : ''} pueden ser corregida${updated !== 1 ? 's' : ''} con vendors configurados. Usa "Sincronizar Cuentas" para aplicar.`,
            { id: toastId, duration: 8000 }
          );
        } else if (not_found > 0) {
          toast.warning(
            `${not_found} proveedor${not_found !== 1 ? 'es' : ''} sin configuración de vendor. Configura en Proveedores → Reglas.`,
            { id: toastId, duration: 6000 }
          );
        } else {
          toast.info("No se encontraron errores que puedan corregirse automáticamente", { id: toastId });
        }
      } else {
        // Actualización real
        if (updated > 0) {
          toast.success(
            `✅ ${updated} factura${updated !== 1 ? 's' : ''} actualizada${updated !== 1 ? 's' : ''} y en proceso de publicación`,
            { id: toastId, duration: 6000 }
          );
          setTimeout(() => fetchErrorDocuments(), 2000);
        } else if (not_found > 0) {
          toast.warning(
            `No se pudieron corregir. ${not_found} proveedor${not_found !== 1 ? 'es' : ''} sin configurar.`,
            { id: toastId, duration: 5000 }
          );
        } else {
          toast.info("No hay facturas que corregir", { id: toastId });
        }
      }

    } catch (error: any) {
      console.error("Error syncing accounts:", error);
      toast.error(`Error: ${error.message}`, { id: toastId });
    }
  };

  const handleFixAccountCodes = async () => {
    if (!activeOrganization) return;

    const toastId = toast.loading("Corrigiendo códigos de cuenta automáticamente...");

    try {
      const { data, error } = await supabase.functions.invoke("fix-account-codes", {
        body: { organization_id: activeOrganization },
      });

      if (error) throw error;

      const { fixed, noAccountConfigured, notFixable } = data;

      if (fixed > 0) {
        toast.success(
          `✅ ${fixed} factura${fixed !== 1 ? 's' : ''} corregida${fixed !== 1 ? 's' : ''} y republicada${fixed !== 1 ? 's' : ''}` +
          (noAccountConfigured > 0 ? ` (${noAccountConfigured} sin cuenta configurada)` : ''),
          { id: toastId, duration: 6000 }
        );
      } else if (noAccountConfigured > 0) {
        toast.warning(
          `${noAccountConfigured} factura${noAccountConfigured !== 1 ? 's' : ''} requieren configuración manual de cuenta`,
          { id: toastId, duration: 5000 }
        );
      } else {
        toast.info("No se encontraron errores de código de cuenta para corregir", { id: toastId });
      }

      setTimeout(() => fetchErrorDocuments(), 1500);
    } catch (error: any) {
      console.error("Error fixing account codes:", error);
      toast.error(`Error al corregir: ${error.message}`, { id: toastId });
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

  const handleChangeAccount = async () => {
    if (!activeOrganization || !changeAccountDoc || !selectedAccount) return;

    setIsUpdatingAccount(true);
    const toastId = toast.loading("Actualizando cuenta y republicando...");

    try {
      // Actualizar la cuenta en el documento
      const { error: updateError } = await supabase
        .from("processed_documents")
        .update({ 
          default_account_ref: selectedAccount,
          error_message: null,
          status: "pending"
        })
        .eq("id", changeAccountDoc.id);

      if (updateError) throw updateError;

      // También actualizar vendor_defaults para que futuras facturas usen esta cuenta
      const { error: vendorError } = await supabase
        .from("vendor_defaults")
        .upsert({
          organization_id: activeOrganization,
          vendor_name: changeAccountDoc.supplier_name,
          default_account_ref: selectedAccount,
        }, {
          onConflict: "organization_id,vendor_name"
        });

      if (vendorError) {
        console.warn("Could not update vendor defaults:", vendorError);
      }

      // Intentar republicar inmediatamente
      const { data, error } = await supabase.functions.invoke("retry-failed-bills", {
        body: { 
          documentId: changeAccountDoc.id,
          organizationId: activeOrganization
        },
      });

      if (error) throw error;

      if (data.success) {
        toast.success(`✓ Cuenta actualizada y factura publicada`, { id: toastId });
      } else {
        toast.warning(`Cuenta actualizada. Error al publicar: ${data.message || data.error}`, { id: toastId });
      }

      setChangeAccountDoc(null);
      setSelectedAccount("");
      setTimeout(() => fetchErrorDocuments(), 1000);

    } catch (error: any) {
      console.error("Error changing account:", error);
      toast.error(`Error: ${error.message}`, { id: toastId });
    } finally {
      setIsUpdatingAccount(false);
    }
  };

  const handleForcePublish = async (docId: string, docNumber: string) => {
    if (!activeOrganization) return;

    const toastId = toast.loading(`Forzando publicación de ${docNumber}...`);
    
    try {
      const { data, error } = await supabase.functions.invoke("force-publish-document", {
        body: { 
          document_id: docId,
          organization_id: activeOrganization
        },
      });

      if (error) throw error;

      if (data.success) {
        toast.success(`✓ ${docNumber} publicado exitosamente (${data.qbo_entity_type} ID: ${data.qbo_entity_id})`, { id: toastId });
        setTimeout(() => fetchErrorDocuments(), 1000);
      } else {
        toast.error(data.error || "Error al forzar publicación", { id: toastId });
      }

    } catch (error: any) {
      console.error("Error forcing publish:", error);
      toast.error(`Error: ${error.message}`, { id: toastId });
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
              <div className="flex flex-wrap gap-2">
                <Button 
                  onClick={() => handleSyncErrorAccounts(false)}
                  variant="default"
                  className="gap-2"
                >
                  <Wrench className="h-4 w-4" />
                  Sincronizar Cuentas
                </Button>
                <Button 
                  onClick={() => handleSyncErrorAccounts(true)}
                  variant="outline"
                  className="gap-2"
                >
                  <Filter className="h-4 w-4" />
                  Analizar
                </Button>
                <Button 
                  onClick={handleRepublishFromData}
                  variant="outline"
                  className="gap-2"
                >
                  <Database className="h-4 w-4" />
                  Republicar
                </Button>
                <Button 
                  onClick={() => handleRetryAll(false)}
                  variant="outline"
                  className="gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Reintentar
                </Button>
                <Button 
                  onClick={() => handleRetryAll(true)}
                  variant="destructive"
                  className="gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Forzar
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {/* Tabs de filtrado */}
        {documents.length > 0 && (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ErrorCategory)} className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <TabsList>
                <TabsTrigger value="all" className="gap-2">
                  Todos
                  <Badge variant="secondary" className="ml-1">{errorCounts.all}</Badge>
                </TabsTrigger>
                <TabsTrigger value="account_error" className="gap-2">
                  <Settings2 className="h-3 w-3" />
                  Cuenta
                  <Badge variant="secondary" className="ml-1">{errorCounts.account_error}</Badge>
                </TabsTrigger>
                <TabsTrigger value="not_publishable" className="gap-2">
                  <Ban className="h-3 w-3" />
                  No Publicables
                  <Badge variant="secondary" className="ml-1">{errorCounts.not_publishable}</Badge>
                </TabsTrigger>
                <TabsTrigger value="permanent" className="gap-2">
                  <AlertCircle className="h-3 w-3" />
                  Permanentes
                  <Badge variant="secondary" className="ml-1">{errorCounts.permanent}</Badge>
                </TabsTrigger>
                <TabsTrigger value="totals_error" className="gap-2">
                  <FileText className="h-3 w-3" />
                  Totales
                  <Badge variant="secondary" className="ml-1">{errorCounts.totals_error}</Badge>
                </TabsTrigger>
                <TabsTrigger value="fixable" className="gap-2">
                  <Wrench className="h-3 w-3" />
                  Otros
                  <Badge variant="secondary" className="ml-1">{errorCounts.fixable}</Badge>
                </TabsTrigger>
              </TabsList>
              
              {activeTab === "not_publishable" && errorCounts.not_publishable > 0 && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleDismissAllNotPublishable}
                  className="gap-2"
                >
                  <Trash2 className="h-4 w-4" />
                  Descartar Todos ({errorCounts.not_publishable})
                </Button>
              )}
            </div>
          </Tabs>
        )}

        {/* Diagnostic Section */}
        {documents.length > 0 && activeTab !== "not_publishable" && (
          <div className="mb-8">
            <ErrorDiagnostic />
          </div>
        )}

        {documents.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="text-muted-foreground space-y-4">
              <CheckCircle className="h-12 w-12 mx-auto text-green-500" />
              <p className="text-lg mb-2">¡No hay facturas con error! 🎉</p>
              <p className="text-sm">Todas las facturas se han procesado correctamente.</p>
            </div>
          </Card>
        ) : filteredDocuments.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="text-muted-foreground space-y-4">
              <Filter className="h-12 w-12 mx-auto text-muted-foreground" />
              <p className="text-lg mb-2">No hay errores en esta categoría</p>
              <p className="text-sm">Selecciona otra pestaña para ver más errores.</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredDocuments.map((doc) => {
              const errorInfo = getErrorSummary(doc);
              const category = categorizeError(doc);
              const isNotPublishable = category === "not_publishable";
              
              return (
                <Card 
                  key={doc.id} 
                  className={`p-6 hover:shadow-lg transition-shadow ${isNotPublishable ? 'border-orange-300 bg-orange-50/50 dark:border-orange-800 dark:bg-orange-950/20' : ''}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-start gap-3 mb-3">
                        {isNotPublishable ? (
                          <Ban className="h-5 w-5 text-orange-500 mt-1 flex-shrink-0" />
                        ) : (
                          <AlertCircle className="h-5 w-5 text-destructive mt-1 flex-shrink-0" />
                        )}
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2 flex-wrap">
                            <h3 className="font-semibold text-lg">
                              {doc.doc_type?.toLowerCase().includes("tiquete") ? "Tiquete" : "Factura"} #{doc.doc_number}
                            </h3>
                            <Badge 
                              variant={isNotPublishable ? "outline" : "destructive"} 
                              className={`text-xs ${isNotPublishable ? 'border-orange-400 text-orange-700 dark:text-orange-300' : ''}`}
                            >
                              {doc.doc_type || "FacturaElectronica"}
                            </Badge>
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
                            <span className="font-medium">Monto:</span> {formatCurrency(doc.total_amount, doc.currency)}
                          </p>
                        </div>
                      </div>

                      <div className={`border rounded-lg p-4 space-y-2 ${isNotPublishable ? 'bg-orange-100/50 border-orange-200 dark:bg-orange-900/20 dark:border-orange-800' : 'bg-muted/30 border-muted'}`}>
                        <div>
                          <p className="text-sm font-medium text-foreground mb-1">
                            📋 Descripción:
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {errorInfo.description}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground mb-1">
                            💡 Acción sugerida:
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
                        
                        {!isNotPublishable && (
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
                        )}
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
                      {/* Botón Ver PDF - para todos los documentos con PDF */}
                      {doc.pdf_attachment_url && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedPdfDoc(doc)}
                          className="gap-2"
                        >
                          <Eye className="h-4 w-4" />
                          Ver PDF
                        </Button>
                      )}
                      
                      {/* Botón Descartar - para no publicables */}
                      {isNotPublishable && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDismissError(doc.id, doc.doc_number)}
                          className="gap-2 border-orange-400 text-orange-700 hover:bg-orange-100 dark:border-orange-600 dark:text-orange-300 dark:hover:bg-orange-900/30"
                        >
                          <Trash2 className="h-4 w-4" />
                          Descartar
                        </Button>
                      )}
                      
                      {/* Botón Cambiar Cuenta - solo si el error es de cuenta */}
                      {errorInfo.canChangeAccount && (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => {
                            setChangeAccountDoc(doc);
                            setSelectedAccount(doc.default_account_ref || "");
                          }}
                        >
                          <Settings2 className="h-4 w-4 mr-2" />
                          Cambiar Cuenta
                        </Button>
                      )}
                      
                      {/* Botón Reintentar - solo si tiene sentido */}
                      {errorInfo.canRetry && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRetry(doc.id, doc.doc_number)}
                        >
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Reintentar
                        </Button>
                      )}
                      
                      {/* Botón Forzar Publicación - para errores de totales */}
                      {errorInfo.canForcePublish && (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => handleForcePublish(doc.id, doc.doc_number)}
                          className="bg-amber-600 hover:bg-amber-700"
                        >
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Forzar Publicación
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      {/* Modal para cambiar cuenta */}
      <Dialog open={!!changeAccountDoc} onOpenChange={(open) => !open && setChangeAccountDoc(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Cambiar Cuenta Contable</DialogTitle>
            <DialogDescription>
              Selecciona una cuenta válida de QuickBooks para la factura #{changeAccountDoc?.doc_number}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Proveedor</Label>
              <p className="text-sm text-muted-foreground">{changeAccountDoc?.supplier_name}</p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="account">Cuenta de Gastos</Label>
              {isLoadingAccounts ? (
                <p className="text-sm text-muted-foreground">Cargando cuentas de QuickBooks...</p>
              ) : accounts.length === 0 ? (
                <p className="text-sm text-destructive">No se encontraron cuentas. Verifica la conexión con QuickBooks.</p>
              ) : (
                <AccountCombobox
                  accounts={accounts.map(acc => ({
                    id: acc.id,
                    name: acc.name,
                    accountNumber: acc.accountNumber || undefined
                  }))}
                  value={selectedAccount}
                  onValueChange={setSelectedAccount}
                  placeholder="Seleccionar cuenta..."
                />
              )}
              <p className="text-xs text-muted-foreground">
                Esta cuenta se guardará como predeterminada para este proveedor
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeAccountDoc(null)}>
              Cancelar
            </Button>
            <Button 
              onClick={handleChangeAccount} 
              disabled={!selectedAccount || isUpdatingAccount}
            >
              {isUpdatingAccount ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Actualizando...
                </>
              ) : (
                "Guardar y Republicar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal para ver PDF */}
      <Dialog open={!!selectedPdfDoc} onOpenChange={(open) => !open && setSelectedPdfDoc(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              PDF: {selectedPdfDoc?.doc_number}
            </DialogTitle>
            <DialogDescription>
              {selectedPdfDoc?.supplier_name} - {selectedPdfDoc?.total_amount && formatCurrency(selectedPdfDoc.total_amount, selectedPdfDoc.currency)}
            </DialogDescription>
          </DialogHeader>
          
          {selectedPdfDoc?.error_message && (
            <div className="p-3 bg-destructive/10 rounded-lg border border-destructive/20 mb-2">
              <p className="text-sm text-destructive font-medium">
                Error: {getErrorSummary(selectedPdfDoc).description}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {getErrorSummary(selectedPdfDoc).solution}
              </p>
            </div>
          )}
          
          <div className="h-[60vh] overflow-auto">
            {selectedPdfDoc?.pdf_attachment_url && selectedPdfDoc.organization_id && (
              <PdfViewer 
                url={selectedPdfDoc.pdf_attachment_url} 
                organizationId={selectedPdfDoc.organization_id}
                docNumber={selectedPdfDoc.doc_number}
                documentId={selectedPdfDoc.id}
                fileName={selectedPdfDoc.doc_number}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ErrorDocuments;
