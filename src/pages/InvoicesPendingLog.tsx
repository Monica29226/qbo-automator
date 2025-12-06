import { CheckCircle2, Eye, FileText, Loader2, RefreshCw, Search, Star, Trash2, Upload, X, Filter, CalendarIcon, CheckSquare, Square, ListChecks } from "lucide-react";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { AccountCombobox } from "@/components/AccountCombobox";
import { Badge } from "@/components/ui/badge";
import { usePublishQueue } from "@/hooks/usePublishQueue";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PublishValidationDialog } from "@/components/PublishValidationDialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";
import { PdfViewer } from "@/components/PdfViewer";
import { useQBOAccounts } from "@/hooks/useQBOAccounts";
import { useDebounce } from "@/hooks/useDebounce";
import { usePendingInvoicesOptimized, useVendorDefaults } from "@/hooks/usePendingInvoicesOptimized";

interface QBOAccount {
  id: string;
  name: string;
  accountNumber: string;
  accountType: string;
}

interface PendingInvoice {
  id: string;
  doc_number: string;
  supplier_name: string;
  supplier_tax_id: string | null;
  total_amount: number;
  currency: string;
  created_at: string;
  vendor_id: string | null;
  default_account_ref?: string;
  default_class_ref?: string | null;
  uses_tax?: boolean;
  has_vendor_default?: boolean;
  pdf_attachment_url?: string | null;
  xml_data?: any;
  issue_date?: string;
  status?: string;
  qbo_entity_id?: string | null;
}

const InvoicesPendingLog = () => {
  const { activeOrganization } = useAuth();
  
  // ===== HOOKS OPTIMIZADOS CON CACHING =====
  const {
    accounts: qboAccounts,
    isLoading: loadingAccounts,
    isConnected: qboConnected,
    refetch: refetchQBOAccounts,
    getAccountIdFromCode,
  } = useQBOAccounts();
  
  // Hook optimizado con React Query (caching de 60s)
  const { 
    invoices: rawInvoices, 
    isLoading, 
    refetch: refetchInvoices,
    removeInvoicesByVendor,
    updateInvoiceOptimistic,
    invalidate: invalidateInvoices 
  } = usePendingInvoicesOptimized();
  
  const { data: vendorDefaults } = useVendorDefaults();
  const { addToQueue } = usePublishQueue();
  
  const qboNotConnected = !qboConnected && !loadingAccounts;
  
  // Estados locales (solo UI, no data)
  const [filteredInvoices, setFilteredInvoices] = useState<PendingInvoice[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set());
  const [selectedInvoice, setSelectedInvoice] = useState<PendingInvoice | null>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [pdfViewerOpen, setPdfViewerOpen] = useState(false);
  const [currentPdfUrl, setCurrentPdfUrl] = useState<string | null>(null);
  const [currentPdfName, setCurrentPdfName] = useState<string>("");

  // Filtros individuales por columna
  const [filterDocNumber, setFilterDocNumber] = useState("");
  const [filterSupplier, setFilterSupplier] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [filterQBStatus, setFilterQBStatus] = useState<"all" | "published" | "pending">("all");
  const [filterMinAmount, setFilterMinAmount] = useState("");
  const [filterMaxAmount, setFilterMaxAmount] = useState("");
  
  // ===== SELECCIÓN MÚLTIPLE =====
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkClassifyDialog, setShowBulkClassifyDialog] = useState(false);
  const [bulkAccountId, setBulkAccountId] = useState("");
  const [isBulkClassifying, setIsBulkClassifying] = useState(false);
  
  // ===== PREVENIR ACTUALIZACIONES DUPLICADAS =====
  const updatingInvoicesRef = useRef<Set<string>>(new Set());
  
  // ===== VIRTUAL SCROLLING =====
  const tableContainerRef = useRef<HTMLDivElement>(null);
  
  // ===== DEBOUNCE PARA FILTROS (300ms delay) =====
  const debouncedDocNumber = useDebounce(filterDocNumber, 300);
  const debouncedSupplier = useDebounce(filterSupplier, 300);
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const debouncedMinAmount = useDebounce(filterMinAmount, 300);
  const debouncedMaxAmount = useDebounce(filterMaxAmount, 300);

  // Función de normalización para comparar vendor names
  const normalizeVendorName = (name: string): string => {
    return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "").trim();
  };

  // Memoizar facturas filtradas y enriquecidas con vendor defaults
  const filteredData = useMemo(() => {
    // Enriquecer con vendor defaults del cache
    let filtered = rawInvoices.map(inv => {
      if (!inv.default_account_ref && vendorDefaults) {
        const normalizedName = normalizeVendorName(inv.supplier_name);
        // Buscar en el Map por nombre normalizado
        for (const [key, def] of vendorDefaults) {
          if (normalizeVendorName(key) === normalizedName && def.default_account_ref) {
            return {
              ...inv,
              default_account_ref: def.default_account_ref,
              uses_tax: def.default_uses_tax ?? true,
              has_vendor_default: true
            };
          }
        }
      }
      return inv;
    });

    // Filtro por número de documento (debounced)
    if (debouncedDocNumber.trim()) {
      const searchLower = debouncedDocNumber.toLowerCase();
      filtered = filtered.filter((inv) => 
        inv.doc_number.toLowerCase().includes(searchLower)
      );
    }

    // Filtro por proveedor (debounced)
    if (debouncedSupplier.trim()) {
      const searchLower = debouncedSupplier.toLowerCase();
      filtered = filtered.filter((inv) => 
        inv.supplier_name.toLowerCase().includes(searchLower) ||
        (inv.supplier_tax_id && inv.supplier_tax_id.toLowerCase().includes(searchLower))
      );
    }

    // Filtro por rango de fechas
    if (dateRange?.from) {
      filtered = filtered.filter((inv) => {
        const invoiceDate = new Date(inv.issue_date || inv.created_at);
        const fromDate = new Date(dateRange.from!);
        fromDate.setHours(0, 0, 0, 0);
        
        if (!dateRange.to) {
          return invoiceDate >= fromDate;
        }
        
        const toDate = new Date(dateRange.to);
        toDate.setHours(23, 59, 59, 999);
        return invoiceDate >= fromDate && invoiceDate <= toDate;
      });
    }

    // Filtro por estado de QuickBooks
    if (filterQBStatus !== "all") {
      filtered = filtered.filter((inv) => {
        if (filterQBStatus === "published") {
          return inv.qbo_entity_id !== null && inv.qbo_entity_id !== undefined;
        } else {
          return !inv.qbo_entity_id;
        }
      });
    }

    // Filtro por rango de monto (debounced)
    if (debouncedMinAmount.trim()) {
      const minVal = parseFloat(debouncedMinAmount);
      if (!isNaN(minVal)) {
        filtered = filtered.filter((inv) => inv.total_amount >= minVal);
      }
    }
    if (debouncedMaxAmount.trim()) {
      const maxVal = parseFloat(debouncedMaxAmount);
      if (!isNaN(maxVal)) {
        filtered = filtered.filter((inv) => inv.total_amount <= maxVal);
      }
    }

    // Búsqueda general (debouncedSearchTerm)
    if (debouncedSearchTerm.trim()) {
      const searchLower = debouncedSearchTerm.toLowerCase();
      filtered = filtered.filter((inv) => {
        if (inv.doc_number.toLowerCase().includes(searchLower)) return true;
        if (inv.supplier_name.toLowerCase().includes(searchLower)) return true;
        if (inv.default_account_ref && inv.default_account_ref.toLowerCase().includes(searchLower)) return true;
        return false;
      });
    }

    return filtered;
  }, [debouncedSearchTerm, rawInvoices, debouncedDocNumber, debouncedSupplier, dateRange, filterQBStatus, debouncedMinAmount, debouncedMaxAmount, vendorDefaults]);

  // Sincronizar filteredInvoices solo cuando filteredData cambia
  useEffect(() => {
    setFilteredInvoices(filteredData);
  }, [filteredData]);

  // Limpiar selección solo cuando cambian los filtros de búsqueda (no los datos)
  useEffect(() => {
    setSelectedIds(new Set());
  }, [debouncedDocNumber, debouncedSupplier, debouncedSearchTerm, filterQBStatus]);

  // Función para limpiar todos los filtros
  const clearAllFilters = () => {
    setFilterDocNumber("");
    setFilterSupplier("");
    setDateRange(undefined);
    setFilterQBStatus("all");
    setSearchTerm("");
    setFilterMinAmount("");
    setFilterMaxAmount("");
  };

  // Verificar si hay filtros activos
  const hasActiveFilters = filterDocNumber || filterSupplier || dateRange?.from || filterQBStatus !== "all" || searchTerm || filterMinAmount || filterMaxAmount;

  // ===== FUNCIONES DE SELECCIÓN MÚLTIPLE =====
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredInvoices.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredInvoices.map((inv) => inv.id)));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  // Obtener sugerencia de cuenta para un proveedor (usando vendor defaults)
  const getSuggestedAccount = (supplierName: string): string | null => {
    const def = vendorDefaults?.get(supplierName);
    return def?.default_account_ref || null;
  };

  // ===== CLASIFICACIÓN MASIVA =====
  const handleBulkClassify = async () => {
    if (!bulkAccountId || selectedIds.size === 0 || !activeOrganization) return;
    
    setIsBulkClassifying(true);
    const selectedInvoices = filteredInvoices.filter((inv) => selectedIds.has(inv.id));
    
    try {
      // Obtener información de la cuenta
      const account = qboAccounts.find((acc) => acc.id === bulkAccountId);
      if (!account) {
        toast.error("Cuenta no encontrada");
        return;
      }
      
      const accountRef = account.accountNumber 
        ? `${account.accountNumber} - ${account.name}` 
        : account.name;
      
      // Agrupar por proveedor para crear reglas
      const vendorGroups = new Map<string, PendingInvoice[]>();
      selectedInvoices.forEach((inv) => {
        const existing = vendorGroups.get(inv.supplier_name) || [];
        existing.push(inv);
        vendorGroups.set(inv.supplier_name, existing);
      });
      
      // Actualizar todos los documentos
      const documentIds = selectedInvoices.map((inv) => inv.id);
      
      const { error: updateError } = await supabase
        .from("processed_documents")
        .update({ default_account_ref: accountRef })
        .in("id", documentIds);
      
      if (updateError) throw updateError;
      
      // Crear reglas para cada proveedor único
      for (const [vendorName] of vendorGroups) {
        await saveVendorDefault(vendorName, accountRef, true);
      }
      
      toast.success(`✓ ${selectedInvoices.length} facturas clasificadas. Publicando en segundo plano...`);
      
      // Optimistic update - remover inmediatamente de UI (ANTES de publicar)
      setFilteredInvoices((prev) => prev.filter((inv) => !documentIds.includes(inv.id)));
      setSelectedIds(new Set());
      setShowBulkClassifyDialog(false);
      setBulkAccountId("");
      
      // Publicar en BACKGROUND (fire-and-forget) - NO bloquea UI
      supabase.functions.invoke("publish-to-quickbooks", {
        body: { organization_id: activeOrganization, document_ids: documentIds },
      }).then(({ data, error }) => {
        if (error) {
          console.error("Error publicando:", error);
          toast.warning(`⚠️ Error publicando algunas facturas. Revise el log.`);
        } else {
          const published = data?.published || 0;
          const errors = data?.errors?.length || 0;
          if (errors > 0) {
            toast.warning(`⚠️ ${published} publicadas, ${errors} con errores`);
          } else if (published > 0) {
            toast.success(`✅ ${published} facturas publicadas a QuickBooks`);
          }
        }
      }).catch(e => console.error("Background publish error:", e));
      
      // Refrescar en background
      invalidateInvoices();
      
    } catch (error: any) {
      console.error("Error en clasificación masiva:", error);
      toast.error(`Error: ${error.message || "Error desconocido"}`);
    } finally {
      setIsBulkClassifying(false);
    }
  };

  const saveVendorDefault = async (
    vendorName: string,
    accountRef: string | null,
    usesTax: boolean
  ) => {
    if (!activeOrganization) return;

    try {
      const accountInfo = accountRef ? qboAccounts.find(acc => 
        `${acc.accountNumber} - ${acc.name}` === accountRef || 
        acc.accountNumber === accountRef
      ) : null;

      // Ejecutar operaciones en PARALELO usando async functions
      const saveDefault = async () => {
        return supabase
          .from("vendor_defaults")
          .upsert({
            organization_id: activeOrganization,
            vendor_name: vendorName,
            default_account_ref: accountRef,
            default_uses_tax: usesTax,
          }, { onConflict: "organization_id,vendor_name" });
      };

      const saveRule = async () => {
        if (!accountRef) return null;
        return supabase
          .from("vendor_classification_rules")
          .upsert({
            organization_id: activeOrganization,
            vendor_name: vendorName,
            account_code: accountInfo?.accountNumber || accountRef,
            account_description: accountInfo?.name || "Cuenta configurada",
            is_active: true,
          }, { onConflict: "organization_id,vendor_name" });
      };

      await Promise.all([saveDefault(), saveRule()]);
      console.log(`✓ Default guardado para ${vendorName}`);
    } catch (error: any) {
      console.error("Error saving vendor default:", error);
    }
  };

  const handleUpdateInvoice = async (
    id: string,
    field: string,
    value: string | boolean
  ) => {
    // ===== GUARD: Prevenir actualizaciones duplicadas =====
    const updateKey = `${id}-${field}`;
    if (updatingInvoicesRef.current.has(updateKey)) {
      console.log('⏳ Actualización ya en progreso, ignorando:', updateKey);
      return;
    }
    updatingInvoicesRef.current.add(updateKey);
    
    console.log('🎯 handleUpdateInvoice llamado con ID:', id, 'Field:', field);

    const invoice = rawInvoices.find((inv) => inv.id === id) || filteredInvoices.find((inv) => inv.id === id);
    if (!invoice) {
      console.error('❌ Factura no encontrada con ID:', id);
      toast.error("Error: Factura no encontrada. Recargue la página.");
      updatingInvoicesRef.current.delete(updateKey);
      return;
    }

    // Si estamos actualizando default_account_ref, resolver la cuenta PRIMERO
    let valueToSave = value;
    let account: QBOAccount | undefined;
    
    if (field === "default_account_ref" && typeof value === "string") {
      account = qboAccounts.find(acc => acc.id === value);
      if (!account) {
        console.error('❌ Cuenta no encontrada:', value);
        toast.error("No se pudo encontrar la cuenta seleccionada.");
        updatingInvoicesRef.current.delete(updateKey);
        return;
      }
      valueToSave = account.accountNumber 
        ? `${account.accountNumber} - ${account.name}` 
        : account.name;
    }

    // ===== OPTIMISTIC UPDATE INMEDIATO - UI responde al instante =====
    const vendorName = invoice.supplier_name;
    const vendorInvoices = rawInvoices.filter(inv => 
      inv.supplier_name === vendorName && 
      !inv.qbo_entity_id &&
      (inv.status === 'pending' || inv.status === 'pending_config')
    );
    const documentIds = vendorInvoices.map(inv => inv.id);
    const count = documentIds.length;

    if (field === "default_account_ref" && typeof valueToSave === 'string' && valueToSave.trim() !== '') {
      // Remover de UI INMEDIATAMENTE (antes de BD)
      removeInvoicesByVendor(vendorName);
      setFilteredInvoices((prev) => prev.filter((inv) => inv.supplier_name !== vendorName));
      
      // Toast de éxito INMEDIATO
      toast.success(`✓ ${count} factura${count > 1 ? 's' : ''} de ${vendorName} en cola de publicación`);
      
      // Agregar a cola de publicación INMEDIATAMENTE (no bloquea)
      if (activeOrganization) {
        addToQueue({
          documentIds,
          vendorName,
          organizationId: activeOrganization
        });
      }
    } else {
      // Para otros campos, solo actualizar la factura individual
      updateInvoiceOptimistic(id, { [field]: valueToSave });
      toast.success("Actualizado correctamente");
    }

    // Limpiar guard inmediatamente para permitir otras operaciones
    updatingInvoicesRef.current.delete(updateKey);

    // ===== OPERACIONES BD EN BACKGROUND (fire-and-forget) =====
    // Todas las operaciones de BD corren en paralelo sin bloquear UI
    (async () => {
      try {
        const promises: PromiseLike<any>[] = [];

        // 1. Actualizar documento
        promises.push(
          supabase
            .from("processed_documents")
            .update({ [field]: valueToSave })
            .eq("id", id)
            .select()
        );

        // 2. Actualizar vendor si existe
        if ((field === "default_account_ref" || field === "default_class_ref") && invoice.vendor_id) {
          promises.push(
            supabase
              .from("vendors")
              .update({ [field]: valueToSave })
              .eq("id", invoice.vendor_id)
              .select()
          );
        }

        // 3. Guardar vendor_defaults
        if (field === "default_account_ref" && typeof valueToSave === 'string') {
          promises.push(
            supabase
              .from("vendor_defaults")
              .upsert({
                organization_id: activeOrganization,
                vendor_name: vendorName,
                default_account_ref: valueToSave,
                default_uses_tax: invoice.uses_tax ?? true,
              }, { onConflict: "organization_id,vendor_name" })
              .select()
          );

          // 4. Guardar classification_rules
          if (account) {
            promises.push(
              supabase
                .from("vendor_classification_rules")
                .upsert({
                  organization_id: activeOrganization,
                  vendor_name: vendorName,
                  account_code: account.accountNumber || valueToSave as string,
                  account_description: account.name || "Cuenta configurada",
                  is_active: true,
                }, { onConflict: "organization_id,vendor_name" })
                .select()
            );
          }
        }

        // Ejecutar todas las operaciones BD en paralelo
        const results = await Promise.allSettled(promises);
        
        // Log errores en background (no afecta UI)
        results.forEach((result, idx) => {
          if (result.status === 'rejected') {
            console.error(`❌ Error en operación BD ${idx}:`, result.reason);
          }
        });

        console.log('✅ Todas las operaciones BD completadas en background');
      } catch (error) {
        console.error('❌ Error en operaciones BD background:', error);
      }
    })();
  };

  const handleDeleteInvoice = async (id: string) => {
    try {
      // Optimistic update
      setFilteredInvoices((prev) => prev.filter((inv) => inv.id !== id));
      
      const { error } = await supabase
        .from("processed_documents")
        .delete()
        .eq("id", id);

      if (error) {
        invalidateInvoices(); // Restore on error
        throw error;
      }

      toast.success("Factura eliminada");
    } catch (error: any) {
      console.error("Error deleting invoice:", error);
      toast.error("Error al eliminar factura");
    }
  };

  const handlePublishSingle = async (id: string) => {
    setPublishingIds((prev) => new Set(prev).add(id));
    try {
      const { data, error } = await supabase.functions.invoke(
        "publish-to-quickbooks",
        {
          body: { organization_id: activeOrganization, document_ids: [id] },
        }
      );

      if (error) throw error;

      toast.success("Factura publicada correctamente");
      invalidateInvoices();
    } catch (error: any) {
      console.error("Error publishing invoice:", error);
      toast.error(error.message || "Error al publicar factura");
    } finally {
      setPublishingIds((prev) => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    }
  };

  const handlePublishAll = async () => {
    if (filteredInvoices.length === 0) {
      toast.error("No hay facturas para publicar");
      return;
    }

    const totalInvoices = filteredInvoices.length;
    setIsPublishing(true);
    
    // Mostrar toast de progreso con estimación de tiempo
    const estimatedTime = Math.ceil((totalInvoices * 3) / 60); // ~3 segundos por factura
    const progressToast = toast.loading(
      `Publicando ${totalInvoices} facturas a QuickBooks... (estimado: ${estimatedTime} min)`,
      { duration: Infinity }
    );

    try {
      const documentIds = filteredInvoices.map((inv) => inv.id);
      
      // Usar AbortController para timeout más largo (5 minutos)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000);
      
      const { data, error } = await supabase.functions.invoke(
        "publish-to-quickbooks",
        {
          body: { organization_id: activeOrganization, document_ids: documentIds },
        }
      );
      
      clearTimeout(timeoutId);

      if (error) throw error;

      toast.dismiss(progressToast);
      const published = data?.published || totalInvoices;
      const errors = data?.errors?.length || 0;
      
      if (errors > 0) {
        toast.warning(`⚠️ ${published} publicadas, ${errors} con errores. Recarga para ver detalles.`);
      } else {
        toast.success(`✅ ${published} facturas publicadas correctamente a QuickBooks`);
      }
      
      invalidateInvoices();
      setFilteredInvoices([]);
      setShowPublishDialog(false);
    } catch (error: any) {
      console.error("Error publishing all:", error);
      toast.dismiss(progressToast);
      
      // Si es timeout, verificar estado actual en DB
      if (error.name === 'AbortError' || error.message?.includes('timeout')) {
        toast.info("La publicación puede estar en progreso. Recarga la página en 2 minutos para verificar.");
      } else {
        toast.error(error.message || "Error al publicar facturas");
      }
    } finally {
      setIsPublishing(false);
    }
  };

  const handleOpenPDF = async (invoice: PendingInvoice) => {
    console.log("🔍 handleOpenPDF llamado para:", invoice.doc_number);
    console.log("📎 PDF URL original:", invoice.pdf_attachment_url);
    
    if (!invoice.pdf_attachment_url) {
      console.warn("⚠️ PDF no disponible para:", invoice.doc_number);
      toast.error("PDF no disponible para esta factura");
      return;
    }

    try {
      let pdfPath = invoice.pdf_attachment_url;
      
      // Extraer el path relativo del storage desde cualquier formato de URL
      if (pdfPath.includes('storage/v1/object/public/company-documents/')) {
        pdfPath = pdfPath.split('storage/v1/object/public/company-documents/')[1];
      } else if (pdfPath.includes('company-documents/')) {
        pdfPath = pdfPath.split('company-documents/').pop() || pdfPath;
      }
      
      // Remover prefijos si los tiene
      if (pdfPath.startsWith('company-documents/')) {
        pdfPath = pdfPath.replace('company-documents/', '');
      }
      
      console.log("📂 Path final para storage:", pdfPath);
      
      // Generar signed URL (1 hora de expiración)
      const { data, error: signedUrlError } = await supabase.storage
        .from('company-documents')
        .createSignedUrl(pdfPath, 3600);

      if (signedUrlError) {
        console.error("❌ Error generando signed URL:", signedUrlError);
        throw new Error(`No se pudo generar URL: ${signedUrlError.message}`);
      }

      console.log("✅ Signed URL generada");
      
      setCurrentPdfUrl(data.signedUrl);
      setCurrentPdfName(`Factura ${invoice.doc_number}`);
      setPdfViewerOpen(true);
      
    } catch (error: any) {
      console.error("❌ Error al cargar PDF:", error);
      toast.error(error.message || "Error al cargar el PDF");
    }
  };

  const handleClosePdfViewer = () => {
    setPdfViewerOpen(false);
    setCurrentPdfUrl(null);
  };

  const handleShowDetail = (invoice: PendingInvoice) => {
    setSelectedInvoice(invoice);
    setShowDetailDialog(true);
  };

  const handleVerifyQBOBill = async (invoice: PendingInvoice) => {
    if (!invoice.qbo_entity_id || !activeOrganization) {
      toast.error("No hay ID de QuickBooks para verificar");
      return;
    }

    console.log(`🔍 Verificando Bill ${invoice.qbo_entity_id} en QuickBooks...`);
    const loadingToast = toast.loading("Verificando en QuickBooks...");

    try {
      const { data, error } = await supabase.functions.invoke('verify-qbo-bill-exists', {
        body: {
          organization_id: activeOrganization,
          bill_id: invoice.qbo_entity_id
        }
      });

      if (error) throw error;

      toast.dismiss(loadingToast);

      if (data.exists) {
        toast.success(
          `✅ El Bill ${invoice.qbo_entity_id} SÍ existe en QuickBooks` +
          (data.vendor_ref ? ` - ${data.vendor_ref}` : ''),
          { duration: 5000 }
        );
        console.log("✅ Bill verificado:", data);
      } else {
        // El bill no existe - actualizar el estado en la base de datos
        toast.error(
          `❌ El Bill ${invoice.qbo_entity_id} NO existe en QuickBooks. ` +
          `Se actualizará el estado a "pendiente".`,
          { duration: 7000 }
        );
        
        console.warn("❌ Bill no encontrado en QuickBooks:", data);

        // Actualizar el estado a pending y limpiar el qbo_entity_id
        const { error: updateError } = await supabase
          .from('processed_documents')
          .update({ 
            status: 'pending',
            qbo_entity_id: null,
            qbo_entity_type: null,
            error_message: `Bill ${invoice.qbo_entity_id} no encontrado en QuickBooks al verificar`
          })
          .eq('id', invoice.id);

        if (updateError) {
          console.error("Error al actualizar estado:", updateError);
          toast.error("Error al actualizar el estado de la factura");
        } else {
          // Refrescar la lista
          invalidateInvoices();
          toast.success("Estado actualizado correctamente");
        }
      }

    } catch (error: any) {
      toast.dismiss(loadingToast);
      console.error("❌ Error al verificar:", error);
      toast.error(`Error al verificar: ${error.message}`);
    }
  };

  // OPTIMIZACIÓN: Memoizar totales por proveedor
  const totalsBySupplier = useMemo(() => {
    return filteredInvoices.reduce((acc, inv) => {
      if (!acc[inv.supplier_name]) {
        acc[inv.supplier_name] = 0;
      }
      acc[inv.supplier_name] += inv.total_amount;
      return acc;
    }, {} as Record<string, number>);
  }, [filteredInvoices]);

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat("es-CR", {
      style: "currency",
      currency: currency || "CRC",
    }).format(amount);
  };

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Log de Facturas Pendientes</h1>
          <p className="text-muted-foreground">
            Gestiona y configura las facturas antes de publicar a QuickBooks
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <>
              <Badge variant="secondary" className="text-sm px-3 py-1">
                {selectedIds.size} seleccionada{selectedIds.size !== 1 ? 's' : ''}
              </Badge>
              <Button
                onClick={() => setShowBulkClassifyDialog(true)}
                variant="default"
                size="default"
              >
                <ListChecks className="h-4 w-4 mr-2" />
                Clasificar Seleccionadas
              </Button>
              <Button
                onClick={clearSelection}
                variant="outline"
                size="sm"
              >
                <X className="h-4 w-4 mr-1" />
                Limpiar
              </Button>
            </>
          )}
          <Button
            onClick={() => setShowPublishDialog(true)}
            disabled={filteredInvoices.length === 0 || isPublishing}
            size="lg"
          >
            {isPublishing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Publicando...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Publicar Todas ({filteredInvoices.length})
              </>
            )}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Búsqueda general por número, proveedor o cuenta..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            {hasActiveFilters && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearAllFilters}
                className="whitespace-nowrap"
              >
                <X className="h-4 w-4 mr-2" />
                Limpiar Filtros
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : filteredInvoices.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No hay facturas pendientes
            </div>
          ) : (
            <div className="rounded-md border" ref={tableContainerRef}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <Checkbox
                        checked={selectedIds.size === filteredInvoices.length && filteredInvoices.length > 0}
                        onCheckedChange={toggleSelectAll}
                        aria-label="Seleccionar todas"
                      />
                    </TableHead>
                    <TableHead className="w-[120px]">Número</TableHead>
                    <TableHead className="w-[200px]">Proveedor</TableHead>
                    <TableHead className="w-[110px]">Monto</TableHead>
                    <TableHead className="w-[100px]">Fecha</TableHead>
                    <TableHead className="w-[280px]">Cuenta Contable</TableHead>
                    <TableHead className="w-[140px]">Centro de Costo</TableHead>
                    <TableHead className="text-center w-[100px]">Estado QB</TableHead>
                    <TableHead className="text-right w-[180px]">Acciones</TableHead>
                  </TableRow>
                  {/* Fila de filtros */}
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="py-2">
                      {/* Checkbox column - no filter */}
                    </TableHead>
                    <TableHead className="py-2">
                      <Input
                        placeholder="Filtrar..."
                        value={filterDocNumber}
                        onChange={(e) => setFilterDocNumber(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </TableHead>
                    <TableHead className="py-2">
                      <Input
                        placeholder="Filtrar..."
                        value={filterSupplier}
                        onChange={(e) => setFilterSupplier(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </TableHead>
                    <TableHead className="py-2">
                      <div className="flex gap-1">
                        <Input
                          placeholder="Min"
                          value={filterMinAmount}
                          onChange={(e) => setFilterMinAmount(e.target.value)}
                          className="h-8 text-xs w-[50px]"
                          type="number"
                        />
                        <Input
                          placeholder="Max"
                          value={filterMaxAmount}
                          onChange={(e) => setFilterMaxAmount(e.target.value)}
                          className="h-8 text-xs w-[50px]"
                          type="number"
                        />
                      </div>
                    </TableHead>
                    <TableHead className="py-2">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              "h-8 w-full justify-start text-left font-normal text-xs",
                              !dateRange && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="mr-2 h-3 w-3" />
                            {dateRange?.from ? (
                              dateRange.to ? (
                                <>
                                  {format(dateRange.from, "dd/MM", { locale: es })} -{" "}
                                  {format(dateRange.to, "dd/MM", { locale: es })}
                                </>
                              ) : (
                                format(dateRange.from, "dd/MM/yyyy", { locale: es })
                              )
                            ) : (
                              <span>Fechas</span>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="range"
                            selected={dateRange}
                            onSelect={setDateRange}
                            numberOfMonths={2}
                            locale={es}
                            className={cn("p-3 pointer-events-auto")}
                          />
                        </PopoverContent>
                      </Popover>
                    </TableHead>
                    <TableHead className="py-2">
                      {/* Sin filtro para cuenta contable */}
                    </TableHead>
                    <TableHead className="py-2">
                      {/* Sin filtro para centro de costo */}
                    </TableHead>
                    <TableHead className="py-2 text-center">
                      <Select
                        value={filterQBStatus}
                        onValueChange={(value: "all" | "published" | "pending") => setFilterQBStatus(value)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos</SelectItem>
                          <SelectItem value="published">Publicado</SelectItem>
                          <SelectItem value="pending">Pendiente</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableHead>
                    <TableHead className="py-2">
                      {/* Sin filtro para acciones */}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInvoices.map((invoice) => {
                    const suggestedAccount = getSuggestedAccount(invoice.supplier_name);
                    return (
                    <TableRow 
                      key={invoice.id}
                      className={cn(
                        "hover:bg-muted/50",
                        selectedIds.has(invoice.id) && "bg-primary/5"
                      )}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(invoice.id)}
                          onCheckedChange={() => toggleSelectOne(invoice.id)}
                          aria-label={`Seleccionar factura ${invoice.doc_number}`}
                        />
                      </TableCell>
                      <TableCell 
                        className="font-medium cursor-pointer hover:underline hover:text-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenPDF(invoice);
                        }}
                      >
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="flex items-center gap-1">
                                <FileText className="h-3 w-3" />
                                {invoice.doc_number}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Click para ver PDF</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{invoice.supplier_name}</div>
                          {invoice.supplier_tax_id && (
                            <div className="text-xs text-muted-foreground">
                              {invoice.supplier_tax_id}
                            </div>
                          )}
                          {suggestedAccount && !invoice.default_account_ref && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center gap-1 mt-1">
                                    <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                                    <span className="text-xs text-amber-600">Sugerida</span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Cuenta histórica: {suggestedAccount}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {formatCurrency(invoice.total_amount, invoice.currency)}
                      </TableCell>
                      <TableCell>
                        {new Date(invoice.issue_date).toLocaleDateString("es-CR")}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {invoice.status === "published" && invoice.qbo_entity_id ? (
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1">
                                <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
                                <span className="text-xs text-green-600 font-medium">Publicado en QB</span>
                              </div>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleVerifyQBOBill(invoice)}
                                      className="h-6 w-6 p-0"
                                    >
                                      <RefreshCw className="h-3 w-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>Verificar en QuickBooks</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          ) : (
                            <>
                            <AccountCombobox
                                accounts={qboAccounts}
                                value={getAccountIdFromCode(invoice.default_account_ref)}
                                onValueChange={(value) => {
                                  // Capturar ID inmediatamente para evitar race conditions
                                  const invoiceId = invoice.id;
                                  const invoiceDocNum = invoice.doc_number;
                                  const supplierName = invoice.supplier_name;
                                  
                                  console.log('🔄 Cuenta seleccionada para:', invoiceDocNum, supplierName);
                                  console.log('📌 Invoice ID capturado:', invoiceId);
                                  
                                  handleUpdateInvoice(
                                    invoiceId,
                                    "default_account_ref",
                                    value
                                  );
                                }}
                                disabled={loadingAccounts || qboAccounts.length === 0}
                                className="w-[260px]"
                                placeholder={
                                  loadingAccounts 
                                    ? "Cargando cuentas..." 
                                    : qboAccounts.length === 0 
                                      ? "Sin cuentas - verificar QB"
                                      : "Seleccionar cuenta"
                                }
                              />
                              {invoice.has_vendor_default && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>Usando configuración predeterminada del proveedor</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          placeholder="Opcional"
                          value={invoice.default_class_ref || ""}
                          onChange={(e) =>
                            handleUpdateInvoice(
                              invoice.id,
                              "default_class_ref",
                              e.target.value
                            )
                          }
                          className="w-[120px]"
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        {invoice.qbo_entity_id ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex justify-center">
                                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Publicado en QuickBooks</p>
                                <p className="text-xs text-muted-foreground">ID: {invoice.qbo_entity_id}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <div className="flex justify-center">
                            <span className="text-muted-foreground text-xs">Pendiente</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-2 justify-end">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleShowDetail(invoice)}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Ver detalle</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          {invoice.pdf_attachment_url && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleOpenPDF(invoice)}
                                  >
                                    <FileText className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Ver PDF</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handlePublishSingle(invoice.id)}
                            disabled={publishingIds.has(invoice.id)}
                          >
                            {publishingIds.has(invoice.id) ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Upload className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDeleteInvoice(invoice.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {Object.keys(totalsBySupplier).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Totales por Proveedor</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(totalsBySupplier).map(([supplier, total]) => (
                <div key={supplier} className="flex justify-between items-center">
                  <span className="font-medium">{supplier}</span>
                  <span className="text-muted-foreground">
                    {formatCurrency(total, "CRC")}
                  </span>
                </div>
              ))}
              <div className="border-t pt-2 flex justify-between items-center font-bold">
                <span>Total General</span>
                <span>
                  {formatCurrency(
                    Object.values(totalsBySupplier).reduce((a, b) => a + b, 0),
                    "CRC"
                  )}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <PublishValidationDialog
        open={showPublishDialog}
        onOpenChange={setShowPublishDialog}
        onConfirm={handlePublishAll}
        documentIds={filteredInvoices.map((inv) => inv.id)}
      />

      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Detalle de Factura {selectedInvoice?.doc_number}
            </DialogTitle>
          </DialogHeader>
          {selectedInvoice && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
                <div>
                  <p className="text-sm text-muted-foreground">Proveedor</p>
                  <p className="font-medium">{selectedInvoice.supplier_name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Cédula</p>
                  <p className="font-medium">{selectedInvoice.supplier_tax_id || "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Fecha de Emisión</p>
                  <p className="font-medium">
                    {selectedInvoice.issue_date 
                      ? new Date(selectedInvoice.issue_date).toLocaleDateString("es-CR")
                      : "N/A"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total</p>
                  <p className="font-medium text-lg">
                    {formatCurrency(selectedInvoice.total_amount, selectedInvoice.currency)}
                  </p>
                </div>
              </div>

              {selectedInvoice.xml_data?.detalle && (
                <div>
                  <h3 className="font-semibold mb-3">Líneas de Detalle</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Código</TableHead>
                        <TableHead>Descripción</TableHead>
                        <TableHead className="text-right">Cantidad</TableHead>
                        <TableHead className="text-right">Precio Unit.</TableHead>
                        <TableHead className="text-right">Descuento</TableHead>
                        <TableHead className="text-right">Impuesto</TableHead>
                        <TableHead className="text-right">Total Línea</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedInvoice.xml_data.detalle.map((linea: any, index: number) => (
                        <TableRow key={index}>
                          <TableCell>{linea.codigoProducto || "N/A"}</TableCell>
                          <TableCell className="max-w-xs truncate">
                            {linea.descripcion}
                          </TableCell>
                          <TableCell className="text-right">
                            {linea.cantidad} {linea.unidadMedida}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(linea.precioUnitario, selectedInvoice.currency)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(linea.montoDescuento || 0, selectedInvoice.currency)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(linea.montoImpuesto || 0, selectedInvoice.currency)}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(linea.montoTotalLinea, selectedInvoice.currency)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <div className="flex justify-between items-center p-4 bg-muted rounded-lg font-semibold">
                <span>Subtotal:</span>
                <span>{formatCurrency(selectedInvoice.xml_data?.subTotal || 0, selectedInvoice.currency)}</span>
              </div>
              <div className="flex justify-between items-center p-4 bg-muted rounded-lg font-semibold">
                <span>Descuentos:</span>
                <span>{formatCurrency(selectedInvoice.xml_data?.totalDescuentos || 0, selectedInvoice.currency)}</span>
              </div>
              <div className="flex justify-between items-center p-4 bg-muted rounded-lg font-semibold">
                <span>Impuestos:</span>
                <span>{formatCurrency(selectedInvoice.xml_data?.totalImpuesto || 0, selectedInvoice.currency)}</span>
              </div>
              <div className="flex justify-between items-center p-4 bg-primary text-primary-foreground rounded-lg font-bold text-lg">
                <span>Total:</span>
                <span>{formatCurrency(selectedInvoice.xml_data?.totalComprobante || selectedInvoice.total_amount, selectedInvoice.currency)}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal Visor de PDF */}
      <Dialog open={pdfViewerOpen} onOpenChange={handleClosePdfViewer}>
        <DialogContent className="max-w-6xl h-[90vh] p-0 flex flex-col">
          <DialogHeader className="flex flex-row items-center justify-between p-4 border-b bg-muted/50 space-y-0">
            <div>
              <DialogTitle className="text-lg font-semibold">{currentPdfName}</DialogTitle>
              <DialogDescription className="sr-only">
                Visor de documento PDF
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClosePdfViewer}
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            {currentPdfUrl ? (
              <PdfViewer url={currentPdfUrl} fileName={currentPdfName} />
            ) : (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog de Clasificación Masiva */}
      <Dialog open={showBulkClassifyDialog} onOpenChange={setShowBulkClassifyDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListChecks className="h-5 w-5" />
              Clasificar {selectedIds.size} Factura{selectedIds.size !== 1 ? 's' : ''}
            </DialogTitle>
            <DialogDescription>
              Selecciona una cuenta contable para aplicar a todas las facturas seleccionadas.
              Se creará una regla automática para cada proveedor.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Cuenta Contable</label>
              <AccountCombobox
                accounts={qboAccounts}
                value={bulkAccountId}
                onValueChange={setBulkAccountId}
                disabled={loadingAccounts || qboAccounts.length === 0}
                className="w-full"
                placeholder={
                  loadingAccounts 
                    ? "Cargando cuentas..." 
                    : qboAccounts.length === 0 
                      ? "Sin cuentas - verificar QB" 
                      : "Seleccionar cuenta"
                }
              />
            </div>
            
            <div className="bg-muted/50 rounded-lg p-3 text-sm">
              <p className="font-medium mb-2">Proveedores incluidos:</p>
              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                {[...new Set(
                  filteredInvoices
                    .filter((inv) => selectedIds.has(inv.id))
                    .map((inv) => inv.supplier_name)
                )].map((name) => (
                  <Badge key={name} variant="secondary" className="text-xs">
                    {name}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowBulkClassifyDialog(false);
                setBulkAccountId("");
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleBulkClassify}
              disabled={!bulkAccountId || isBulkClassifying}
            >
              {isBulkClassifying ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Clasificando...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Clasificar y Publicar
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default InvoicesPendingLog;
