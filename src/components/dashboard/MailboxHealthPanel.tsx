import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mail, CheckCircle2, AlertCircle, Clock, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

type MailboxRow = {
  orgId: string;
  orgName: string;
  mailbox: string | null;
  lastAttempt: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  failingSince: string | null;
};

const MAIL_FIELDS = [
  ["gmail_connected", "gmail_email"],
  ["outlook_connected", "outlook_email"],
  ["hostinger_connected", "hostinger_email"],
  ["bluehost_connected", "bluehost_email"],
] as const;

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "sin registro";
  return new Date(iso).toLocaleString("es-CR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MailboxHealthPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["mailbox-health-panel"],
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async (): Promise<MailboxRow[]> => {
      const [{ data: orgs, error: orgsError }, { data: logs, error: logsError }] = await Promise.all([
        supabase
          .from("organizations")
          .select(
            "id, name, gmail_connected, gmail_email, outlook_connected, outlook_email, hostinger_connected, hostinger_email, bluehost_connected, bluehost_email",
          )
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("sync_logs")
          .select("organization_id, started_at, status, error_message")
          .order("started_at", { ascending: false })
          .limit(1000),
      ]);
      if (orgsError) throw orgsError;
      if (logsError) throw logsError;

      const rows: MailboxRow[] = [];

      for (const org of orgs ?? []) {
        const mailbox =
          MAIL_FIELDS.map(([flag, email]) =>
            (org as Record<string, unknown>)[flag] ? ((org as Record<string, unknown>)[email] as string | null) : null,
          ).find((v) => !!v) ?? null;

        const hasMail = MAIL_FIELDS.some(([flag]) => !!(org as Record<string, unknown>)[flag]);
        if (!hasMail) continue;

        const orgLogs = (logs ?? []).filter((l) => l.organization_id === org.id);
        const lastAttempt = orgLogs[0]?.started_at ?? null;
        const lastSuccess = orgLogs.find((l) => l.status !== "error")?.started_at ?? null;
        const lastError = orgLogs[0]?.status === "error" ? (orgLogs[0]?.error_message ?? null) : null;

        // Inicio de la racha de fallos: el intento más antiguo consecutivo con error.
        let failingSince: string | null = null;
        for (const log of orgLogs) {
          if (log.status === "error") failingSince = log.started_at;
          else break;
        }

        rows.push({
          orgId: org.id,
          orgName: org.name,
          mailbox,
          lastAttempt,
          lastSuccess,
          lastError,
          failingSince,
        });
      }

      // Primero las empresas con problema.
      return rows.sort((a, b) => {
        const score = (r: MailboxRow) => (r.failingSince ? 0 : (hoursSince(r.lastSuccess) ?? 999) > 24 ? 1 : 2);
        return score(a) - score(b) || a.orgName.localeCompare(b.orgName);
      });
    },
  });

  if (isLoading) {
    return (
      <Card className="mb-6">
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Revisando el estado de los buzones…
        </CardContent>
      </Card>
    );
  }

  const rows = data ?? [];
  if (rows.length === 0) return null;

  const failing = rows.filter((r) => r.failingSince);
  const stale = rows.filter((r) => !r.failingSince && (hoursSince(r.lastSuccess) ?? 999) > 24);

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Mail className="h-4 w-4" strokeWidth={1.5} />
              Lectura de correo por empresa
            </CardTitle>
            <CardDescription>
              Si un buzón no se puede abrir, no entran facturas nuevas de esa empresa.
            </CardDescription>
          </div>
          {failing.length > 0 ? (
            <Badge variant="destructive">{failing.length} con problema</Badge>
          ) : stale.length > 0 ? (
            <Badge variant="outline">{stale.length} sin leer hace más de 24 h</Badge>
          ) : (
            <Badge variant="outline">Todas al día</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((row) => {
          const broken = !!row.failingSince;
          const staleRow = !broken && (hoursSince(row.lastSuccess) ?? 999) > 24;
          const Icon = broken ? AlertCircle : staleRow ? Clock : CheckCircle2;
          const tone = broken
            ? "text-[hsl(var(--destructive))]"
            : staleRow
              ? "text-[hsl(var(--warning))]"
              : "text-[hsl(var(--success))]";

          return (
            <div
              key={row.orgId}
              className="flex items-start justify-between gap-3 rounded border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 shrink-0 ${tone}`} strokeWidth={1.5} />
                  <span className="text-sm font-medium truncate">{row.orgName}</span>
                </div>
                <div className="mt-0.5 pl-6 text-xs text-muted-foreground truncate">
                  {row.mailbox ?? "buzón sin registrar"}
                </div>
                {broken && (
                  <div className="mt-1 pl-6 text-xs text-[hsl(var(--destructive))]">
                    No se puede abrir desde el {formatWhen(row.failingSince)}
                    {row.lastError ? ` — ${row.lastError.slice(0, 90)}` : ""}
                  </div>
                )}
              </div>
              <div className="text-right text-xs text-muted-foreground shrink-0">
                <div>Última lectura correcta</div>
                <div className="tabular-nums">{formatWhen(row.lastSuccess)}</div>
                {broken && (
                  <Link to="/integrations" className="text-[hsl(var(--warning))] underline">
                    Revisar conexión
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
