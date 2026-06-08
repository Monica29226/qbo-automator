import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Mail, FileCode2, ShieldCheck, CheckCircle2, ChevronRight } from "lucide-react";
import { tabularNums } from "@/lib/format";
import { cn } from "@/lib/utils";

interface PipelineBandProps {
  organizationId: string | null;
}

interface PipelineCounts {
  received: number;
  extracted: number;
  validated: number;
  toReview: number;
  synced: number;
}

/**
 * Banda de pipeline ACL: Correo → XML → IVA → QBO.
 * Datos reales del mes en curso para la organización activa.
 */
export function PipelineBand({ organizationId }: PipelineBandProps) {
  const { data, isLoading } = useQuery<PipelineCounts>({
    queryKey: ["pipeline-band", organizationId],
    enabled: !!organizationId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const start = new Date();
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      const startIso = start.toISOString();

      const [receivedRes, docsRes, reviewRes, syncedRes] = await Promise.all([
        supabase
          .from("sync_logs")
          .select("emails_found", { count: "exact", head: false })
          .eq("organization_id", organizationId!)
          .gte("started_at", startIso),
        supabase
          .from("processed_documents")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId!)
          .gte("created_at", startIso),
        supabase
          .from("processed_documents")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId!)
          .in("status", ["review", "pending_config"])
          .gte("created_at", startIso),
        supabase
          .from("processed_documents")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId!)
          .eq("status", "published")
          .not("qbo_entity_id", "is", null)
          .gte("created_at", startIso),
      ]);

      const received =
        (receivedRes.data ?? []).reduce((acc, row: any) => acc + (row.emails_found ?? 0), 0) ||
        docsRes.count ||
        0;
      const extracted = docsRes.count ?? 0;
      const synced = syncedRes.count ?? 0;
      const toReview = reviewRes.count ?? 0;
      const validated = Math.max(extracted - toReview, synced);

      return { received, extracted, validated, toReview, synced };
    },
  });

  const steps = [
    {
      key: "received",
      label: "Correo recibido",
      sublabel: "XML adjuntos detectados",
      value: data?.received ?? 0,
      icon: Mail,
    },
    {
      key: "extracted",
      label: "XML extraído",
      sublabel: "estándar CR v4.x",
      value: data?.extracted ?? 0,
      icon: FileCode2,
    },
    {
      key: "validated",
      label: "IVA validado",
      sublabel: data && data.toReview > 0 ? `${data.toReview} a revisar` : "sin pendientes",
      value: data?.validated ?? 0,
      icon: ShieldCheck,
      warn: (data?.toReview ?? 0) > 0,
    },
    {
      key: "synced",
      label: "Sincronizado QBO",
      sublabel: "publicadas este mes",
      value: data?.synced ?? 0,
      icon: CheckCircle2,
      success: true,
    },
  ];

  return (
    <section
      aria-label="Pipeline del mes"
      className="mb-6 rounded-xl border bg-card shadow-sm overflow-hidden"
    >
      <div className="flex items-center justify-between px-6 py-3 border-b bg-muted/40">
        <h3 className="text-sm font-heading font-semibold tracking-wide uppercase text-muted-foreground">
          Pipeline del mes
        </h3>
        <span className="text-xs text-muted-foreground">
          Correo → XML → IVA → QuickBooks
        </span>
      </div>

      <ol className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] items-stretch">
        {steps.map((step, idx) => (
          <div key={step.key} className="contents">
            <li className="px-6 py-5 flex flex-col gap-1.5 justify-center min-w-0">
              <div className="flex items-center gap-2 text-muted-foreground">
                <step.icon className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-wide">
                  {step.label}
                </span>
              </div>
              <div
                className={cn(
                  "text-3xl font-heading font-semibold leading-none",
                  tabularNums,
                  step.success && "text-[hsl(var(--success))]",
                  step.warn && "text-[hsl(var(--warning))]",
                )}
              >
                {isLoading ? "—" : step.value.toLocaleString("es-CR")}
              </div>
              <p className="text-xs text-muted-foreground truncate">{step.sublabel}</p>
            </li>
            {idx < steps.length - 1 && (
              <li
                aria-hidden
                className="hidden md:flex items-center justify-center text-muted-foreground/40"
              >
                <ChevronRight className="h-5 w-5" />
              </li>
            )}
          </div>
        ))}
      </ol>
    </section>
  );
}
