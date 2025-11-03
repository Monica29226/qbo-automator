import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, ArrowLeft, Loader2, Save } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Settings {
  qbo_company_id: string;
  mail_provider: string;
  mail_query: string;
  process_credit_notes: string;
  currency_fallback: string;
  duplicate_window_days: string;
  dry_run: string;
}

const Settings = () => {
  const [settings, setSettings] = useState<Settings>({
    qbo_company_id: "",
    mail_provider: "gmail",
    mail_query: "",
    process_credit_notes: "true",
    currency_fallback: "CRC",
    duplicate_window_days: "120",
    dry_run: "true",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setIsLoading(true);
    const { data, error } = await supabase.from("system_settings").select("*");

    if (error) {
      toast.error("Error al cargar configuración");
      console.error(error);
    } else if (data) {
      const settingsMap = data.reduce((acc, item) => {
        acc[item.key] = item.value;
        return acc;
      }, {} as Settings);
      setSettings(settingsMap);
    }
    setIsLoading(false);
  };

  const handleSave = async () => {
    setIsSaving(true);

    const updates = Object.entries(settings).map(([key, value]) => ({
      key,
      value,
    }));

    for (const update of updates) {
      const { error } = await supabase
        .from("system_settings")
        .update({ value: update.value })
        .eq("key", update.key);

      if (error) {
        toast.error(`Error al actualizar ${update.key}`);
        console.error(error);
        setIsSaving(false);
        return;
      }
    }

    toast.success("Configuración guardada exitosamente");
    setIsSaving(false);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/dashboard">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Volver
              </Link>
            </Button>
            <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
              <FileText className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Configuración del Sistema</h1>
              <p className="text-xs text-muted-foreground">Parámetros de automatización y procesamiento</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <Card className="p-6 max-w-3xl mx-auto">
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold mb-4">Conexión QuickBooks</h2>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="qbo_company_id">QuickBooks Company ID (realmId)</Label>
                  <Input
                    id="qbo_company_id"
                    value={settings.qbo_company_id}
                    onChange={(e) =>
                      setSettings({ ...settings, qbo_company_id: e.target.value })
                    }
                    placeholder="1234567890"
                  />
                  <p className="text-xs text-muted-foreground">
                    ID de la compañía en QuickBooks Online
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h2 className="text-lg font-semibold mb-4">Correo Electrónico</h2>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="mail_provider">Proveedor de Correo</Label>
                  <Select
                    value={settings.mail_provider}
                    onValueChange={(value) =>
                      setSettings({ ...settings, mail_provider: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gmail">Gmail</SelectItem>
                      <SelectItem value="outlook">Outlook</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="mail_query">Filtro de Búsqueda</Label>
                  <Input
                    id="mail_query"
                    value={settings.mail_query}
                    onChange={(e) => setSettings({ ...settings, mail_query: e.target.value })}
                    placeholder="has:attachment filename:xml"
                  />
                  <p className="text-xs text-muted-foreground">
                    Query de búsqueda para filtrar correos con facturas
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h2 className="text-lg font-semibold mb-4">Procesamiento</h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Procesar Notas de Crédito</Label>
                    <p className="text-xs text-muted-foreground">
                      Habilitar procesamiento automático de notas de crédito
                    </p>
                  </div>
                  <Switch
                    checked={settings.process_credit_notes === "true"}
                    onCheckedChange={(checked) =>
                      setSettings({ ...settings, process_credit_notes: checked ? "true" : "false" })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="currency_fallback">Moneda por Defecto</Label>
                  <Select
                    value={settings.currency_fallback}
                    onValueChange={(value) =>
                      setSettings({ ...settings, currency_fallback: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CRC">CRC - Colones</SelectItem>
                      <SelectItem value="USD">USD - Dólares</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="duplicate_window_days">Ventana Anti-Duplicados (días)</Label>
                  <Input
                    id="duplicate_window_days"
                    type="number"
                    value={settings.duplicate_window_days}
                    onChange={(e) =>
                      setSettings({ ...settings, duplicate_window_days: e.target.value })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Días hacia atrás para verificar documentos duplicados
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Modo Prueba (Dry Run)</Label>
                    <p className="text-xs text-muted-foreground">
                      No publicar en QuickBooks, solo simular
                    </p>
                  </div>
                  <Switch
                    checked={settings.dry_run === "true"}
                    onCheckedChange={(checked) =>
                      setSettings({ ...settings, dry_run: checked ? "true" : "false" })
                    }
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-6 flex justify-end gap-3">
              <Button variant="outline" onClick={fetchSettings}>
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Guardar Cambios
                  </>
                )}
              </Button>
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
};

export default Settings;
