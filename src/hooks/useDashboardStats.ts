import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";

interface DashboardStats {
  processed: number;
  review: number;
  pending: number;
  total: number;
  errors: number;
  published: number;
  pendingConfig: number;
}

interface ConnectionStatus {
  gmail: boolean;
  quickbooks: boolean;
  outlook: boolean;
}

export const useDashboardStats = (organizationId: string | null) => {
  const queryClient = useQueryClient();

  // Suscripción realtime para actualizar stats cuando cambian documentos
  useEffect(() => {
    if (!organizationId) return;

    const channel = supabase
      .channel(`dashboard-stats-${organizationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'processed_documents',
          filter: `organization_id=eq.${organizationId}`
        },
        (payload) => {
          console.log('📊 Realtime: documento actualizado, refrescando stats...', payload.eventType);
          // Invalidar queries para refrescar stats
          queryClient.invalidateQueries({ queryKey: ["dashboard-stats", organizationId] });
          queryClient.invalidateQueries({ queryKey: ["recent-documents", organizationId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, queryClient]);

  return useQuery({
    queryKey: ["dashboard-stats", organizationId],
    queryFn: async (): Promise<DashboardStats> => {
      if (!organizationId) {
        return { processed: 0, review: 0, pending: 0, total: 0, errors: 0, published: 0, pendingConfig: 0 };
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [docsResult, pendingConfigResult] = await Promise.all([
        supabase
          .from("processed_documents")
          .select("status, created_at, processed_at")
          .eq("organization_id", organizationId)
          .gte("created_at", sevenDaysAgo.toISOString()),
        supabase
          .from("processed_documents")
          .select("id")
          .eq("organization_id", organizationId)
          .in("status", ["pending", "pending_config"])
          .is("qbo_entity_id", null)
      ]);

      if (docsResult.error) throw docsResult.error;

      const data = docsResult.data || [];
      const processedToday = data.filter(
        (doc) => doc.processed_at && new Date(doc.processed_at) >= today && 
        (doc.status === "processed" || doc.status === "published")
      );

      const pendingConfigCount = !pendingConfigResult.error && pendingConfigResult.data 
        ? pendingConfigResult.data.length 
        : 0;

      return {
        processed: processedToday.length,
        review: data.filter((d) => d.status === "review").length,
        pending: data.filter((d) => d.status === "pending").length,
        total: data.length,
        errors: data.filter((d) => d.status === "error").length,
        published: data.filter((d) => d.status === "published").length,
        pendingConfig: pendingConfigCount,
      };
    },
    enabled: !!organizationId,
    staleTime: 30 * 1000, // 30 segundos para stats
    gcTime: 5 * 60 * 1000, // 5 minutos de cache
  });
};

export const useOrganizationConnections = (organizationId: string | null) => {
  return useQuery({
    queryKey: ["organization-connections", organizationId],
    queryFn: async (): Promise<ConnectionStatus> => {
      if (!organizationId) {
        return { gmail: false, quickbooks: false, outlook: false };
      }

      const { data, error } = await supabase
        .from("integration_accounts")
        .select("service_type")
        .eq("organization_id", organizationId)
        .eq("is_active", true);

      if (error) throw error;

      const accounts = data || [];
      return {
        gmail: accounts.some(a => a.service_type === "gmail"),
        quickbooks: accounts.some(a => a.service_type === "quickbooks"),
        outlook: accounts.some(a => a.service_type === "outlook"),
      };
    },
    enabled: !!organizationId,
    staleTime: 2 * 60 * 1000, // 2 minutos para conexiones
    gcTime: 10 * 60 * 1000, // 10 minutos de cache
  });
};
