import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Activity, AlertTriangle, CheckCircle2, Mail, Plug, Percent, FileWarning } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { useDashboardStats, useOrganizationConnections } from "@/hooks/useDashboardStats";

interface Props {
  organizationId: string;
}

export const StabilityScorePanel = ({ organizationId }: Props) => {
  const { data: stats } = useDashboardStats(organizationId);
  const { data: connections } = useOrganizationConnections(organizationId);

  const { data: lastSyncAt } = useQuery({
    queryKey: ["stability-last-sync", organizationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("sync_logs")
        .select("started_at")
        .eq("organization_id", organizationId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.started_at ?? null;
    },
    enabled: !!organizationId,
    refetchInterval: 60_000,
  });

  // Heuristic for IVA rates: any published invoice in last 60 days with total_tax > 0
  // means tax codes are mapped in QBO. Otherwise we flag it.
  const { data: taxStatus } = useQuery({
    queryKey: ["stability-tax-rates", organizationId],
    queryFn: async () => {
      const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const [pubWithTax, errorsTax] = await Promise.all([
        supabase
          .from("processed_documents")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("status", "published")
          .gt("total_tax", 0)
          .gte("created_at", since),
        supabase
          .from("processed_documents")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("status", "error")
          .ilike("error_message", "%tax%"),
      ]);
      const hasTaxPublished = (pubWithTax.count || 0) > 0;
      const taxErrors = errorsTax.count || 0;
      return { configured: hasTaxPublished && taxErrors === 0, taxErrors };
    },
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
  });

  const qboConnected = !!connections?.quickbooks;
  const emailConnected = !!(connections?.gmail || connections?.outlook || connections?.hostinger || connections?.bluehost);
  const lastSyncAgeH = lastSyncAt ? (Date.now() - new Date(lastSyncAt).getTime()) / 3_600_000 : Infinity;
  const emailRecent = emailConnected && lastSyncAgeH <= 2;
  const errorCount = stats?.errors ?? 0;
  const errorsOk = errorCount < 5;
  const taxOk = taxStatus?.configured ?? true; // optimistic until query loads

  const score =
    (qboConnected ? 30 : 0) +
    (emailRecent ? 30 : emailConnected ? 15 : 0) +
    (errorsOk ? 20 : 0) +
    (taxOk ? 20 : 0);

  const scoreColor =
    score >= 90 ? "text-success" : score >= 60 ? "text-warning" : "text-destructive";
  const scoreVariant =
    score >= 90 ? "default" : score >= 60 ? "secondary" : "destructive";
  const scoreLabel =
    score >= 90 ? "Estable" : score >= 60 ? "Atención" : "Crítico";

  const actions: Array<{ icon: any; title: string; cta: string; to: string; variant?: "destructive" | "outline" }> = [];
  if (!qboConnected) {
    actions.push({ icon: Plug, title: "QuickBooks no conectado", cta: "Conectar QBO", to: "/integrations", variant: "destructive" });
  }
  if (!emailConnected) {
    actions.push({ icon: Mail, title: "Sin proveedor de correo conectado", cta: "Conectar correo", to: "/integrations", variant: "destructive" });
  } else if (!emailRecent) {
    const hLabel = isFinite(lastSyncAgeH) ? `hace ${Math.round(lastSyncAgeH)}h` : "sin registros";
    actions.push({ icon: Mail, title: `Correo no sincroniza (${hLabel})`, cta: "Reconectar", to: "/integrations", variant: "outline" });
  }
  if (!errorsOk) {
    actions.push({ icon: FileWarning, title: `${errorCount} errores acumulados`, cta: "Resolver", to: "/error-documents", variant: "destructive" });
  }
  if (!taxOk) {
    actions.push({ icon: Percent, title: `Tasas IVA sin configurar${taxStatus?.taxErrors ? ` (${taxStatus.taxErrors} errores de tax)` : ""}`, cta: "Ver detalle", to: "/error-documents", variant: "outline" });
  }

  return (
    <Card className="border-l-4" style={{ borderLeftColor: score >= 90 ? "hsl(var(--success))" : score >= 60 ? "hsl(var(--warning))" : "hsl(var(--destructive))" }}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4" />
              🟢 Estado de Estabilidad
            </CardTitle>
            <CardDescription>Termómetro de salud de la empresa</CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-3xl font-bold ${scoreColor}`}>{score}%</span>
            <Badge variant={scoreVariant as any}>{scoreLabel}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={score} className="h-2" />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <ScoreItem ok={qboConnected} label="QBO conectado" points={30} />
          <ScoreItem ok={emailRecent} partial={emailConnected} label="Correo fresco (<2h)" points={30} />
          <ScoreItem ok={errorsOk} label={`Errores <5 (${errorCount})`} points={20} />
          <ScoreItem ok={taxOk} label="Tasas IVA OK" points={20} />
        </div>

        {actions.length > 0 && (
          <div className="border-t pt-3">
            <p className="text-sm font-semibold mb-2 flex items-center gap-1">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Acciones requeridas para estabilizar
            </p>
            <div className="space-y-2">
              {actions.map((a, i) => (
                <div key={i} className="flex items-center justify-between gap-3 p-2 rounded-md bg-muted/40">
                  <div className="flex items-center gap-2 text-sm min-w-0">
                    <a.icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <span className="truncate">{a.title}</span>
                  </div>
                  <Button size="sm" variant={a.variant ?? "outline"} asChild>
                    <Link to={a.to}>{a.cta}</Link>
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {actions.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" />
            Todo en orden — la empresa está operando con estabilidad completa.
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const ScoreItem = ({ ok, partial, label, points }: { ok: boolean; partial?: boolean; label: string; points: number }) => (
  <div className={`flex items-center gap-2 p-2 rounded-md border ${ok ? "bg-success/10 border-success/30" : partial ? "bg-warning/10 border-warning/30" : "bg-destructive/10 border-destructive/30"}`}>
    {ok ? (
      <CheckCircle2 className="h-3.5 w-3.5 text-success flex-shrink-0" />
    ) : (
      <AlertTriangle className={`h-3.5 w-3.5 flex-shrink-0 ${partial ? "text-warning" : "text-destructive"}`} />
    )}
    <div className="min-w-0">
      <p className="truncate font-medium">{label}</p>
      <p className="text-[10px] text-muted-foreground">{ok ? `+${points}` : partial ? `+${Math.round(points / 2)}` : "0"} pts</p>
    </div>
  </div>
);

export default StabilityScorePanel;
