import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, Clock, ArrowRight, Plug, Send, ListChecks, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

interface Props {
  organizationId: string | null;
}

type StepState = "ok" | "warn" | "blocked" | "pending";

interface Step {
  key: string;
  title: string;
  description: string;
  state: StepState;
  cta?: { label: string; to?: string; onClick?: () => void };
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * Guía operativa "¿Cómo hacer que las facturas lleguen a QuickBooks?"
 * Lee el estado real y le dice al usuario el siguiente paso exacto.
 */
export function PublishGuideCard({ organizationId }: Props) {
  const { data } = useQuery({
    queryKey: ["publish-guide", organizationId],
    enabled: !!organizationId,
    refetchInterval: 60_000,
    staleTime: 30_000,
    queryFn: async () => {
      const [qboActive, tokenInfo, ready, review, waiting, errors] = await Promise.all([
        supabase.rpc("has_active_integration", {
          _org_id: organizationId!,
          _service_type: "quickbooks",
        }),
        // Token expiry is not exposed via RPC; best-effort via integration_accounts (RLS may block, that's OK)
        supabase
          .from("integration_accounts")
          .select("credentials")
          .eq("organization_id", organizationId!)
          .eq("service_type", "quickbooks")
          .eq("is_active", true)
          .maybeSingle(),
        supabase
          .from("processed_documents")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId!)
          .eq("status", "processed")
          .is("qbo_entity_id", null),
        supabase
          .from("processed_documents")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId!)
          .in("status", ["review", "pending_config"]),
        supabase
          .from("processed_documents")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId!)
          .eq("status", "waiting_for_qbo"),
        supabase
          .from("processed_documents")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId!)
          .eq("status", "error"),
      ]);

      const creds = (tokenInfo.data?.credentials as any) || null;
      let tokenMinutes: number | null = null;
      if (creds?.expires_at) {
        const expiresAt = typeof creds.expires_at === "string"
          ? new Date(creds.expires_at).getTime()
          : Number(creds.expires_at);
        tokenMinutes = Math.round((expiresAt - Date.now()) / 60000);
      }

      return {
        connected: !!qboActive.data,
        tokenMinutes,
        readyCount: ready.count ?? 0,
        reviewCount: review.count ?? 0,
        waitingCount: waiting.count ?? 0,
        errorCount: errors.count ?? 0,
      };
    },
  });

  const steps: Step[] = useMemo(() => {
    if (!data) return [];

    const connected = data.connected;
    const tokenOk = data.tokenMinutes === null ? connected : data.tokenMinutes > 5;
    const tokenWarn = data.tokenMinutes !== null && data.tokenMinutes <= 60 && data.tokenMinutes > 5;
    const tokenExpired = data.tokenMinutes !== null && data.tokenMinutes <= 5;

    return [
      {
        key: "connect",
        title: "1. Conectar QuickBooks",
        description: connected
          ? "QuickBooks está conectado."
          : "QuickBooks NO está conectado. Las facturas no pueden enviarse hasta que reconectes.",
        state: connected ? "ok" : "blocked",
        icon: Plug,
        cta: connected
          ? undefined
          : { label: "Reconectar QuickBooks", to: "/integrations" },
      },
      {
        key: "token",
        title: "2. Token válido",
        description: !connected
          ? "Sin conexión activa todavía."
          : tokenExpired
          ? "El token expiró o está por expirar en menos de 5 min. Reconectá para desbloquear la publicación."
          : tokenWarn
          ? `El token expira en ${data.tokenMinutes} min. La auto-renovación se ejecuta cada 15 min en segundo plano.`
          : data.tokenMinutes !== null
          ? `Token válido por ${data.tokenMinutes} min.`
          : "Token gestionado automáticamente.",
        state: !connected ? "pending" : tokenExpired ? "blocked" : tokenWarn ? "warn" : "ok",
        icon: ShieldCheck,
        cta: tokenExpired ? { label: "Reconectar ahora", to: "/integrations" } : undefined,
      },
      {
        key: "queue",
        title: "3. Revisar la cola",
        description: [
          `${data.readyCount} listas para enviar`,
          `${data.reviewCount} en revisión (clasificación/IVA)`,
          `${data.waitingCount} esperando respuesta de QuickBooks`,
          `${data.errorCount} con error`,
        ].join(" · "),
        state:
          data.reviewCount > 0
            ? "warn"
            : data.errorCount > 0
            ? "warn"
            : data.readyCount > 0 || data.waitingCount > 0
            ? "ok"
            : "pending",
        icon: ListChecks,
        cta:
          data.reviewCount > 0
            ? { label: "Ir a Revisión", to: "/review" }
            : data.errorCount > 0
            ? { label: "Ver errores", to: "/error-documents" }
            : undefined,
      },
      {
        key: "publish",
        title: "4. Publicar",
        description:
          !connected || tokenExpired
            ? "Bloqueado: arregla los pasos 1 y 2 primero."
            : data.readyCount === 0 && data.waitingCount === 0
            ? "No hay facturas listas para enviar en este momento."
            : `Hay ${data.readyCount} listas y ${data.waitingCount} esperando QBO. Usá el botón 'Publicar a QuickBooks' o esperá al ciclo automático.`,
        state:
          !connected || tokenExpired
            ? "blocked"
            : data.readyCount > 0
            ? "ok"
            : data.waitingCount > 0
            ? "warn"
            : "pending",
        icon: Send,
      },
      {
        key: "verify",
        title: "5. Verificar resultado real",
        description:
          "El sistema solo marca como 'publicada' lo que QuickBooks confirma. Usá el diagnóstico para validar contra QuickBooks.",
        state: "ok",
        icon: CheckCircle2,
        cta: { label: "Diagnóstico QuickBooks", to: "/quickbooks-status" },
      },
    ];
  }, [data]);

  if (!organizationId || !data) return null;

  const blockedSteps = steps.filter((s) => s.state === "blocked").length;
  const warnSteps = steps.filter((s) => s.state === "warn").length;

  return (
    <Card className="mb-6 border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg flex-wrap">
          <Send className="h-5 w-5 text-primary" />
          Cómo hacer que las facturas lleguen a QuickBooks
          {blockedSteps > 0 && <Badge variant="destructive">{blockedSteps} bloqueante(s)</Badge>}
          {blockedSteps === 0 && warnSteps > 0 && (
            <Badge variant="outline" className="border-yellow-500/60 text-yellow-700 dark:text-yellow-400">
              {warnSteps} requieren atención
            </Badge>
          )}
          {blockedSteps === 0 && warnSteps === 0 && (
            <Badge variant="outline" className="border-green-500/60 text-green-700 dark:text-green-400">
              Flujo OK
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {steps.map((step) => {
            const Icon = step.icon;
            const tone =
              step.state === "ok"
                ? "border-green-500/30 bg-green-500/5"
                : step.state === "warn"
                ? "border-yellow-500/40 bg-yellow-500/5"
                : step.state === "blocked"
                ? "border-destructive/40 bg-destructive/5"
                : "border-muted bg-muted/20";

            const StateIcon =
              step.state === "ok"
                ? CheckCircle2
                : step.state === "warn"
                ? Clock
                : step.state === "blocked"
                ? AlertCircle
                : ArrowRight;

            const stateColor =
              step.state === "ok"
                ? "text-green-600 dark:text-green-400"
                : step.state === "warn"
                ? "text-yellow-600 dark:text-yellow-500"
                : step.state === "blocked"
                ? "text-destructive"
                : "text-muted-foreground";

            return (
              <li key={step.key} className={cn("flex items-start gap-3 p-3 rounded-md border", tone)}>
                <div className="mt-0.5">
                  <Icon className={cn("h-5 w-5", stateColor)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <h4 className="font-semibold text-sm">{step.title}</h4>
                    <StateIcon className={cn("h-4 w-4", stateColor)} />
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{step.description}</p>
                  {step.cta?.to && (
                    <Button asChild size="sm" variant="outline" className="mt-2">
                      <Link to={step.cta.to}>
                        {step.cta.label}
                        <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                      </Link>
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
