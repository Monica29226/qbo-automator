import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Cloud, CheckCircle2, XCircle, RefreshCw } from "lucide-react";

interface Account {
  id: string;
  admin_email: string;
  site_id: string | null;
  site_url: string | null;
  site_name: string | null;
  drive_id: string | null;
  root_folder_id: string | null;
  root_folder_path: string;
  is_active: boolean;
  updated_at: string;
}

interface Site {
  id: string;
  displayName: string;
  webUrl: string;
}

export default function AdminSharePointSetup() {
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<Account | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [siteQuery, setSiteQuery] = useState("");
  const [rootFolder, setRootFolder] = useState("FacturaFlow");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("sharepoint-admin", {
      body: { action: "status" },
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setAccount(data?.account || null);
    if (data?.account?.root_folder_path) setRootFolder(data.account.root_folder_path);
  };

  useEffect(() => {
    refresh();
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "sharepoint-connected") refresh();
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const connect = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.functions.invoke("sharepoint-oauth-init", {
      body: { user_id: user?.id, return_to: window.location.pathname },
    });
    if (error) { toast.error(error.message); return; }
    if (data?.auth_url) {
      window.open(data.auth_url, "_blank", "width=600,height=700");
    }
  };

  const listSites = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("sharepoint-admin", {
      body: { action: "list_sites", query: siteQuery || "*" },
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setSites(data?.sites || []);
  };

  const selectSite = async (siteId: string) => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("sharepoint-admin", {
      body: { action: "select_site", site_id: siteId, root_folder_path: rootFolder },
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    if (data?.error) { toast.error(data.error); return; }
    toast.success("Sitio configurado");
    setSites([]);
    refresh();
  };

  const testConn = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("sharepoint-admin", {
      body: { action: "test" },
    });
    setBusy(false);
    if (error || data?.error) { toast.error(error?.message || data?.error); return; }
    toast.success(`OK: ${data.user} ${data.drive_ok ? "+ drive" : ""}`);
  };

  const disconnect = async () => {
    if (!confirm("¿Desconectar la cuenta de SharePoint?")) return;
    const { error } = await supabase.functions.invoke("sharepoint-admin", {
      body: { action: "disconnect" },
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Desconectado");
    refresh();
  };

  const updateRoot = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("sharepoint-admin", {
      body: { action: "update_root_folder", root_folder_path: rootFolder },
    });
    setBusy(false);
    if (error || data?.error) { toast.error(error?.message || data?.error); return; }
    toast.success("Carpeta raíz actualizada");
    refresh();
  };

  if (loading) return <div className="p-6">Cargando…</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Cloud className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">SharePoint — Configuración</h1>
          <p className="text-muted-foreground">Conexión administrativa única para subir facturas automáticamente.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {account?.is_active ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <XCircle className="h-5 w-5 text-muted-foreground" />}
            Estado de la conexión
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!account ? (
            <>
              <p className="text-sm text-muted-foreground">No hay cuenta conectada.</p>
              <Button onClick={connect}>Conectar SharePoint</Button>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Cuenta:</span> <strong>{account.admin_email}</strong></div>
                <div><span className="text-muted-foreground">Sitio:</span> {account.site_name || <em>no seleccionado</em>}</div>
                <div><span className="text-muted-foreground">URL:</span> {account.site_url ? <a className="text-primary underline" href={account.site_url} target="_blank">{account.site_url}</a> : "—"}</div>
                <div><span className="text-muted-foreground">Drive:</span> {account.drive_id ? "✅" : "—"}</div>
                <div><span className="text-muted-foreground">Carpeta raíz:</span> {account.root_folder_path}</div>
                <div><span className="text-muted-foreground">Actualizado:</span> {new Date(account.updated_at).toLocaleString()}</div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={testConn} disabled={busy}><RefreshCw className="h-4 w-4 mr-1" /> Probar conexión</Button>
                <Button variant="outline" onClick={connect}>Reconectar</Button>
                <Button variant="destructive" onClick={disconnect}>Desconectar</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {account && (
        <Card>
          <CardHeader>
            <CardTitle>Sitio de SharePoint</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Buscar sitio… (vacío = todos)" value={siteQuery} onChange={(e) => setSiteQuery(e.target.value)} />
              <Button onClick={listSites} disabled={busy}>Listar sitios</Button>
            </div>
            {sites.length > 0 && (
              <div className="space-y-2 max-h-80 overflow-auto border rounded p-2">
                {sites.map((s) => (
                  <div key={s.id} className="flex items-center justify-between border-b py-2">
                    <div>
                      <div className="font-medium">{s.displayName}</div>
                      <div className="text-xs text-muted-foreground">{s.webUrl}</div>
                    </div>
                    <Button size="sm" onClick={() => selectSite(s.id)} disabled={busy}>
                      {account.site_id === s.id ? "Actual" : "Seleccionar"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {account?.site_id && (
        <Card>
          <CardHeader>
            <CardTitle>Carpeta raíz</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label>Nombre de la carpeta raíz dentro del sitio</Label>
            <div className="flex gap-2">
              <Input value={rootFolder} onChange={(e) => setRootFolder(e.target.value)} />
              <Button onClick={updateRoot} disabled={busy}>Guardar</Button>
            </div>
            <p className="text-xs text-muted-foreground">Estructura: <code>{rootFolder}/{"{Empresa}"}/{"{Año}"}/{"{Mes}"}/{"{Proveedor}_{Monto}_{Fecha}.{ext}"}</code></p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
