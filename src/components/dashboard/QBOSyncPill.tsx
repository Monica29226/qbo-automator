import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "react-router-dom";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Píldora de estado QuickBooks en la parte superior del sidebar.
 * Verde si conectado y con sync reciente, ámbar si stale, rojo si desconectado.
 */
export function QBOSyncPill() {
  const { activeOrganization } = useAuth();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["qbo-sync-pill", activeOrganization],
    enabled: !!activeOrganization,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
    queryFn: async () => {
      const [{ data: integ, error: integErr }, { data: log }] = await Promise.all([
        supabase
          .from("integration_accounts")
          .select("is_active")
          .eq("organization_id", activeOrganization!)
          .eq("service_type", "quickbooks")
          .eq("is_active", true)
          .maybeSingle(),
        supabase
          .from("sync_logs")
          .select("started_at, status")
          .eq("organization_id", activeOrganization!)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (integErr) throw integErr;
      return {
        connected: !!integ,
        startedAt: log?.started_at ?? null,
      };
    },
  });


  if (isLoading) {
    return (
      <div className="mx-3 mt-3 mb-2 flex items-center gap-2 rounded-lg bg-sidebar-accent/15 px-3 py-2 text-xs text-sidebar-foreground/80">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Comprobando…
      </div>
    );
  }

  const connected = data?.connected ?? false;
  const startedAt = data?.startedAt ? new Date(data.startedAt) : null;
  const ageMin = startedAt ? Math.round((Date.now() - startedAt.getTime()) / 60000) : null;
  const fresh = ageMin !== null && ageMin <= 60;

  let tone = "bg-[hsl(var(--success))]/15 text-[hsl(var(--success))]";
  let dot = "bg-[hsl(var(--success))]";
  let Icon = CheckCircle2;
  let label = "QuickBooks Online";
  let sub = "Sincronizado";

  if (!connected) {
    tone = "bg-[hsl(var(--destructive))]/15 text-[hsl(var(--destructive))]";
    dot = "bg-[hsl(var(--destructive))]";
    Icon = AlertCircle;
    sub = "Desconectado";
  } else if (!fresh) {
    tone = "bg-[hsl(var(--warning))]/20 text-[hsl(var(--warning))]";
    dot = "bg-[hsl(var(--warning))]";
    Icon = AlertCircle;
    sub = startedAt ? "Sync atrasada" : "Sin sincronizar";
  } else if (ageMin !== null) {
    sub = `Sincronizado hace ${ageMin === 0 ? "menos de 1" : ageMin} min`;
  }

  return (
    <Link
      to="/integrations"
      className={cn(
        "mx-3 mt-3 mb-2 flex items-center gap-2.5 rounded-lg px-3 py-2 transition-all hover:opacity-90",
        tone,
      )}
      title={sub}
    >
      <span className={cn("relative flex h-2 w-2")}>
        <span className={cn("absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping", dot)} />
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", dot)} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wider leading-tight truncate">
          {label}
        </div>
        <div className="text-[11px] opacity-80 leading-tight truncate">{sub}</div>
      </div>
      <Icon className="h-3.5 w-3.5 shrink-0" />
    </Link>
  );
}
