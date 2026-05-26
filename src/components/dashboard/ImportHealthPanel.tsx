import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useImportHealth, type OrgHealth } from "@/hooks/useImportHealth";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Download,
  Inbox,
  Mail,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Link } from "react-router-dom";

function healthBadge(h: OrgHealth["health"]) {
  if (h === "ok")
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
        <CheckCircle2 className="h-3 w-3 mr-1" /> OK
      </Badge>
    );
  if (h === "warning")
    return (
      <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30">
        <AlertTriangle className="h-3 w-3 mr-1" /> Atención
      </Badge>
    );
  return (
    <Badge className="bg-destructive/15 text-destructive border-destructive/30">
      <XCircle className="h-3 w-3 mr-1" /> Crítico
    </Badge>
  );
}

function syncLabel(iso: string | null) {
  if (!iso) return "Nunca";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: es });
  } catch {
    return "—";
  }
}

function Metric({ label, value, accent }: { label: React.ReactNode; value: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${accent ?? ""}`}>{value}</div>
    </div>
  );
}

export function ImportHealthPanel() {
  const { activeOrganization } = useAuth();
  const { data, isLoading, refetch, isFetching } = useImportHealth({
    allOrgs: false,
    organizationId: activeOrganization,
  });

  const [draining, setDraining] = useState(false);
  const org = data?.orgs?.[0];

  const drain = async () => {
    if (!org) return;
    setDraining(true);
    const t = toast.loading(`Drenando correo de ${org.organization_name}...`);
    try {
      const { data: res, error } = await supabase.functions.invoke("auto-sync-invoices", {
        body: { trigger: "manual_drain", organization_id: org.organization_id },
      });
      if (error) throw error;
      toast.success("Drenado disparado", {
        id: t,
        description: res?.summary
          ? `Procesadas: ${res.summary.processed ?? 0} · Errores: ${res.summary.errors ?? 0}`
          : "Revisa el panel en unos minutos",
      });
      refetch();
    } catch (e) {
      toast.error("Falló el drenado", {
        id: t,
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setDraining(false);
    }
  };

  if (!activeOrganization) {
    return (
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5" /> Salud de Importación de Correo
          </CardTitle>
          <CardDescription>Selecciona una empresa para ver su estado.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Salud de Importación de Correo
          </CardTitle>
          <CardDescription>
            {org ? `Estado de importación de ${org.organization_name}` : "Estado de importación de tu empresa"}
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={drain}
            disabled={!org?.has_integration || draining}
          >
            <Download className={`h-4 w-4 mr-2 ${draining ? "animate-pulse" : ""}`} />
            {draining ? "Drenando..." : "Drenar correo"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !org ? (
          <p className="text-sm text-muted-foreground text-center py-6">Sin datos.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {healthBadge(org.health)}
              {org.has_integration ? (
                <Badge variant="outline" className="capitalize">
                  <Mail className="h-3 w-3 mr-1" />
                  {org.service_type}
                </Badge>
              ) : (
                <Badge variant="destructive">Sin integración de correo</Badge>
              )}
              <span
                className={`text-sm ${org.last_sync_status === "error" ? "text-destructive" : "text-muted-foreground"}`}
                title={org.last_sync_error ?? undefined}
              >
                Última sync: {syncLabel(org.last_sync_at)}
              </span>
              {!org.has_integration && (
                <Button asChild size="sm" variant="link" className="h-auto px-1">
                  <Link to="/integrations">Configurar →</Link>
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              <Metric
                label={
                  <span className="flex items-center gap-1">
                    <Inbox className="h-3 w-3" /> Backlog
                  </span>
                }
                value={org.backlog_skip_count}
              />

              <Metric label="Hoy" value={org.imported_today} />
              <Metric label="7 días" value={org.imported_7d} />
              <Metric label="Mes" value={org.imported_month} />
              <Metric
                label="Pend. config"
                value={org.pending_config}
                accent={org.pending_config > 0 ? "text-amber-600" : ""}
              />
              <Metric
                label="Errores 7d"
                value={org.errors_count}
                accent={org.errors_count > 0 ? "text-destructive" : ""}
              />
            </div>

            {org.recent_error_codes.length > 0 && (
              <div className="text-xs text-muted-foreground">
                Códigos de error recientes:{" "}
                {org.recent_error_codes.map((c) => (
                  <Badge key={c} variant="outline" className="mr-1">
                    {c}
                  </Badge>
                ))}
              </div>
            )}
          </>
        )}

        {data?.generated_at && (
          <p className="text-xs text-muted-foreground text-right">
            Actualizado {syncLabel(data.generated_at)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
