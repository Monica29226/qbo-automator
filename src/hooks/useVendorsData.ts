import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface Vendor {
  id: string;
  vendor_name: string;
  vendor_tax_id: string | null;
  vendor_email: string | null;
  qbo_vendor_ref: string;
  default_account_ref: string;
  tax_treatment: string;
  tax_rate: number;
  is_active: boolean;
}

export const useVendorsData = (activeOrganization: string | null) => {
  const queryClient = useQueryClient();

  const { data: vendors = [], isLoading } = useQuery({
    queryKey: ["vendors", activeOrganization],
    queryFn: async () => {
      if (!activeOrganization) return [];

      const { data, error } = await supabase
        .from("vendors")
        .select("*")
        .eq("organization_id", activeOrganization)
        .order("vendor_name");

      if (error) throw error;
      return data as Vendor[];
    },
    enabled: !!activeOrganization,
    staleTime: 3 * 60 * 1000, // 3 minutos
    gcTime: 10 * 60 * 1000, // 10 minutos
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["vendors"] });
  };

  return { vendors, isLoading, invalidate };
};
