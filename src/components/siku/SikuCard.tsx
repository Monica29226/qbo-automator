import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, X, Loader2, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SikuImportDialog } from "./SikuImportDialog";

interface Props {
  organizationId: string | null;
}

interface SikuAccount {
  id: string;
  credentials: { username?: string; password?: string; company_guid?: string } | null;
  is_active: boolean;
}

export function SikuCard({ organizationId }: Props) {
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<SikuAccount | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [companyGuid, setCompanyGuid] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const load = async () => {
    if (!organizationId) return;
    setLoading(true);
    const { data } = await supabase
      .from("integration_accounts")
      .select("id, credentials, is_active")
      .eq("organization_id", organizationId)
      .eq("service_type", "siku")
      .eq("is_active", true)
      .maybeSingle();
    setAccount((data as any) || null);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const handleSave = async () => {
    if (!organizationId || !username || !password || !companyGuid) {
      toast.error("Complete usuario, contraseña y GUID de la empresa");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("integration_accounts").insert({
        organization_id: organizationId,
        service_type: "siku",
        is_active: true,
        credentials: { username, password, company_guid: companyGuid },
      });
      if (error) throw error;
      toast.success("Credenciales de Siku guardadas");
      setUsername("");
      setPassword("");
      setCompanyGuid("");
      await load();
    } catch (e: any) {
      toast.error("No se pudo guardar: " + (e?.message || "error"));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!organizationId) return;
    setTesting(true);
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const d = yesterday.toISOString().slice(0, 10);
      const { data, error } = await supabase.functions.invoke("siku-fetch-invoices", {
        body: { organization_id: organizationId, fecha_inicio: d, fecha_fin: d },
      });
      if (error) throw error;
      if (data?.success) {
        toast.success(`Conexión exitosa (${data.fetched} docs consultados)`);
      } else {
        toast.error(data?.error || "Error al probar conexión");
      }
    } catch (e: any) {
      toast.error("Error: " + (e?.message || "desconocido"));
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!account) return;
    const { error } = await supabase
      .from("integration_accounts")
      .update({ is_active: false })
      .eq("id", account.id);
    if (error) {
      toast.error("No se pudo desconectar");
      return;
    }
    toast.success("Siku desconectado");
    await load();
  };

  const connected = !!account;
  const displayUser = account?.credentials?.username || "—";
  const displayGuid = account?.credentials?.company_guid
    ? `${account.credentials.company_guid.slice(0, 8)}...`
    : "—";

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4 flex-1">
          <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center">
            <FileText className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-semibold">Siku — Facturación Electrónica CR</h3>
              {connected ? (
                <Badge variant="default" className="gap-1">
                  <Check className="h-3 w-3" />
                  Conectado
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">
                  <X className="h-3 w-3" />
                  Desconectado
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Importa tus facturas emitidas automáticamente desde la plataforma Siku
            </p>

            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : connected ? (
              <div className="space-y-2">
                <p className="text-sm">
                  Usuario: <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{displayUser}</code>
                </p>
                <p className="text-sm">
                  Empresa GUID: <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{displayGuid}</code>
                </p>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" onClick={() => setImportOpen(true)}>
                    Sincronizar ahora
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleTest} disabled={testing}>
                    {testing && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                    Probar conexión
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleDisconnect}>
                    Desconectar
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 max-w-md">
                <div>
                  <Label htmlFor="siku-user">Usuario Siku</Label>
                  <Input
                    id="siku-user"
                    type="email"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="usuario@empresa.com"
                  />
                </div>
                <div>
                  <Label htmlFor="siku-pass">Contraseña Siku</Label>
                  <Input
                    id="siku-pass"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
                <div>
                  <Label htmlFor="siku-guid">GUID de la empresa</Label>
                  <Input
                    id="siku-guid"
                    type="text"
                    value={companyGuid}
                    onChange={(e) => setCompanyGuid(e.target.value)}
                    placeholder="e48b8c44-d942-4057-8685-9f15f763070a"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Encuentre el GUID de su empresa en Portal Siku → Perfil → Integraciones, o pregúntele a ACL.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSave} disabled={saving || !username || !password || !companyGuid}>
                    {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                    Guardar
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <SikuImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        organizationId={organizationId}
      />
    </Card>
  );
}
