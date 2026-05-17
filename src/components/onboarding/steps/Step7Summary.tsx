import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckCircle2, AlertTriangle, Loader2, Rocket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getIdentificationLabel } from "@/lib/identification-types";
import { useNavigate } from "react-router-dom";

interface Props {
  organizationId: string;
  initial?: any;
  stepData: Record<string, any>;
  onFinish: () => Promise<void>;
}

export default function Step7Summary({ organizationId, stepData, onFinish }: Props) {
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);
  const [summary, setSummary] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const { data: org } = await supabase
        .from("organizations")
        .select("name,identification_type,gmail_email,outlook_email,hostinger_email,bluehost_email,default_account_ref")
        .eq("id", organizationId)
        .maybeSingle();
      const { data: setting } = await supabase
        .from("system_settings")
        .select("value")
        .eq("organization_id", organizationId)
        .eq("key", "default_uses_tax")
        .maybeSingle();
      setSummary({ org, ivaMode: setting?.value !== "false" });
    })();
  }, [organizationId]);

  const verify = stepData?.step2?.verify;
  const taxOk = verify?.taxChecklist?.filter((t: any) => t.found).map((t: any) => t.label) ?? [];
  const taxMissing = verify?.taxChecklist?.filter((t: any) => !t.found).map((t: any) => t.label) ?? [];

  const startSync = async () => {
    setSyncing(true);
    try {
      await onFinish();
      const provider = summary?.org?.gmail_email ? "gmail-fetch-invoices" :
                       summary?.org?.outlook_email ? "outlook-fetch-invoices" :
                       summary?.org?.hostinger_email ? "hostinger-fetch-invoices" :
                       summary?.org?.bluehost_email ? "bluehost-fetch-invoices" : null;
      if (provider) {
        toast.info("Iniciando primera sincronización…");
        await supabase.functions.invoke(provider, { body: { organization_id: organizationId, days: 30 } });
        toast.success("Sincronización iniciada");
      }
      navigate("/dashboard");
    } catch (e: any) {
      toast.error(e.message ?? "Error en sincronización");
    } finally {
      setSyncing(false);
    }
  };

  const finishLater = async () => {
    await onFinish();
    navigate("/dashboard");
  };

  if (!summary) return <Loader2 className="h-5 w-5 animate-spin" />;

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-2">
        <Row ok label="Empresa" value={`${summary.org?.name} (${getIdentificationLabel(summary.org?.identification_type)})`} />
        <Row ok={!!verify?.connected} label="QuickBooks" value={verify?.connected
          ? `Moneda ${verify.currency?.homeCurrency}, Multi-currency: ${verify.currency?.multiCurrencyEnabled ? "sí" : "no"}`
          : "No conectado"} />
        {taxOk.length > 0 && <Row ok label="Tasas IVA configuradas" value={taxOk.join(", ")} />}
        {taxMissing.length > 0 && <Row ok={false} label="Tasas faltantes" value={taxMissing.join(", ")} />}
        <Row ok={!!(summary.org?.gmail_email || summary.org?.outlook_email || summary.org?.hostinger_email || summary.org?.bluehost_email)}
             label="Correo"
             value={summary.org?.gmail_email || summary.org?.outlook_email || summary.org?.hostinger_email || summary.org?.bluehost_email || "No conectado"} />
        <Row ok={!!summary.org?.default_account_ref} label="Cuenta default" value={summary.org?.default_account_ref || "No configurada"} />
        <Row ok label="Modo IVA" value={summary.ivaMode ? "Recuperable" : "Gasto"} />
        <Row ok label="Reglas iniciales" value={`${stepData?.step6?.count ?? 0} regla(s)`} />
      </Card>

      <div className="flex flex-col sm:flex-row gap-2">
        <Button size="lg" onClick={startSync} disabled={syncing} className="flex-1">
          {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Rocket className="h-4 w-4 mr-2" />}
          Iniciar primera sincronización
        </Button>
        <Button size="lg" variant="outline" onClick={finishLater} disabled={syncing}>
          Configurar después
        </Button>
      </div>
    </div>
  );
}

function Row({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 py-1">
      {ok ? <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" /> : <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5" />}
      <div className="flex-1 text-sm"><span className="font-medium">{label}:</span> {value}</div>
    </div>
  );
}
