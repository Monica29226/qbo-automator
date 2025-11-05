import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Shield, ArrowLeft, Loader2, Save } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

interface ValidationSettings {
  validation_min_date: string;
  validation_accept_invoices: string;
  validation_accept_credit_notes: string;
  validation_accept_debit_notes: string;
  validation_reject_tickets: string;
  validation_duplicate_window_days: string;
}

const ValidationRules = () => {
  const { activeOrganization } = useAuth();
  const [settings, setSettings] = useState<ValidationSettings>({
    validation_min_date: "2025-11-01",
    validation_accept_invoices: "true",
    validation_accept_credit_notes: "true",
    validation_accept_debit_notes: "true",
    validation_reject_tickets: "true",
    validation_duplicate_window_days: "30",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (activeOrganization) {
      fetchSettings();
    }
  }, [activeOrganization]);

  const fetchSettings = async () => {
    if (!activeOrganization) return;

    setIsLoading(true);
    const { data, error } = await supabase
      .from("system_settings")
      .select("*")
      .eq("organization_id", activeOrganization)
      .in("key", [
        "validation_min_date",
        "validation_accept_invoices",
        "validation_accept_credit_notes",
        "validation_accept_debit_notes",
        "validation_reject_tickets",
        "validation_duplicate_window_days",
      ]);

    if (error) {
      toast.error("Error al cargar reglas de validación");
      console.error(error);
    } else if (data && data.length > 0) {
      const settingsMap = data.reduce((acc, item) => {
        acc[item.key as keyof ValidationSettings] = item.value;
        return acc;
      }, {} as ValidationSettings);
      setSettings({ ...settings, ...settingsMap });
    }
    setIsLoading(false);
  };

  const handleSave = async () => {
    if (!activeOrganization) {
      toast.error("No hay organización activa");
      return;
    }

    setIsSaving(true);

    // Validar que la fecha sea válida
    const minDate = new Date(settings.validation_min_date);
    if (isNaN(minDate.getTime())) {
      toast.error("La fecha mínima no es válida");
      setIsSaving(false);
      return;
    }

    // Validar que al menos un tipo de documento esté habilitado
    if (
      settings.validation_accept_invoices === "false" &&
      settings.validation_accept_credit_notes === "false" &&
      settings.validation_accept_debit_notes === "false"
    ) {
      toast.error("Debe habilitar al menos un tipo de documento");
      setIsSaving(false);
      return;
    }

    const updates = Object.entries(settings).map(([key, value]) => ({
      key,
      value,
      organization_id: activeOrganization,
    }));

    for (const update of updates) {
      // Intentar actualizar primero
      const { data: existing } = await supabase
        .from("system_settings")
        .select("key")
        .eq("key", update.key)
        .eq("organization_id", update.organization_id)
        .single();

      if (existing) {
        const { error } = await supabase
          .from("system_settings")
          .update({ value: update.value })
          .eq("key", update.key)
          .eq("organization_id", update.organization_id);

        if (error) {
          toast.error(`Error al actualizar ${update.key}`);
          console.error(error);
          setIsSaving(false);
          return;
        }
      } else {
        // Si no existe, insertar
        const { error } = await supabase
          .from("system_settings")
          .insert({
            key: update.key,
            value: update.value,
            organization_id: update.organization_id,
            description: getDescriptionForKey(update.key),
          });

        if (error) {
          toast.error(`Error al crear ${update.key}`);
          console.error(error);
          setIsSaving(false);
          return;
        }
      }
    }

    toast.success("Reglas de validación guardadas exitosamente");
    setIsSaving(false);
  };

  const getDescriptionForKey = (key: string): string => {
    const descriptions: Record<string, string> = {
      validation_min_date: "Fecha mínima para aceptar documentos",
      validation_accept_invoices: "Aceptar facturas electrónicas",
      validation_accept_credit_notes: "Aceptar notas de crédito electrónicas",
      validation_accept_debit_notes: "Aceptar notas de débito electrónicas",
      validation_reject_tickets: "Rechazar tiquetes electrónicos",
      validation_duplicate_window_days: "Ventana de verificación de duplicados (días)",
    };
    return descriptions[key] || "";
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
              <Shield className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Reglas de Validación</h1>
              <p className="text-xs text-muted-foreground">
                Configure las reglas globales de validación de documentos
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <Card className="p-6 max-w-3xl mx-auto">
          <div className="space-y-6">
            <div className="bg-muted/50 border rounded-lg p-4">
              <p className="text-sm text-muted-foreground">
                <strong>Nota:</strong> Estas reglas se aplican a todas las facturas procesadas
                automáticamente por el sistema. Los cambios afectarán a todos los documentos
                futuros.
              </p>
            </div>

            <div>
              <h2 className="text-lg font-semibold mb-4">Validación de Fecha</h2>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="validation_min_date">
                    Fecha Mínima de Aceptación
                  </Label>
                  <Input
                    id="validation_min_date"
                    type="date"
                    value={settings.validation_min_date}
                    onChange={(e) =>
                      setSettings({ ...settings, validation_min_date: e.target.value })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Solo se aceptarán documentos con fecha igual o posterior a esta fecha
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h2 className="text-lg font-semibold mb-4">Tipos de Documentos Aceptados</h2>
              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="validation_accept_invoices"
                    checked={settings.validation_accept_invoices === "true"}
                    onCheckedChange={(checked) =>
                      setSettings({
                        ...settings,
                        validation_accept_invoices: checked ? "true" : "false",
                      })
                    }
                  />
                  <div className="flex-1">
                    <Label
                      htmlFor="validation_accept_invoices"
                      className="font-medium cursor-pointer"
                    >
                      Facturas Electrónicas
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Tipo: FacturaElectronica
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="validation_accept_credit_notes"
                    checked={settings.validation_accept_credit_notes === "true"}
                    onCheckedChange={(checked) =>
                      setSettings({
                        ...settings,
                        validation_accept_credit_notes: checked ? "true" : "false",
                      })
                    }
                  />
                  <div className="flex-1">
                    <Label
                      htmlFor="validation_accept_credit_notes"
                      className="font-medium cursor-pointer"
                    >
                      Notas de Crédito Electrónicas
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Tipo: NotaCreditoElectronica
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="validation_accept_debit_notes"
                    checked={settings.validation_accept_debit_notes === "true"}
                    onCheckedChange={(checked) =>
                      setSettings({
                        ...settings,
                        validation_accept_debit_notes: checked ? "true" : "false",
                      })
                    }
                  />
                  <div className="flex-1">
                    <Label
                      htmlFor="validation_accept_debit_notes"
                      className="font-medium cursor-pointer"
                    >
                      Notas de Débito Electrónicas
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Tipo: NotaDebitoElectronica
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t">
                  <div className="space-y-0.5">
                    <Label>Rechazar Tiquetes Electrónicos</Label>
                    <p className="text-xs text-muted-foreground">
                      Los tiquetes electrónicos serán rechazados automáticamente
                    </p>
                  </div>
                  <Switch
                    checked={settings.validation_reject_tickets === "true"}
                    onCheckedChange={(checked) =>
                      setSettings({
                        ...settings,
                        validation_reject_tickets: checked ? "true" : "false",
                      })
                    }
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h2 className="text-lg font-semibold mb-4">Detección de Duplicados</h2>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="validation_duplicate_window_days">
                    Ventana de Verificación (días)
                  </Label>
                  <Input
                    id="validation_duplicate_window_days"
                    type="number"
                    min="1"
                    max="365"
                    value={settings.validation_duplicate_window_days}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        validation_duplicate_window_days: e.target.value,
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Número de días hacia atrás para verificar documentos duplicados por clave
                    numérica
                  </p>
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
                    Guardar Reglas
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

export default ValidationRules;
