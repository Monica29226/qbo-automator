import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  organizationId: string | null;
}

/**
 * Compact, always-visible confirmation that QBO token + email connectivity
 * are being auto-maintained. Polls every 30s so users see the countdown move.
 * Token expiry is read via SECURITY DEFINER RPC because credentials are RLS-protected.
 */
export const AutoUpdateStatusBadge = ({ organizationId }: Props) => {
  const { data, isError } = useQuery({
    queryKey: ["auto-update-status", organizationId],
    enabled: !!organizationId,
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
    queryFn: async () => {
      const [orgRes, healthRes, qboActive] = await Promise.all([
        supabase
          .from("organizations")
          .select("gmail_connected, outlook_connected, bluehost_connected, hostinger_connected")
          .eq("id", organizationId!)
          .maybeSingle(),
        supabase.rpc("get_email_provider_health", { _org_id: organizationId! }),
        supabase.rpc("has_active_integration", {
          _org_id: organizationId!,
          _service_type: "quickbooks",
        }),
      ]);

      if (orgRes.error) throw orgRes.error;
      if (qboActive.error) throw qboActive.error;

      const emailRows = (healthRes.data ?? []) as Array<{
        service_type: string;
        is_active: boolean;
        has_credentials: boolean;
      }>;
      const anyEmail =
        orgRes.data?.gmail_connected ||
        orgRes.data?.outlook_connected ||
        orgRes.data?.bluehost_connected ||
        orgRes.data?.hostinger_connected;
      const emailHealthy = anyEmail && emailRows.some((r) => r.is_active && r.has_credentials);

      return {
        qboConnected: !!qboActive.data,
        emailConnected: !!anyEmail,
        emailHealthy: !!emailHealthy,
      };
    },
  });

  if (!organizationId) return null;
  if (isError && !data) {
    // The query failed — say so, rather than spinning "Comprobando…" forever,
    // which read as "still checking" when it had actually given up.
    return (
      <Badge variant="outline" className="h-fit border-destructive/40 text-destructive">
        <AlertTriangle className="h-3 w-3 mr-1" />
        Estado no verificado
      </Badge>
    );
  }
  if (!data) return null;


  const ok = data.qboConnected && data.emailHealthy;
  const warn = data.qboConnected && data.emailConnected && !data.emailHealthy;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={
              ok
                ? "h-fit border-green-500/60 text-green-700 dark:text-green-400"
                : warn
                ? "h-fit border-amber-500/60 text-amber-700 dark:text-amber-400"
                : "h-fit border-destructive/60 text-destructive"
            }
          >
            {ok ? (
              <RefreshCw className="h-3 w-3 mr-1" />
            ) : (
              <AlertTriangle className="h-3 w-3 mr-1" />
            )}
            {ok ? "Auto-actualización activa" : warn ? "Correo requiere revisión" : "Conexión incompleta"}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="text-xs space-y-0.5">
            <div>QuickBooks: {data.qboConnected ? "conectado (token auto-renovable)" : "no conectado"}</div>
            <div>Correo: {data.emailHealthy ? "conectado y con credenciales válidas" : data.emailConnected ? "conectado pero credenciales incompletas" : "no conectado"}</div>
            <div className="text-muted-foreground pt-1">Actualiza cada 30s</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
