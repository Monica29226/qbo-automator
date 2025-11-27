import { CheckCircle2, Eye, FileText, Loader2, RefreshCw, Search, Star, Trash2, Upload, X, Filter, CalendarIcon } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { AccountCombobox } from "@/components/AccountCombobox";
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

interface QBOAccount {
  id: string;
  name: string;
  accountNumber: string;
  accountType: string;
}

interface VendorDefault {
  id: string;
  vendor_name: string;
  default_account_ref: string | null;
  default_uses_tax: boolean;
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
  const [invoices, setInvoices] = useState<PendingInvoice[]>([]);
  const [filteredInvoices, setFilteredInvoices] = useState<PendingInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set());
  const [qboAccounts, setQboAccounts] = useState<QBOAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [vendorDefaults, setVendorDefaults] = useState<Map<string, VendorDefault>>(new Map());
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

  const fetchVendorDefaults = async () => {
    if (!activeOrganization) return;

    try {
      const { data, error } = await supabase
        .from("vendor_defaults")
        .select("*")
        .eq("organization_id", activeOrganization);

      if (error) throw error;

      const defaultsMap = new Map<string, VendorDefault>();
      data?.forEach((def) => {
        defaultsMap.set(def.vendor_name, def);
      });
      setVendorDefaults(defaultsMap);
    } catch (error: any) {
      console.error("Error fetching vendor defaults:", error);
    }
  };

  const fetchQBOAccounts = async () => {
    if (!activeOrganization) return;
    
    // Check if QuickBooks is connected first
    const { data: qbIntegration } = await supabase
      .from("integration_accounts")
      .select("id")
      .eq("organization_id", activeOrganization)
      .eq("service_type", "quickbooks")
      .eq("is_active", true)
      .maybeSingle();

    if (!qbIntegration) {
      console.log("QuickBooks not connected, skipping account fetch");
      return;
    }
    
    setLoadingAccounts(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "list-quickbooks-accounts",
        {
          body: { organization_id: activeOrganization },
        }
      );

      if (error) throw error;
      
      if (data?.accounts) {
        setQboAccounts(data.accounts);
      }
    } catch (error: any) {
      console.error("Error fetching QBO accounts:", error);
      toast.error("Error al cargar cuentas de QuickBooks");
    } finally {
      setLoadingAccounts(false);
    }
  };

  const fetchPendingInvoices = async () => {
    if (!activeOrganization) return;

    setIsLoading(true);
    try {
      // Fetch documents - incluir tanto pending como published recientes (últimas 24h)
      // FILTRO: Solo facturas de noviembre 2025 en adelante
      const { data: docsData, error: docsError } = await supabase
        .from("processed_documents")
        .select("*")
        .eq("organization_id", activeOrganization)
        .in("status", ["pending", "pending_config", "published"])
        .gte("issue_date", "2025-11-01")
        .order("created_at", { ascending: false })
        .limit(100);

      if (docsError) throw docsError;

      if (!docsData || docsData.length === 0) {
        setInvoices([]);
        setFilteredInvoices([]);
        return;
      }

      // Get unique vendor IDs (filter out nulls)
      const vendorIds = [...new Set(docsData.map(doc => doc.vendor_id).filter(Boolean))];
      
      // Batch fetch all vendors at once (OPTIMIZACIÓN: Una sola query en lugar de N queries)
      let vendorsMap = new Map();
      if (vendorIds.length > 0) {
        const { data: vendorsData } = await supabase
          .from("vendors")
          .select("id, default_account_ref, default_class_ref")
          .in("id", vendorIds);

        vendorsData?.forEach(vendor => {
          vendorsMap.set(vendor.id, vendor);
        });
      }

      // Apply vendor data and defaults in memory (OPTIMIZACIÓN: Sin queries adicionales)
      const invoicesWithVendors = docsData.map((doc) => {
        let invoiceData: PendingInvoice = { 
          ...doc,
          // IMPORTANTE: Usar los valores ya guardados en el documento primero
          default_account_ref: doc.default_account_ref || undefined,
          default_class_ref: doc.default_class_ref || undefined,
          has_vendor_default: false
        };
        
        // Si no hay cuenta en el documento, usar del vendor
        if (!invoiceData.default_account_ref && doc.vendor_id && vendorsMap.has(doc.vendor_id)) {
          const vendorData = vendorsMap.get(doc.vendor_id);
          invoiceData.default_account_ref = vendorData.default_account_ref;
          invoiceData.default_class_ref = vendorData.default_class_ref;
        }

        // Si tampoco hay en vendor, aplicar vendor defaults
        const vendorDefault = vendorDefaults.get(doc.supplier_name);
        if (vendorDefault) {
          const hasDefaultApplied = !invoiceData.default_account_ref || !invoiceData.uses_tax;
          
          if (!invoiceData.default_account_ref && vendorDefault.default_account_ref) {
            invoiceData.default_account_ref = vendorDefault.default_account_ref;
            invoiceData.has_vendor_default = true;
          }
          if (invoiceData.uses_tax === null || invoiceData.uses_tax === undefined) {
            invoiceData.uses_tax = vendorDefault.default_uses_tax;
          }
        }
        
        return invoiceData;
      });

      setInvoices(invoicesWithVendors);
      setFilteredInvoices(invoicesWithVendors);
    } catch (error: any) {
      console.error("Error fetching pending invoices:", error);
      toast.error("Error al cargar facturas pendientes");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      // OPTIMIZACIÓN: Cargar todo en paralelo en lugar de secuencial
      await Promise.all([
        fetchVendorDefaults(),
        fetchQBOAccounts(),
      ]);
      // Fetch invoices después de tener los defaults para aplicarlos correctamente
      await fetchPendingInvoices();
    };
    loadData();

    // Suscripción realtime para actualizaciones automáticas
    if (!activeOrganization) return;

    const channel = supabase
      .channel('pending_invoices_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'processed_documents',
          filter: `organization_id=eq.${activeOrganization}`
        },
        (payload) => {
          console.log('📡 Realtime: Documento actualizado', payload);
          fetchPendingInvoices();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'vendor_defaults',
          filter: `organization_id=eq.${activeOrganization}`
        },
        (payload) => {
          console.log('📡 Realtime: Vendor default actualizado', payload);
          fetchVendorDefaults();
          fetchPendingInvoices();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'vendor_classification_rules',
          filter: `organization_id=eq.${activeOrganization}`
        },
        (payload) => {
          console.log('📡 Realtime: Regla de clasificación actualizada', payload);
          fetchPendingInvoices();
        }
      )
      .subscribe((status) => {
        console.log('📡 Realtime subscription status:', status);
      });

    return () => {
      console.log('📡 Cerrando suscripción realtime');
      supabase.removeChannel(channel);
    };
  }, [activeOrganization]);

  // OPTIMIZACIÓN: Memoizar el mapa de accounts para búsquedas rápidas
  const accountsMap = useMemo(() => {
    const map = new Map();
    qboAccounts.forEach(acc => map.set(acc.id, acc));
    return map;
  }, [qboAccounts]);

  // OPTIMIZACIÓN: Memoizar map de cuentas por código para búsquedas rápidas
  const accountsByCode = useMemo(() => {
    const map = new Map<string, string>(); // código -> id
    qboAccounts.forEach(account => {
      // Indexar por número de cuenta
      if (account.accountNumber) {
        map.set(account.accountNumber, account.id);
        map.set(account.accountNumber.split(' ')[0], account.id); // "6124-01" sin descripción
      }
      // Indexar también por el código al inicio del nombre
      const match = account.name.match(/^(\d+[\-\d]*)/);
      if (match) {
        map.set(match[1], account.id);
      }
    });
    return map;
  }, [qboAccounts]);

  // Helper para obtener el ID de cuenta desde el código
  const getAccountIdFromCode = (accountCode: string | undefined): string => {
    if (!accountCode) {
      console.log('🔍 getAccountIdFromCode: No hay código de cuenta');
      return "";
    }
    
    console.log('🔍 Buscando cuenta para código:', accountCode);
    
    // Extraer solo el código numérico (ej: "6124-01 Nombre" -> "6124-01")
    const cleanCode = accountCode.split(' ')[0].trim();
    console.log('   Código limpio:', cleanCode);
    
    // Buscar en el map
    const accountId = accountsByCode.get(cleanCode);
    if (accountId) {
      console.log('   ✅ Encontrado directo - ID:', accountId);
      return accountId;
    }
    
    // Si no encontró directo, buscar sin el sufijo (ej: "6124-01" -> "6124")
    if (cleanCode.includes('-')) {
      const baseCode = cleanCode.split('-')[0];
      const fallbackId = accountsByCode.get(baseCode);
      if (fallbackId) {
        console.log('   ✅ Encontrado sin sufijo - Base:', baseCode, 'ID:', fallbackId);
        return fallbackId;
      }
    }
    
    console.warn('   ❌ No se encontró cuenta para código:', cleanCode);
    console.log('   📋 Códigos disponibles:', Array.from(accountsByCode.keys()).slice(0, 10));
    return "";
  };

  useEffect(() => {
    // Aplicar todos los filtros combinados
    let filtered = [...invoices];

    // Filtro por número de documento
    if (filterDocNumber.trim()) {
      const searchLower = filterDocNumber.toLowerCase();
      filtered = filtered.filter((inv) => 
        inv.doc_number.toLowerCase().includes(searchLower)
      );
    }

    // Filtro por proveedor
    if (filterSupplier.trim()) {
      const searchLower = filterSupplier.toLowerCase();
      filtered = filtered.filter((inv) => 
        inv.supplier_name.toLowerCase().includes(searchLower) ||
        (inv.supplier_tax_id && inv.supplier_tax_id.toLowerCase().includes(searchLower))
      );
    }

    // Filtro por rango de fechas
    if (dateRange?.from) {
      filtered = filtered.filter((inv) => {
        const invoiceDate = new Date(inv.issue_date);
        const fromDate = new Date(dateRange.from!);
        fromDate.setHours(0, 0, 0, 0);
        
        if (!dateRange.to) {
          // Solo fecha desde
          return invoiceDate >= fromDate;
        }
        
        // Rango completo
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

    // Búsqueda general (searchTerm) - se aplica sobre los filtros anteriores
    if (searchTerm.trim()) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter((inv) => {
        // Buscar por número de documento
        if (inv.doc_number.toLowerCase().includes(searchLower)) return true;
        
        // Buscar por nombre de proveedor
        if (inv.supplier_name.toLowerCase().includes(searchLower)) return true;
        
        // Buscar por cuenta contable
        if (inv.default_account_ref && inv.default_account_ref.toLowerCase().includes(searchLower)) return true;
        
        // Buscar en la descripción de la cuenta
        if (inv.default_account_ref && accountsMap.has(inv.default_account_ref)) {
          const account = accountsMap.get(inv.default_account_ref);
          if (account.name.toLowerCase().includes(searchLower)) return true;
          if (account.accountNumber && account.accountNumber.toLowerCase().includes(searchLower)) return true;
        }
        
        return false;
      });
    }

    setFilteredInvoices(filtered);
  }, [searchTerm, invoices, accountsMap, filterDocNumber, filterSupplier, dateRange, filterQBStatus]);

  // Función para limpiar todos los filtros
  const clearAllFilters = () => {
    setFilterDocNumber("");
    setFilterSupplier("");
    setDateRange(undefined);
    setFilterQBStatus("all");
    setSearchTerm("");
  };

  // Verificar si hay filtros activos
  const hasActiveFilters = filterDocNumber || filterSupplier || dateRange?.from || filterQBStatus !== "all" || searchTerm;

  const saveVendorDefault = async (
    vendorName: string,
    accountRef: string | null,
    usesTax: boolean
  ) => {
    if (!activeOrganization) return;

    try {
      // 1. Guardar en vendor_defaults
      const { data, error } = await supabase
        .from("vendor_defaults")
        .upsert(
          {
            organization_id: activeOrganization,
            vendor_name: vendorName,
            default_account_ref: accountRef,
            default_uses_tax: usesTax,
          },
          { onConflict: "organization_id,vendor_name" }
        )
        .select()
        .single();

      if (error) throw error;

      // 2. Crear/actualizar regla de clasificación para futuras facturas
      if (accountRef) {
        const accountInfo = qboAccounts.find(acc => 
          `${acc.accountNumber} - ${acc.name}` === accountRef || 
          acc.accountNumber === accountRef
        );
        
        const { error: ruleError } = await supabase
          .from("vendor_classification_rules")
          .upsert(
            {
              organization_id: activeOrganization,
              vendor_name: vendorName,
              account_code: accountInfo?.accountNumber || accountRef,
              account_description: accountInfo?.name || "Cuenta configurada desde Log Pendientes",
              is_active: true,
            },
            { onConflict: "organization_id,vendor_name" }
          );

        if (ruleError) {
          console.error("Error creating classification rule:", ruleError);
        } else {
          console.log(`✓ Regla de clasificación creada para ${vendorName}: ${accountRef}`);
        }
      }

      // 3. Update local cache
      if (data) {
        setVendorDefaults((prev) => {
          const newMap = new Map(prev);
          newMap.set(vendorName, data);
          return newMap;
        });
      }
    } catch (error: any) {
      console.error("Error saving vendor default:", error);
    }
  };

  const handleUpdateInvoice = async (
    id: string,
    field: string,
    value: string | boolean
  ) => {
    try {
      const invoice = invoices.find((inv) => inv.id === id);
      if (!invoice) return;

      console.log('💾 Guardando campo:', field, 'valor:', value, 'para factura:', id);

      // Si estamos actualizando default_account_ref, convertir el ID a código
      let valueToSave = value;
      if (field === "default_account_ref" && typeof value === "string") {
        // Buscar la cuenta por ID para obtener su código
        const account = qboAccounts.find(acc => acc.id === value);
        if (account) {
          // Guardar el código completo con descripción
          valueToSave = account.accountNumber 
            ? `${account.accountNumber} ${account.name}` 
            : account.name;
          console.log(`✓ Convertido ID ${value} a código: ${valueToSave}`);
        } else {
          console.warn(`⚠️ No se encontró la cuenta con ID: ${value}`);
        }
      }

      // CRÍTICO: Actualizar processed_documents SIEMPRE que cambie un campo
      const { error: docUpdateError } = await supabase
        .from("processed_documents")
        .update({ [field]: valueToSave })
        .eq("id", id);

      if (docUpdateError) {
        console.error('❌ Error actualizando processed_documents:', docUpdateError);
        throw docUpdateError;
      }

      console.log('✅ Campo actualizado en processed_documents');

      // If updating account or class, also update the vendor record
      if (field === "default_account_ref" || field === "default_class_ref") {
        if (invoice.vendor_id) {
          const { error } = await supabase
            .from("vendors")
            .update({ [field]: valueToSave })
            .eq("id", invoice.vendor_id);

          if (error) {
            console.error('⚠️ Error actualizando vendor (no crítico):', error);
          }
        }

        // Save as vendor default if updating account
        if (field === "default_account_ref") {
          await saveVendorDefault(
            invoice.supplier_name,
            valueToSave as string,
            invoice.uses_tax ?? true
          );
          toast.success(`✓ Configuración guardada para ${invoice.supplier_name}. Se aplicará a futuras facturas.`);
          
          // AUTO-PUBLICAR: Si se asignó una cuenta contable válida, publicar automáticamente
          if (valueToSave && typeof valueToSave === 'string' && valueToSave.trim() !== '') {
            const publishToast = toast.loading("Publicando factura automáticamente a QuickBooks...");
            
            // Marcar como "publishing" temporalmente
            setInvoices((prev) =>
              prev.map((inv) => (inv.id === id ? { ...inv, [field]: valueToSave, _isPublishing: true } : inv))
            );
            
            try {
              const { data, error: publishError } = await supabase.functions.invoke(
                "publish-to-quickbooks",
                {
                  body: { organization_id: activeOrganization, document_ids: [id] },
                }
              );

              if (publishError) throw publishError;

              toast.dismiss(publishToast);
              toast.success("✓ Factura publicada exitosamente a QuickBooks");
              
              // Refrescar la lista para que desaparezca de pendientes
              await fetchPendingInvoices();
              return; // Exit early since we refreshed the list
            } catch (publishError: any) {
              console.error("Error publishing invoice:", publishError);
              toast.dismiss(publishToast);
              toast.error("Cuenta guardada pero error al publicar: " + (publishError.message || "Error desconocido"));
              
              // Quitar el estado de publishing
              setInvoices((prev) =>
                prev.map((inv) => (inv.id === id ? { ...inv, _isPublishing: false } : inv))
              );
            }
          }
        }
      }

      // If updating uses_tax, also save as vendor default
      if (field === "uses_tax") {
        await saveVendorDefault(
          invoice.supplier_name,
          invoice.default_account_ref || null,
          value as boolean
        );
      }

      // Update local state
      setInvoices((prev) =>
        prev.map((inv) => (inv.id === id ? { ...inv, [field]: valueToSave } : inv))
      );
      
      if (field !== "default_account_ref") {
        toast.success("Actualizado correctamente");
      }
    } catch (error: any) {
      console.error("Error updating invoice:", error);
      toast.error(`Error al actualizar: ${error.message || 'Error desconocido'}`);
    }
  };

  const handleDeleteInvoice = async (id: string) => {
    try {
      const { error } = await supabase
        .from("processed_documents")
        .delete()
        .eq("id", id);

      if (error) throw error;

      setInvoices((prev) => prev.filter((inv) => inv.id !== id));
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
      await fetchPendingInvoices();
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

    setIsPublishing(true);
    try {
      const documentIds = filteredInvoices.map((inv) => inv.id);
      const { data, error } = await supabase.functions.invoke(
        "publish-to-quickbooks",
        {
          body: { organization_id: activeOrganization, document_ids: documentIds },
        }
      );

      if (error) throw error;

      toast.success(`${filteredInvoices.length} facturas publicadas correctamente`);
      await fetchPendingInvoices();
      setShowPublishDialog(false);
    } catch (error: any) {
      console.error("Error publishing all:", error);
      toast.error(error.message || "Error al publicar facturas");
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
      const loadingToast = toast.loading("Abriendo visor PDF...");
      
      let pdfPath = invoice.pdf_attachment_url;
      
      // Extraer el path relativo del storage desde cualquier formato de URL
      if (pdfPath.startsWith('http')) {
        const url = new URL(pdfPath);
        const pathMatch = url.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/company-documents\/(.+)/);
        if (pathMatch) {
          pdfPath = pathMatch[1];
          console.log("🔄 Extraído path desde URL completa:", pdfPath);
        }
      }
      
      // Remover prefijos si los tiene
      const prefixesToRemove = [
        'company-documents/',
        '/company-documents/'
      ];
      
      for (const prefix of prefixesToRemove) {
        if (pdfPath.startsWith(prefix)) {
          pdfPath = pdfPath.replace(prefix, '');
          break;
        }
      }
      
      console.log("📂 Path final para storage:", pdfPath);
      console.log("🔐 Generando URL temporal para bucket privado...");
      
      // Limpiar URL anterior si existe
      if (currentPdfUrl) {
        setCurrentPdfUrl(null);
      }
      
      // IMPORTANTE: El bucket company-documents es PRIVADO
      // Siempre crear signed URL temporal (válida por 5 minutos)
      const { data: signedUrlData, error } = await supabase.storage
        .from('company-documents')
        .createSignedUrl(pdfPath, 300); // 300 segundos = 5 minutos

      if (error) {
        console.error("❌ Error de storage:", error);
        throw new Error(`Error al acceder al archivo: ${error.message}`);
      }

      if (!signedUrlData?.signedUrl) {
        throw new Error("No se pudo generar la URL temporal");
      }

      console.log("✅ URL temporal generada para bucket privado");
      
      // Usar la signed URL
      setCurrentPdfUrl(signedUrlData.signedUrl);
      setCurrentPdfName(`Factura ${invoice.doc_number}`);
      setPdfViewerOpen(true);
      
      toast.dismiss(loadingToast);
      toast.success("Visor de PDF abierto");
      console.log("✅ PDF abierto con signed URL");
      
    } catch (error: any) {
      toast.dismiss();
      console.error("❌ Error completo al cargar PDF:", error);
      
      let errorMessage = "Error al cargar el PDF";
      if (error.message.includes("not found") || error.message.includes("Object not found")) {
        errorMessage = "El archivo PDF no existe en el almacenamiento";
      } else if (error.message.includes("Bucket")) {
        errorMessage = "Bucket de almacenamiento no encontrado. Contacta al administrador.";
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast.error(errorMessage, { duration: 5000 });
    }
  };

  const handleClosePdfViewer = () => {
    setPdfViewerOpen(false);
    // Limpiar la URL cuando se cierra el modal
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
          await fetchPendingInvoices();
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
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Número</TableHead>
                    <TableHead>Proveedor</TableHead>
                    <TableHead>Monto</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Cuenta Contable</TableHead>
                    <TableHead>Centro de Costo</TableHead>
                    <TableHead>Usa IVA</TableHead>
                    <TableHead className="text-center">Estado QB</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                  {/* Fila de filtros */}
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
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
                      {/* Sin filtro para monto */}
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
                                  {format(dateRange.from, "dd/MM/yyyy", { locale: es })} -{" "}
                                  {format(dateRange.to, "dd/MM/yyyy", { locale: es })}
                                </>
                              ) : (
                                format(dateRange.from, "dd/MM/yyyy", { locale: es })
                              )
                            ) : (
                              <span>Rango de fecha</span>
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
                    <TableHead className="py-2">
                      {/* Sin filtro para Usa IVA */}
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
                  {filteredInvoices.map((invoice) => (
                    <TableRow 
                      key={invoice.id}
                      className="hover:bg-muted/50"
                    >
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
                                  console.log('🔄 Cuenta seleccionada - ID:', value);
                                  console.log('📋 Cuenta actual antes de cambio:', invoice.default_account_ref);
                                  handleUpdateInvoice(
                                    invoice.id,
                                    "default_account_ref",
                                    value
                                  );
                                }}
                                disabled={loadingAccounts}
                                className="w-[280px]"
                                placeholder="Seleccionar cuenta"
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
                          className="w-32"
                        />
                      </TableCell>
                      <TableCell>
                        <Checkbox
                          checked={invoice.uses_tax ?? true}
                          onCheckedChange={(checked) =>
                            handleUpdateInvoice(
                              invoice.id,
                              "uses_tax",
                              checked as boolean
                            )
                          }
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
                  ))}
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
          <div className="flex items-center justify-between p-4 border-b bg-muted/50">
            <DialogTitle className="text-lg font-semibold">{currentPdfName}</DialogTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClosePdfViewer}
              className="h-8 w-8 p-0"
            >
              ✕
            </Button>
          </div>
          <div className="flex-1 overflow-hidden">
            {currentPdfUrl && (
              <iframe
                src={currentPdfUrl}
                className="w-full h-full border-0"
                title={currentPdfName}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default InvoicesPendingLog;
