import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

export default function AdminImportHealth() {
  const { data, isLoading, refetch, isFetching } = useImportHealth({ allOrgs: true });
  const [drainingAll, setDrainingAll] = useState(false);
  const [drainingOrg, setDrainingOrg] = useState<string | null>(null);

  const orgs = data?.orgs ?? [];
  const summary = orgs.reduce(
    (acc, o) => {
      acc[o.health]++;
      acc.totalBacklog += o.backlog_skip_count;
      return acc;
    },
    { ok: 0, warning: 0, critical: 0, totalBacklog: 0 }
  );

  const drainOne = async (orgId: string, orgName: string) => {
    setDrainingOrg(orgId);
    const t = toast.loading(`Drenando correo de ${orgName}...`);
    try {
      const { data: res, error } = await supabase.functions.invoke("auto-sync-invoices", {
        body: { trigger: "manual_drain", organization_id: orgId },
      });
      if (error) throw error;
      toast.success(`Drenado de ${orgName} disparado`, {
        id: t,
        description: res?.summary
          ? `Procesadas: ${res.summary.processed ?? 0} · Errores: ${res.summary.errors ?? 0}`
          : undefined,
      });
      refetch();
    } catch (e) {
      toast.error(`Falló el drenado de ${orgName}`, {
        id: t,
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setDrainingOrg(null);
    }
  };

  const drainAll = async () => {
    setDrainingAll(true);
    const t = toast.loading(`Drenando ${orgs.length} organizaciones...`);
    try {
      const { data: res, error } = await supabase.functions.invoke("auto-sync-invoices", {
        body: { trigger: "manual_drain_all" },
      });
      if (error) throw error;
      toast.success("Drenado masivo completado", {
        id: t,
        description: res?.total
          ? `${res.total.processed ?? 0} mensajes procesados en ${res.total.orgs ?? orgs.length} empresas`
          : undefined,
      });
      refetch();
    } catch (e) {
      toast.error("Falló el drenado masivo", {
        id: t,
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setDrainingAll(false);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <Card>
        <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Salud de Importación — Vista Admin (todas las empresas)
            </CardTitle>
            <CardDescription>
              Vista consolidada multi-empresa. Solo visible para administradores.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="default" size="sm" onClick={drainAll} disabled={drainingAll || orgs.length === 0}>
              <Download className={`h-4 w-4 mr-2 ${drainingAll ? "animate-pulse" : ""}`} />
              {drainingAll ? "Drenando..." : "Drenar todas"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
              Actualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Organizaciones</div>
              <div className="text-2xl font-semibold">{orgs.length}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">OK</div>
              <div className="text-2xl font-semibold text-emerald-600">{summary.ok}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Atención</div>
              <div className="text-2xl font-semibold text-amber-600">{summary.warning}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Críticas</div>
              <div className="text-2xl font-semibold text-destructive">{summary.critical}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Inbox className="h-3 w-3" /> Backlog total
              </div>
              <div className="text-2xl font-semibold">{summary.totalBacklog}</div>
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : orgs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Sin datos.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organización</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Integración</TableHead>
                    <TableHead>Última sync</TableHead>
                    <TableHead className="text-right">Backlog</TableHead>
                    <TableHead className="text-right">Hoy</TableHead>
                    <TableHead className="text-right">7d</TableHead>
                    <TableHead className="text-right">Mes</TableHead>
                    <TableHead className="text-right">Pend. config</TableHead>
                    <TableHead className="text-right">Errores 7d</TableHead>
                    <TableHead className="text-right">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orgs.map((o) => (
                    <TableRow key={o.organization_id}>
                      <TableCell className="font-medium">{o.organization_name}</TableCell>
                      <TableCell>{healthBadge(o.health)}</TableCell>
                      <TableCell>
                        {o.has_integration ? (
                          <Badge variant="outline" className="capitalize">
                            <Mail className="h-3 w-3 mr-1" />
                            {o.service_type}
                          </Badge>
                        ) : (
                          <Badge variant="destructive">Sin configurar</Badge>
                        )}
                      </TableCell>
                      <TableCell
                        className={o.last_sync_status === "error" ? "text-destructive" : ""}
                        title={o.last_sync_error ?? undefined}
                      >
                        {syncLabel(o.last_sync_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        {o.backlog_skip_count > 0 ? (
                          <Badge variant="secondary">{o.backlog_skip_count}</Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{o.imported_today}</TableCell>
                      <TableCell className="text-right">{o.imported_7d}</TableCell>
                      <TableCell className="text-right">{o.imported_month}</TableCell>
                      <TableCell className="text-right">
                        {o.pending_config > 0 ? (
                          <Badge variant="outline" className="text-amber-700 dark:text-amber-400">
                            {o.pending_config}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {o.errors_count > 0 ? (
                          <Badge variant="destructive">{o.errors_count}</Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!o.has_integration || drainingOrg === o.organization_id || drainingAll}
                          onClick={() => drainOne(o.organization_id, o.organization_name)}
                        >
                          <Download
                            className={`h-3.5 w-3.5 ${drainingOrg === o.organization_id ? "animate-pulse" : ""}`}
                          />
                          <span className="ml-1">Drenar</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {data?.generated_at && (
            <p className="text-xs text-muted-foreground text-right">
              Actualizado {syncLabel(data.generated_at)}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
