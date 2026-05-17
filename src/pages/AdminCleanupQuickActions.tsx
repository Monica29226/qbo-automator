import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, PlayCircle, CheckCircle2, RefreshCw, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function AdminCleanupQuickActions() {
  const [orgs, setOrgs] = useState<Array<{ id: string; name: string }>>([]);
  const [orgId, setOrgId] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("organizations").select("id,name").eq("is_active", true).order("name");
      setOrgs(data || []);
    })();
  }, []);

  const run = async (key: string, fn: () => Promise<string>) => {
    if (!orgId) return toast.error("Selecciona una empresa");
    setBusy(key);
    try {
      const msg = await fn();
      toast.success(msg);
    } catch (e: any) {
      toast.error(e?.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  const retryLegacy = () => run("legacy", async () => {
    await supabase
      .from("processed_documents")
      .update({ status: "processed", error_message: null })
      .eq("organization_id", orgId)
      .in("status", ["error", "needs_account_mapping"])
      .or("error_message.ilike.%1150040%,default_account_ref.ilike.%1150040%");
    const { data, error } = await supabase.functions.invoke("publish-to-quickbooks", { body: { organization_id: orgId } });
    if (error) throw error;
    return `Reintento: ${data?.published ?? 0} publicadas, ${data?.failed ?? 0} fallidas`;
  });

  const retryWaiting = () => run("waiting", async () => {
    const { data, error } = await supabase.functions.invoke("retry-qbo-waiting", { body: { organization_id: orgId } });
    if (error) throw error;
    return `Procesadas ${data?.processed ?? 0} facturas en espera`;
  });

  const resolveAlerts = () => run("alerts", async () => {
    const { error, count } = await supabase
      .from("alert_history")
      .update({ resolved: true, resolved_at: new Date().toISOString() }, { count: "exact" })
      .eq("organization_id", orgId)
      .eq("resolved", false)
      .lt("created_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());
    if (error) throw error;
    return `${count ?? 0} alertas marcadas como resueltas`;
  });

  const backfillDefaults = () => run("backfill", async () => {
    const { data: docs } = await supabase
      .from("processed_documents")
      .select("default_account_ref")
      .eq("organization_id", orgId)
      .not("qbo_entity_id", "is", null)
      .not("default_account_ref", "is", null)
      .limit(2000);
    const counts = new Map<string, number>();
    for (const d of docs || []) counts.set(d.default_account_ref!, (counts.get(d.default_account_ref!) || 0) + 1);
    const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!top) throw new Error("No hay historial suficiente para sugerir cuenta default");
    const { error } = await supabase.from("organizations").update({ default_account_ref: top }).eq("id", orgId);
    if (error) throw error;
    return `Default backfilleada: "${top}"`;
  });

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/dashboard"><ArrowLeft className="h-4 w-4 mr-1" />Dashboard</Link>
        </Button>
        <h1 className="text-2xl font-semibold">Acciones rápidas de limpieza</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Empresa</CardTitle>
          <CardDescription>Selecciona la empresa sobre la que ejecutar las acciones.</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={orgId} onValueChange={setOrgId}>
            <SelectTrigger><SelectValue placeholder="Seleccionar empresa…" /></SelectTrigger>
            <SelectContent>
              {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ActionCard
          icon={PlayCircle}
          title="Reintentar errores de cuenta legacy"
          desc="Reenvía a QBO todas las facturas con error de código legacy (1150040…)."
          onClick={retryLegacy}
          loading={busy === "legacy"}
        />
        <ActionCard
          icon={RefreshCw}
          title="Reintentar facturas en espera QBO"
          desc="Vuelve a publicar las facturas en estado waiting_for_qbo."
          onClick={retryWaiting}
          loading={busy === "waiting"}
        />
        <ActionCard
          icon={CheckCircle2}
          title="Marcar alertas viejas como resueltas"
          desc="Resuelve alertas con más de 7 días sin nuevas ocurrencias."
          onClick={resolveAlerts}
          loading={busy === "alerts"}
        />
        <ActionCard
          icon={Database}
          title="Backfill cuenta default"
          desc="Asigna la cuenta contable más usada como default de la empresa."
          onClick={backfillDefaults}
          loading={busy === "backfill"}
        />
      </div>
    </div>
  );
}

function ActionCard({ icon: Icon, title, desc, onClick, loading }: any) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Icon className="h-4 w-4" />{title}</CardTitle>
        <CardDescription>{desc}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button size="sm" onClick={onClick} disabled={loading} className="w-full">
          {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-1" />}
          Ejecutar
        </Button>
      </CardContent>
    </Card>
  );
}
