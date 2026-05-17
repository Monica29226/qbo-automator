import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Mail, CheckCircle2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  organizationId: string;
  initial?: any;
  onSaved: (data: any) => void;
  bindActions: (a: { onNext: () => any; disableNext?: boolean }) => void;
}

export default function Step3Email({ organizationId, onSaved, bindActions }: Props) {
  const [connected, setConnected] = useState<any>(null);
  const [testResult, setTestResult] = useState<{ count: number; ok: boolean; msg: string } | null>(null);

  const refresh = async () => {
    const { data: org } = await supabase
      .from("organizations")
      .select("gmail_connected,gmail_email,outlook_connected,outlook_email,hostinger_connected,hostinger_email,bluehost_connected,bluehost_email")
      .eq("id", organizationId)
      .maybeSingle();
    setConnected(org);
  };
  useEffect(() => { refresh(); }, [organizationId]);

  const anyConnected = connected && (
    connected.gmail_connected || connected.outlook_connected ||
    connected.hostinger_connected || connected.bluehost_connected
  );

  useEffect(() => {
    bindActions({
      onNext: async () => onSaved({ connected, testResult }),
      disableNext: false,
    });
  }, [connected, testResult, onSaved, bindActions]);

  const connect = async (provider: "gmail" | "outlook") => {
    const initFn = provider === "gmail" ? "gmail-oauth-init" : "outlook-oauth-init";
    const { data: { user } } = await supabase.auth.getUser();
    const state = btoa(JSON.stringify({ organization_id: organizationId, user_id: user?.id }));
    const { data: res, error } = await supabase.functions.invoke(initFn, { body: { state } });
    if (error || !res?.authUrl) return toast.error("Error iniciando conexión de correo");
    const w = window.open(res.authUrl, provider, "width=800,height=700");
    const handler = (e: MessageEvent) => {
      if (typeof e.data === "object" && e.data?.type?.includes("connected")) {
        toast.success("Correo conectado");
        window.removeEventListener("message", handler);
        refresh();
        runFetchTest(provider);
      }
    };
    window.addEventListener("message", handler);
    if (!w) toast.error("Habilita popups");
  };

  const runFetchTest = async (provider: string) => {
    try {
      const fn = provider === "gmail" ? "gmail-fetch-invoices" : "outlook-fetch-invoices";
      const { data, error } = await supabase.functions.invoke(fn, {
        body: { organization_id: organizationId, days: 30, dry_run: true, max_messages: 25 },
      });
      if (error) throw error;
      const count = data?.found_with_xml ?? data?.messages_with_xml ?? data?.total ?? 0;
      setTestResult({
        count,
        ok: count > 0,
        msg: count > 0
          ? `Encontramos ${count} correos con factura en los últimos 30 días.`
          : "Conectado pero NO se encontraron correos con XML en 30 días. Verifica que sea el correo correcto.",
      });
    } catch (e: any) {
      setTestResult({ count: 0, ok: false, msg: e.message ?? "Fallo el fetch de prueba" });
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Conectaremos el correo principal donde llegan facturas. Si tienes correos adicionales podrás agregarlos después desde Integraciones.
      </p>

      {anyConnected ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription>
            {connected.gmail_connected && <div>Gmail: {connected.gmail_email}</div>}
            {connected.outlook_connected && <div>Outlook: {connected.outlook_email}</div>}
            {connected.hostinger_connected && <div>Hostinger: {connected.hostinger_email}</div>}
            {connected.bluehost_connected && <div>Bluehost: {connected.bluehost_email}</div>}
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-sm text-muted-foreground">No hay correos conectados todavía.</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-4 space-y-2">
          <div className="flex items-center gap-2"><Mail className="h-4 w-4" /><span className="font-semibold">Gmail</span></div>
          <Button size="sm" variant="outline" onClick={() => connect("gmail")}>Conectar</Button>
        </Card>
        <Card className="p-4 space-y-2">
          <div className="flex items-center gap-2"><Mail className="h-4 w-4" /><span className="font-semibold">Outlook</span></div>
          <Button size="sm" variant="outline" onClick={() => connect("outlook")}>Conectar</Button>
        </Card>
        <Card className="p-4 space-y-2">
          <div className="flex items-center gap-2"><Mail className="h-4 w-4" /><span className="font-semibold">Otro (IMAP)</span></div>
          <Button size="sm" variant="outline" asChild>
            <a href="/integrations" target="_blank" rel="noreferrer">Configurar en Integraciones</a>
          </Button>
        </Card>
      </div>

      {testResult && (
        <Alert variant={testResult.ok ? "default" : "destructive"}>
          {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          <AlertDescription>{testResult.msg}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
