import { useState } from "react";
import { useBankImports } from "@/hooks/useBankImports";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Cloud, CloudOff, RefreshCw, FolderSync } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export function BankImportConfigPanel() {
  const { configs, createConfig, deleteConfig, sources, createSource } = useBankImports();
  const { activeOrganization } = useAuth();
  const [showAddConfig, setShowAddConfig] = useState(false);
  const [showAddSource, setShowAddSource] = useState(false);
  const [connectingOneDrive, setConnectingOneDrive] = useState(false);
  const [syncingFolder, setSyncingFolder] = useState(false);
  const [oneDriveStatus, setOneDriveStatus] = useState<any>(null);

  const [newConfig, setNewConfig] = useState({
    bank_name: "",
    currency: "CRC",
    date_format: "dd/MM/yyyy",
    amount_layout: "DEBIT_CREDIT_COLUMNS",
    input_format_type: "DEBE_HABER",
    onedrive_folder_incoming: "",
    onedrive_folder_processed: "",
    onedrive_folder_error: "",
  });
  const [newSource, setNewSource] = useState({
    bank_import_config_id: "",
    source_name: "",
    file_extension: "csv",
    column_mapping: '{"date":0,"reference":1,"debit":2,"credit":3,"description":4}',
  });

  const handleCreateConfig = async () => {
    if (!newConfig.bank_name) {
      toast.error("Nombre del banco es requerido");
      return;
    }
    await createConfig.mutateAsync(newConfig);
    setShowAddConfig(false);
    setNewConfig({
      bank_name: "",
      currency: "CRC",
      date_format: "dd/MM/yyyy",
      amount_layout: "DEBIT_CREDIT_COLUMNS",
      input_format_type: "DEBE_HABER",
      onedrive_folder_incoming: "",
      onedrive_folder_processed: "",
      onedrive_folder_error: "",
    });
  };

  const handleCreateSource = async () => {
    if (!newSource.bank_import_config_id || !newSource.source_name) {
      toast.error("Banco y nombre de fuente son requeridos");
      return;
    }
    try {
      const mapping = JSON.parse(newSource.column_mapping);
      await createSource.mutateAsync({
        ...newSource,
        column_mapping: mapping,
      });
      setShowAddSource(false);
    } catch {
      toast.error("JSON de mapeo inválido");
    }
  };

  const handleConnectOneDrive = async () => {
    if (!activeOrganization) return;
    setConnectingOneDrive(true);
    try {
      const { data, error } = await supabase.functions.invoke("onedrive-oauth-init", {
        body: { state: activeOrganization },
      });
      if (error) throw error;
      if (data?.authUrl) {
        window.open(data.authUrl, "onedrive-oauth", "width=600,height=700");
      }
    } catch (err: any) {
      toast.error(err.message || "Error conectando OneDrive");
    } finally {
      setConnectingOneDrive(false);
    }
  };

  const handleSyncNow = async () => {
    if (!activeOrganization) return;
    setSyncingFolder(true);
    try {
      const { data, error } = await supabase.functions.invoke("onedrive-bank-sync", {
        body: { action: "sync_folder", organization_id: activeOrganization },
      });
      if (error) throw error;
      toast.success(
        `Sincronización completada: ${data.new_jobs_created} archivos nuevos, ${data.duplicates_skipped} duplicados omitidos`
      );
    } catch (err: any) {
      toast.error(err.message || "Error sincronizando");
    } finally {
      setSyncingFolder(false);
    }
  };

  const handleCreateSubscription = async () => {
    if (!activeOrganization) return;
    try {
      const { data, error } = await supabase.functions.invoke("onedrive-bank-sync", {
        body: { action: "create_subscription", organization_id: activeOrganization },
      });
      if (error) throw error;
      toast.success(`Webhook creado. Expira: ${new Date(data.expires).toLocaleString("es-CR")}`);
    } catch (err: any) {
      toast.error(err.message || "Error creando suscripción");
    }
  };

  return (
    <div className="space-y-6">
      {/* OneDrive Integration */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5" />
            Integración OneDrive
          </CardTitle>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleConnectOneDrive}
              disabled={connectingOneDrive}
            >
              {connectingOneDrive ? (
                <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Cloud className="h-4 w-4 mr-1" />
              )}
              Conectar OneDrive
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSyncNow}
              disabled={syncingFolder}
            >
              {syncingFolder ? (
                <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <FolderSync className="h-4 w-4 mr-1" />
              )}
              Sincronizar Ahora
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCreateSubscription}
            >
              Activar Webhook
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Conecta OneDrive para detectar automáticamente archivos nuevos en las carpetas configuradas.
            Configura las rutas de carpetas (Incoming, Processed, Error) en cada banco.
          </p>
        </CardContent>
      </Card>

      {/* Bank Configs */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Bancos Configurados</CardTitle>
          <Button size="sm" onClick={() => setShowAddConfig(true)}>
            <Plus className="h-4 w-4 mr-1" /> Agregar Banco
          </Button>
        </CardHeader>
        <CardContent>
          {configs.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-4">
              No hay bancos configurados. Agrega uno para comenzar.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Banco</TableHead>
                  <TableHead>Moneda</TableHead>
                  <TableHead>Formato Fecha</TableHead>
                  <TableHead>Layout</TableHead>
                  <TableHead>Carpeta OneDrive</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {configs.map((c: any) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.bank_name}</TableCell>
                    <TableCell>{c.currency}</TableCell>
                    <TableCell className="text-sm">{c.date_format}</TableCell>
                    <TableCell className="text-sm">{c.amount_layout}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">
                      {c.onedrive_folder_incoming || "No configurada"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={c.is_active ? "default" : "secondary"}>
                        {c.is_active ? "Activo" : "Inactivo"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteConfig.mutate(c.id)}
                        title="Eliminar"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Sources */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Fuentes / Parsers</CardTitle>
          <Button size="sm" onClick={() => setShowAddSource(true)} disabled={configs.length === 0}>
            <Plus className="h-4 w-4 mr-1" /> Agregar Fuente
          </Button>
        </CardHeader>
        <CardContent>
          {sources.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-4">
              No hay fuentes configuradas.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Banco</TableHead>
                  <TableHead>Extensión</TableHead>
                  <TableHead>Mapeo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((s: any) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.source_name}</TableCell>
                    <TableCell>{(s as any).bank_import_configs?.bank_name || "—"}</TableCell>
                    <TableCell>{s.file_extension}</TableCell>
                    <TableCell className="text-xs font-mono max-w-[200px] truncate">
                      {JSON.stringify(s.column_mapping)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Config Dialog */}
      <Dialog open={showAddConfig} onOpenChange={setShowAddConfig}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Agregar Banco</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nombre del Banco</Label>
              <Input
                value={newConfig.bank_name}
                onChange={(e) => setNewConfig({ ...newConfig, bank_name: e.target.value })}
                placeholder="Ej: BAC San José"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Moneda</Label>
                <Select value={newConfig.currency} onValueChange={(v) => setNewConfig({ ...newConfig, currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CRC">CRC - Colones</SelectItem>
                    <SelectItem value="USD">USD - Dólares</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Formato de Fecha</Label>
                <Select value={newConfig.date_format} onValueChange={(v) => setNewConfig({ ...newConfig, date_format: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dd/MM/yyyy">dd/MM/yyyy</SelectItem>
                    <SelectItem value="MM/dd/yyyy">MM/dd/yyyy</SelectItem>
                    <SelectItem value="yyyy-MM-dd">yyyy-MM-dd</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Layout de Montos</Label>
              <Select value={newConfig.amount_layout} onValueChange={(v) => setNewConfig({ ...newConfig, amount_layout: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DEBIT_CREDIT_COLUMNS">Columnas Debe/Haber separadas</SelectItem>
                  <SelectItem value="SINGLE_SIGNED_AMOUNT">Monto único con signo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="border-t pt-3">
              <p className="text-sm font-medium mb-2">Carpetas OneDrive (opcional)</p>
              <div className="space-y-2">
                <div>
                  <Label className="text-xs">Carpeta Incoming</Label>
                  <Input
                    value={newConfig.onedrive_folder_incoming}
                    onChange={(e) => setNewConfig({ ...newConfig, onedrive_folder_incoming: e.target.value })}
                    placeholder="/Estados de Cuenta/BAC/Incoming"
                    className="text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Carpeta Processed</Label>
                  <Input
                    value={newConfig.onedrive_folder_processed}
                    onChange={(e) => setNewConfig({ ...newConfig, onedrive_folder_processed: e.target.value })}
                    placeholder="/Estados de Cuenta/BAC/Processed"
                    className="text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Carpeta Error</Label>
                  <Input
                    value={newConfig.onedrive_folder_error}
                    onChange={(e) => setNewConfig({ ...newConfig, onedrive_folder_error: e.target.value })}
                    placeholder="/Estados de Cuenta/BAC/Error"
                    className="text-sm"
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddConfig(false)}>Cancelar</Button>
            <Button onClick={handleCreateConfig} disabled={createConfig.isPending}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Source Dialog */}
      <Dialog open={showAddSource} onOpenChange={setShowAddSource}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar Fuente</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Banco</Label>
              <Select value={newSource.bank_import_config_id} onValueChange={(v) => setNewSource({ ...newSource, bank_import_config_id: v })}>
                <SelectTrigger><SelectValue placeholder="Seleccionar banco..." /></SelectTrigger>
                <SelectContent>
                  {configs.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.bank_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Nombre de la Fuente</Label>
              <Input
                value={newSource.source_name}
                onChange={(e) => setNewSource({ ...newSource, source_name: e.target.value })}
                placeholder="Ej: BAC Colones CSV"
              />
            </div>
            <div>
              <Label>Extensión de Archivo</Label>
              <Select value={newSource.file_extension} onValueChange={(v) => setNewSource({ ...newSource, file_extension: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="xlsx">XLSX</SelectItem>
                  <SelectItem value="txt">TXT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Mapeo de Columnas (JSON)</Label>
              <Input
                value={newSource.column_mapping}
                onChange={(e) => setNewSource({ ...newSource, column_mapping: e.target.value })}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Ejemplo: {`{"date":0,"reference":1,"debit":2,"credit":3,"description":4}`}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddSource(false)}>Cancelar</Button>
            <Button onClick={handleCreateSource} disabled={createSource.isPending}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
