import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OrgHealth {
  organization_id: string;
  organization_name: string;
  has_integration: boolean;
  service_type: string | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  backlog_skip_count: number;
  imported_today: number;
  imported_7d: number;
  imported_month: number;
  pending_config: number;
  errors_count: number;
  recent_error_codes: string[];
  health: "ok" | "warning" | "critical";
}

export function useImportHealth(opts: { allOrgs?: boolean; organizationId?: string | null }) {
  return useQuery({
    queryKey: ["import-health", opts.allOrgs ? "all" : opts.organizationId],
    queryFn: async (): Promise<{ orgs: OrgHealth[]; generated_at: string }> => {
      const body: Record<string, unknown> = {};
      if (!opts.allOrgs && opts.organizationId) body.organization_id = opts.organizationId;
      const { data, error } = await supabase.functions.invoke("import-health-summary", { body });
      if (error) throw error;
      return data;
    },
    enabled: opts.allOrgs || !!opts.organizationId,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}
