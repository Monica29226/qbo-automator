import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface SalesInvoice {
  id: string;
  doc_number: string;
  doc_type: string;
  issue_date: string;
  customer_name: string;
  customer_tax_id: string | null;
  total_amount: number;
  currency: string;
  status: string;
  error_message: string | null;
  default_income_account_ref: string | null;
  default_class_ref: string | null;
  qbo_entity_id: string | null;
  created_at: string;
}

export const useSalesInvoices = () => {
  const { activeOrganization } = useAuth();

  const query = useQuery({
    queryKey: ["sales-invoices", activeOrganization],
    queryFn: async () => {
      if (!activeOrganization) return [];

      const { data, error } = await supabase
        .from("sales_invoices")
        .select("*")
        .eq("organization_id", activeOrganization)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as SalesInvoice[];
    },
    enabled: !!activeOrganization,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
  });

  return query;
};