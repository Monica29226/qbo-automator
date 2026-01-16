import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface RecentDocument {
  id: string;
  doc_number: string;
  supplier_name: string;
  total_amount: number;
  currency: string;
  status: string;
  issue_date: string;
  created_at: string;
  error_message: string | null;
  qbo_entity_id: string | null;
}

export const useRecentDocuments = (organizationId: string | null, limit = 10) => {
  return useQuery({
    queryKey: ["recent-documents", organizationId, limit],
    queryFn: async (): Promise<RecentDocument[]> => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from("processed_documents")
        .select(`
          id,
          doc_number,
          supplier_name,
          total_amount,
          currency,
          status,
          issue_date,
          created_at,
          error_message,
          qbo_entity_id
        `)
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    },
    enabled: !!organizationId,
    staleTime: 30 * 1000, // 30 segundos
  });
};

export const usePendingDocumentsCount = (organizationId: string | null) => {
  return useQuery({
    queryKey: ["pending-documents-count", organizationId],
    queryFn: async (): Promise<number> => {
      if (!organizationId) return 0;

      const { count, error } = await supabase
        .from("processed_documents")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .in("status", ["pending", "pending_config", "review"])
        .is("qbo_entity_id", null);

      if (error) throw error;
      return count || 0;
    },
    enabled: !!organizationId,
    staleTime: 30 * 1000,
  });
};
