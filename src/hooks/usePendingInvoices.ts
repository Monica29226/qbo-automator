import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export interface PendingInvoice {
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

interface VendorDefault {
  id: string;
  vendor_name: string;
  default_account_ref: string | null;
  default_uses_tax: boolean;
}

// Normalizar nombre de vendor para comparación
const normalizeVendorName = (name: string): string => {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Quitar acentos
    .replace(/[^a-z0-9]/g, "") // Solo alfanuméricos
    .trim();
};

const fetchPendingInvoicesFromAPI = async (
  organizationId: string,
  vendorDefaults: Map<string, VendorDefault>
): Promise<PendingInvoice[]> => {
  // Primero, obtener TODOS los vendors que ya tienen regla configurada
  const [vendorDefaultsResult, vendorRulesResult, vendorsResult] = await Promise.all([
    supabase
      .from("vendor_defaults")
      .select("vendor_name, default_account_ref")
      .eq("organization_id", organizationId)
      .not("default_account_ref", "is", null),
    supabase
      .from("vendor_classification_rules")
      .select("vendor_name, account_code")
      .eq("organization_id", organizationId)
      .eq("is_active", true),
    supabase
      .from("vendors")
      .select("vendor_name, default_account_ref")
      .eq("organization_id", organizationId)
      .not("default_account_ref", "is", null)
  ]);

  // Crear set de vendors con regla (normalizados para comparación)
  const vendorsWithRules = new Set<string>();
  
  vendorDefaultsResult.data?.forEach(v => {
    if (v.default_account_ref) {
      vendorsWithRules.add(normalizeVendorName(v.vendor_name));
    }
  });
  
  vendorRulesResult.data?.forEach(v => {
    if (v.account_code) {
      vendorsWithRules.add(normalizeVendorName(v.vendor_name));
    }
  });
  
  vendorsResult.data?.forEach(v => {
    if (v.default_account_ref) {
      vendorsWithRules.add(normalizeVendorName(v.vendor_name));
    }
  });

  console.log(`📋 Vendors con regla configurada: ${vendorsWithRules.size}`, [...vendorsWithRules]);

  // Fetch documents - SOLO facturas pendientes
  const { data: docsData, error: docsError } = await supabase
    .from("processed_documents")
    .select("*")
    .eq("organization_id", organizationId)
    .in("status", ["pending", "pending_config"])
    .is("qbo_entity_id", null)
    .gte("issue_date", "2025-11-01")
    .order("created_at", { ascending: false })
    .limit(100);

  if (docsError) throw docsError;
  if (!docsData || docsData.length === 0) return [];

  // FILTRAR: Solo mostrar facturas de vendors SIN regla configurada
  const filteredDocs = docsData.filter(doc => {
    const normalizedName = normalizeVendorName(doc.supplier_name);
    const hasRule = vendorsWithRules.has(normalizedName);
    
    if (hasRule) {
      console.log(`⏭️ Ocultando factura de vendor con regla: ${doc.supplier_name} (${doc.doc_number})`);
    }
    
    return !hasRule;
  });

  console.log(`📄 Facturas pendientes: ${docsData.length} total, ${filteredDocs.length} sin regla de vendor`);

  // Get unique vendor IDs from filtered docs
  const vendorIds = [...new Set(filteredDocs.map(doc => doc.vendor_id).filter(Boolean))];
  
  // Batch fetch all vendors
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

  // Apply vendor data and defaults
  return filteredDocs.map((doc) => {
    let invoiceData: PendingInvoice = { 
      ...doc,
      default_account_ref: doc.default_account_ref || undefined,
      default_class_ref: doc.default_class_ref || undefined,
      has_vendor_default: false
    };
    
    if (!invoiceData.default_account_ref && doc.vendor_id && vendorsMap.has(doc.vendor_id)) {
      const vendorData = vendorsMap.get(doc.vendor_id);
      invoiceData.default_account_ref = vendorData.default_account_ref;
      invoiceData.default_class_ref = vendorData.default_class_ref;
    }

    const vendorDefault = vendorDefaults.get(doc.supplier_name);
    if (vendorDefault) {
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
};

export const usePendingInvoices = (vendorDefaults: Map<string, VendorDefault>) => {
  const { activeOrganization } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["pending-invoices", activeOrganization],
    queryFn: () => fetchPendingInvoicesFromAPI(activeOrganization!, vendorDefaults),
    enabled: !!activeOrganization,
    staleTime: 30 * 1000, // 30 segundos
    gcTime: 5 * 60 * 1000, // 5 minutos
    refetchOnWindowFocus: false,
  });

  // Mutation para actualizar factura con optimistic update
  const updateInvoiceMutation = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: any }) => {
      const { error } = await supabase
        .from("processed_documents")
        .update({ [field]: value })
        .eq("id", id);
      
      if (error) throw error;
      return { id, field, value };
    },
    // Optimistic update - actualiza UI ANTES de que termine la request
    onMutate: async ({ id, field, value }) => {
      // Cancelar cualquier refetch pendiente
      await queryClient.cancelQueries({ queryKey: ["pending-invoices", activeOrganization] });

      // Snapshot del estado anterior
      const previousInvoices = queryClient.getQueryData<PendingInvoice[]>(
        ["pending-invoices", activeOrganization]
      );

      // Actualizar cache de forma optimista
      queryClient.setQueryData<PendingInvoice[]>(
        ["pending-invoices", activeOrganization],
        (old) => old?.map(inv => inv.id === id ? { ...inv, [field]: value } : inv)
      );

      return { previousInvoices };
    },
    onError: (err, variables, context) => {
      // Revertir en caso de error
      if (context?.previousInvoices) {
        queryClient.setQueryData(
          ["pending-invoices", activeOrganization],
          context.previousInvoices
        );
      }
      toast.error("Error al actualizar factura");
    },
  });

  // Mutation para eliminar factura
  const deleteInvoiceMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("processed_documents")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
      return id;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["pending-invoices", activeOrganization] });
      const previousInvoices = queryClient.getQueryData<PendingInvoice[]>(
        ["pending-invoices", activeOrganization]
      );

      queryClient.setQueryData<PendingInvoice[]>(
        ["pending-invoices", activeOrganization],
        (old) => old?.filter(inv => inv.id !== id)
      );

      return { previousInvoices };
    },
    onError: (err, id, context) => {
      if (context?.previousInvoices) {
        queryClient.setQueryData(
          ["pending-invoices", activeOrganization],
          context.previousInvoices
        );
      }
      toast.error("Error al eliminar factura");
    },
    onSuccess: () => {
      toast.success("Factura eliminada");
    },
  });

  // Remover facturas publicadas del cache local
  const removePublishedInvoices = (ids: string[]) => {
    queryClient.setQueryData<PendingInvoice[]>(
      ["pending-invoices", activeOrganization],
      (old) => old?.filter(inv => !ids.includes(inv.id))
    );
  };

  return {
    invoices: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    updateInvoice: updateInvoiceMutation.mutate,
    updateInvoiceAsync: updateInvoiceMutation.mutateAsync,
    isUpdating: updateInvoiceMutation.isPending,
    deleteInvoice: deleteInvoiceMutation.mutate,
    isDeleting: deleteInvoiceMutation.isPending,
    removePublishedInvoices,
  };
};
