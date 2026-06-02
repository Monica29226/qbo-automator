import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";

export interface PaymentStats {
  pendingCount: number;
  pendingTotalCRC: number;
  pendingTotalUSD: number;
  overdueCount: number;
}

export const usePaymentStats = (organizationId: string | null) => {
  const qc = useQueryClient();

  useEffect(() => {
    if (!organizationId) return;
    const channel = supabase
      .channel(`payment-stats-${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "processed_documents",
          filter: `organization_id=eq.${organizationId}`,
        },
        () => qc.invalidateQueries({ queryKey: ["payment-stats", organizationId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, qc]);

  return useQuery({
    queryKey: ["payment-stats", organizationId],
    queryFn: async (): Promise<PaymentStats> => {
      if (!organizationId) {
        return { pendingCount: 0, pendingTotalCRC: 0, pendingTotalUSD: 0, overdueCount: 0 };
      }
      const { data, error } = await supabase
        .from("processed_documents")
        .select("total_amount, currency, issue_date")
        .eq("organization_id", organizationId)
        .eq("payment_status", "pending_payment");

      if (error) throw error;
      const rows = data || [];
      const now = Date.now();
      let crc = 0;
      let usd = 0;
      let overdue = 0;
      for (const r of rows) {
        const amt = Number(r.total_amount) || 0;
        const cur = (r.currency || "CRC").toUpperCase();
        if (cur === "USD") usd += amt;
        else crc += amt;
        if (r.issue_date) {
          const days = (now - new Date(r.issue_date).getTime()) / (1000 * 60 * 60 * 24);
          if (days > 30) overdue++;
        }
      }
      return {
        pendingCount: rows.length,
        pendingTotalCRC: crc,
        pendingTotalUSD: usd,
        overdueCount: overdue,
      };
    },
    enabled: !!organizationId,
    staleTime: 30 * 1000,
  });
};
