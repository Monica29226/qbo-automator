import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

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

// Fetch optimizado - una sola query combinada
const fetchPendingInvoicesOptimized = async (organizationId: string): Promise<PendingInvoice[]> => {
  // Query 1: Obtener facturas pendientes (la query principal)
  const { data: docsData, error: docsError } = await supabase
    .from("processed_documents")
    .select("id, doc_number, supplier_name, supplier_tax_id, total_amount, currency, created_at, vendor_id, default_account_ref, default_class_ref, uses_tax, pdf_attachment_url, xml_data, issue_date, status, qbo_entity_id")
    .eq("organization_id", organizationId)
    .in("status", ["pending", "pending_config"])
    .is("qbo_entity_id", null)
    .order("created_at", { ascending: false })
    .limit(200); // Reducido de 500 a 200 para velocidad

  if (docsError) throw docsError;
  if (!docsData || docsData.length === 0) return [];

  // Query 2: Vendor defaults (para aplicar valores predeterminados)
  const { data: vendorDefaults } = await supabase
    .from("vendor_defaults")
    .select("vendor_name, default_account_ref, default_uses_tax")
    .eq("organization_id", organizationId)
    .not("default_account_ref", "is", null);

  // Crear mapa de defaults
  const defaultsMap = new Map<string, { account: string; usesTax: boolean }>();
  vendorDefaults?.forEach(v => {
    if (v.default_account_ref) {
      defaultsMap.set(normalizeVendorName(v.vendor_name), {
        account: v.default_account_ref,
        usesTax: v.default_uses_tax ?? true
      });
    }
  });

  // Aplicar defaults a las facturas
  return docsData.map(doc => {
    const normalizedName = normalizeVendorName(doc.supplier_name);
    const vendorDefault = defaultsMap.get(normalizedName);
    
    return {
      ...doc,
      default_account_ref: doc.default_account_ref || vendorDefault?.account,
      uses_tax: doc.uses_tax ?? vendorDefault?.usesTax ?? true,
      has_vendor_default: !!vendorDefault && !doc.default_account_ref
    };
  });
};

export const usePendingInvoicesOptimized = () => {
  const { activeOrganization } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["pending-invoices-optimized", activeOrganization],
    queryFn: () => fetchPendingInvoicesOptimized(activeOrganization!),
    enabled: !!activeOrganization,
    staleTime: 30 * 1000, // 30 segundos - datos recientes no se refetch
    gcTime: 5 * 60 * 1000, // 5 minutos en cache
    refetchOnWindowFocus: false,
  });

  const removeInvoice = (id: string) => {
    queryClient.setQueryData<PendingInvoice[]>(
      ["pending-invoices-optimized", activeOrganization],
      (old) => old?.filter(inv => inv.id !== id) || []
    );
  };

  const removeInvoicesByVendor = (supplierName: string) => {
    queryClient.setQueryData<PendingInvoice[]>(
      ["pending-invoices-optimized", activeOrganization],
      (old) => old?.filter(inv => inv.supplier_name !== supplierName) || []
    );
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["pending-invoices-optimized", activeOrganization] });
  };

  return {
    invoices: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    removeInvoice,
    removeInvoicesByVendor,
    invalidate,
  };
};

// Hook para vendor defaults (separado y cacheado)
export const useVendorDefaults = () => {
  const { activeOrganization } = useAuth();

  return useQuery({
    queryKey: ["vendor-defaults", activeOrganization],
    queryFn: async () => {
      if (!activeOrganization) return new Map<string, VendorDefault>();
      
      const { data, error } = await supabase
        .from("vendor_defaults")
        .select("*")
        .eq("organization_id", activeOrganization);

      if (error) throw error;

      const defaultsMap = new Map<string, VendorDefault>();
      data?.forEach((def) => {
        defaultsMap.set(def.vendor_name, def);
      });
      return defaultsMap;
    },
    enabled: !!activeOrganization,
    staleTime: 2 * 60 * 1000, // 2 minutos
    gcTime: 10 * 60 * 1000,
  });
};
