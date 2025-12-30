import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface VendorDefault {
  id: string;
  vendor_name: string;
  default_account_ref: string | null;
  default_uses_tax: boolean | null;
  created_at: string;
  updated_at: string;
}

export const useVendorDefaultsData = (activeOrganization: string | null) => {
  const queryClient = useQueryClient();

  const { data: vendorDefaults = [], isLoading } = useQuery({
    queryKey: ["vendor_defaults", activeOrganization],
    queryFn: async () => {
      if (!activeOrganization) return [];

      const { data, error } = await supabase
        .from("vendor_defaults")
        .select("*")
        .eq("organization_id", activeOrganization)
        .order("vendor_name");

      if (error) throw error;
      return data as VendorDefault[];
    },
    enabled: !!activeOrganization,
    staleTime: 3 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["vendor_defaults"] });
  };

  return { vendorDefaults, isLoading, invalidate };
};
