import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, AlertTriangle, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  organizationId: string;
  initial?: any;
  onSaved: (data: any) => void;
  bindActions: (a: { onNext: () => any; disableNext?: boolean }) => void;
}

interface CheckItem { key: string; label: string; required: boolean; found: boolean; qboName?: string | null; }
interface VerifyData {
  connected: boolean;
  companyInfo?: any;
  currency?: { homeCurrency: string; multiCurrencyEnabled: boolean };
  taxChecklist?: CheckItem[];
  canProceed?: boolean;
  accounts?: { total: number; warningFew: boolean; suggestedDefault?: any; list: any[] };
}

export default function Step2QBO({ organizationId, initial, onSaved, bindActions }: Props) {
  const [verifying, setVerifying] = useState(false);
  const [data, setData] = useState<VerifyData | null>(initial?.verify ?? null);
  const [skips, setSkips] = useState<Record<string, boolean>>(initial?.skips ?? {});

  const verify = useCallback(async () => {
    setVerifying(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("verify-qbo-readiness", {
        body: { organization_id: organizationId },
      });
      if (error) throw error;
      setData(res as VerifyData);
    } catch (e: any) {
      toast.error(e.message ?? "Error verificando QuickBooks");
    } finally {
      setVerifying(false);
    }
  }, [organizationId]);

  useEffect(() => {
    verify();
  }, [verify]);

  const handleConnect = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const state = btoa(JSON.stringify({ organization_id: organizationId, user_id: user?.id }));
    const { data: res, error } = await supabase.functions.invoke("quickbooks-oauth-init", { body: { state } });
    if (error || !res?.authUrl) return toast.error("Error iniciando conexión QBO");
    const w = window.open(res.authUrl, "QBO", "width=800,height=700");
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "quickbooks-connected") {
        toast.success("QuickBooks conectado");
        window.removeEventListener("message", handler);
        verify();
      }
    };
    window.addEventListener("message", handler);
    if (!w) toast.error("Habilita popups del navegador");
  };

  const missingRequired = data?.taxChecklist?.filter((t) => t.required && !t.found) ?? [];
  const missingOptionalUnchecked = data?.taxChecklist?.filter((t) => !t.required && !t.found && !skips[t.key]) ?? [];
  const canProceed = !!data?.connected && missingRequired.length === 0;

  useEffect(() => {
    bindActions({
      onNext: async () => {
        if (data?.connected && data.currency?.homeCurrency) {
          await (supabase as any)
            .from("system_settings")
            .upsert(
              {
                organization_id: organizationId,
                key: "qbo_home_currency",
                value: data.currency.homeCurrency,
              },
              { onConflict: "key,organization_id" },
            );
        }
        onSaved({ verify: data, skips });
      },
      disableNext: !canProceed,
    });
  }, [canProceed, data, skips, organizationId, onSaved, bindActions]);

  if (verifying) {
    return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Verificando QuickBooks…</div>;
  }

  if (!data?.connected) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertTitle>QuickBooks no está conectado</AlertTitle>
          <AlertDescription>Conecta tu cuenta de QuickBooks Online para publicar facturas automáticamente.</AlertDescription>
        </Alert>
        <Button onClick={handleConnect} size="lg">Conectar QuickBooks</Button>
        <p className="text-sm text-muted-foreground">Puedes saltar este paso y conectar después desde Integraciones.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Alert>
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <AlertTitle>Conectado a {data.companyInfo?.companyName ?? "QuickBooks"}</AlertTitle>
        <AlertDescription className="space-y-1 mt-2">
          <div>Moneda base: <Badge variant="secondary">{data.currency?.homeCurrency}</Badge></div>
          <div>Multi-currency: {data.currency?.multiCurrencyEnabled ? "Activo ✓" : "No activo (facturas en otra moneda quedarán bloqueadas)"}</div>
          <div>País: {data.companyInfo?.country ?? "—"}</div>
        </AlertDescription>
      </Alert>

      <div className="border rounded-lg p-4 space-y-2">
        <h4 className="font-semibold">Tasas de IVA configuradas en QBO</h4>
        {data.taxChecklist?.map((t) => (
          <div key={t.key} className="flex items-center gap-3 py-1">
            {t.found ? (
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            ) : t.required ? (
              <XCircle className="h-5 w-5 text-red-600" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            )}
            <span className="flex-1">{t.label}{t.required && <span className="text-red-600 ml-1">*</span>}</span>
            {t.found ? (
              <span className="text-xs text-muted-foreground">{t.qboName}</span>
            ) : !t.required ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={!!skips[t.key]} onCheckedChange={(v) => setSkips((p) => ({ ...p, [t.key]: !!v }))} />
                No aplica
              </label>
            ) : (
              <a className="text-xs underline flex items-center gap-1" href="https://quickbooks.intuit.com/learn-support/global/help-article/sales-tax/set-tax-rates/L1xLkBHIz" target="_blank" rel="noreferrer">
                Cómo agregarla <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        ))}
        {missingRequired.length > 0 && (
          <p className="text-sm text-red-600">Configura {missingRequired.map(m => m.label).join(", ")} en QBO antes de continuar.</p>
        )}
        {missingOptionalUnchecked.length > 0 && missingRequired.length === 0 && (
          <p className="text-xs text-amber-600">Marca "No aplica" para las tasas opcionales que no usas.</p>
        )}
      </div>

      <div className="border rounded-lg p-4">
        <h4 className="font-semibold">Plan de cuentas</h4>
        <p className="text-sm text-muted-foreground">{data.accounts?.total} cuentas de gasto detectadas.</p>
        {data.accounts?.warningFew && (
          <p className="text-xs text-amber-600 mt-1">Tu QBO tiene pocas cuentas configuradas. Considera agregar más antes de operar.</p>
        )}
      </div>

      <Button variant="outline" size="sm" onClick={verify}>Re-verificar</Button>
    </div>
  );
}
