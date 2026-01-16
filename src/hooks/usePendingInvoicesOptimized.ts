import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCallback } from "react";

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

const normalizeVendorName = (name: string): string => {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
};

// Fetch optimizado - SOLO documentos, sin vendor_defaults (se obtiene del hook separado)
const fetchPendingInvoicesOptimized = async (organizationId: string): Promise<PendingInvoice[]> => {
  // Query única y simple - documentos pendientes (incluye review, pending, pending_config)
  const { data: docsData, error: docsError } = await supabase
    .from("processed_documents")
    .select("id, doc_number, supplier_name, supplier_tax_id, total_amount, currency, created_at, vendor_id, default_account_ref, default_class_ref, uses_tax, pdf_attachment_url, issue_date, status, qbo_entity_id")
    .eq("organization_id", organizationId)
    .in("status", ["pending", "pending_config", "review"])
    .is("qbo_entity_id", null)
    .order("created_at", { ascending: false })
    .limit(100);

  if (docsError) throw docsError;
  
  return docsData || [];
};

// Arreglo vacío memoizado para evitar re-renders infinitos
const EMPTY_INVOICES: PendingInvoice[] = [];

export const usePendingInvoicesOptimized = () => {
  const { activeOrganization, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["pending-invoices-optimized", activeOrganization],
    queryFn: () => fetchPendingInvoicesOptimized(activeOrganization!),
    enabled: !!activeOrganization && !authLoading,
    staleTime: 60 * 1000, // 60 segundos - reducir refetch innecesarios
    gcTime: 5 * 60 * 1000, // 5 minutos en cache
    refetchOnWindowFocus: false,
    refetchOnMount: false, // No refetch innecesario al montar
    retry: 1, // Solo 1 retry para fallos
  });

  const removeInvoice = useCallback((id: string) => {
    queryClient.setQueryData<PendingInvoice[]>(
      ["pending-invoices-optimized", activeOrganization],
      (old) => old?.filter(inv => inv.id !== id) || EMPTY_INVOICES
    );
  }, [queryClient, activeOrganization]);

  const removeInvoicesByVendor = useCallback((supplierName: string) => {
    queryClient.setQueryData<PendingInvoice[]>(
      ["pending-invoices-optimized", activeOrganization],
      (old) => old?.filter(inv => inv.supplier_name !== supplierName) || EMPTY_INVOICES
    );
  }, [queryClient, activeOrganization]);

  // NUEVO: Actualizar una factura en cache inmediatamente (optimistic update)
  const updateInvoiceOptimistic = useCallback((id: string, updates: Partial<PendingInvoice>) => {
    queryClient.setQueryData<PendingInvoice[]>(
      ["pending-invoices-optimized", activeOrganization],
      (old) => old?.map(inv => inv.id === id ? { ...inv, ...updates } : inv) || EMPTY_INVOICES
    );
  }, [queryClient, activeOrganization]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["pending-invoices-optimized", activeOrganization] });
  }, [queryClient, activeOrganization]);

  // Memoizar el resultado para evitar nuevas referencias
  const invoices = query.data ?? EMPTY_INVOICES;

  // isLoading solo si auth está cargando O query está cargando por primera vez
  const isLoading = authLoading || (query.isLoading && !query.isFetched);

  return {
    invoices,
    isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    removeInvoice,
    removeInvoicesByVendor,
    updateInvoiceOptimistic,
    invalidate,
    isFetched: query.isFetched,
  };
};

// Hook para vendor defaults (separado y cacheado)
export const useVendorDefaults = () => {
  const { activeOrganization, isLoading: authLoading } = useAuth();

  return useQuery({
    queryKey: ["vendor-defaults", activeOrganization],
    queryFn: async () => {
      if (!activeOrganization) return new Map<string, VendorDefault>();
      
      const { data, error } = await supabase
        .from("vendor_defaults")
        .select("id, vendor_name, default_account_ref, default_uses_tax")
        .eq("organization_id", activeOrganization);

      if (error) throw error;

      const defaultsMap = new Map<string, VendorDefault>();
      data?.forEach((def) => {
        defaultsMap.set(def.vendor_name, def as VendorDefault);
      });
      return defaultsMap;
    },
    enabled: !!activeOrganization && !authLoading,
    staleTime: 2 * 60 * 1000, // 2 minutos
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
};
