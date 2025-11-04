import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAppStore } from "@/store/appStore";

interface OAuthCredentialsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: 'google' | 'quickbooks';
  organizationId: string;
  onSuccess?: () => void;
}

export const OAuthCredentialsDialog = ({ 
  open, 
  onOpenChange, 
  provider, 
  organizationId,
  onSuccess 
}: OAuthCredentialsDialogProps) => {
  const { addToLog } = useAppStore();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      toast.error("Client ID y Client Secret son requeridos");
      return;
    }

    setIsSaving(true);
    addToLog({ level: 'INFO', message: `Guardando credenciales OAuth para ${provider}...` });

    try {
      // Verificar si ya existen credenciales
      const { data: existing } = await supabase
        .from('oauth_credentials')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('provider', provider)
        .maybeSingle();

      if (existing) {
        // Actualizar credenciales existentes
        const { error } = await supabase
          .from('oauth_credentials')
          .update({
            client_id: clientId.trim(),
            client_secret: clientSecret.trim(),
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);

        if (error) throw error;
      } else {
        // Insertar nuevas credenciales
        const { error } = await supabase
          .from('oauth_credentials')
          .insert({
            organization_id: organizationId,
            provider,
            client_id: clientId.trim(),
            client_secret: clientSecret.trim()
          });

        if (error) throw error;
      }

      toast.success(`Credenciales de ${provider === 'google' ? 'Google' : 'QuickBooks'} guardadas`);
      addToLog({ 
        level: 'INFO', 
        message: `Credenciales OAuth para ${provider} guardadas exitosamente` 
      });
      
      setClientId("");
      setClientSecret("");
      onOpenChange(false);
      
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      console.error('Error saving OAuth credentials:', error);
      toast.error('Error al guardar credenciales');
      addToLog({ 
        level: 'ERROR', 
        message: `Error guardando credenciales OAuth: ${error}` 
      });
    } finally {
      setIsSaving(false);
    }
  };

  const providerName = provider === 'google' ? 'Google (Gmail)' : 'QuickBooks Online';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Configurar Credenciales OAuth</DialogTitle>
          <DialogDescription>
            Ingresa las credenciales de {providerName} para habilitar la conexión
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="client-id">Client ID</Label>
            <Input
              id="client-id"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder={provider === 'google' ? 'xxxxx.apps.googleusercontent.com' : 'tu-quickbooks-client-id'}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              {provider === 'google' 
                ? 'Obtenlo desde Google Cloud Console' 
                : 'Obtenlo desde Intuit Developer Portal'}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="client-secret">Client Secret</Label>
            <Input
              id="client-secret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="••••••••••••••••"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Secreto asociado al Client ID
            </p>
          </div>

          <div className="bg-muted/50 p-3 rounded-lg">
            <p className="text-xs text-muted-foreground">
              💡 <strong>Importante:</strong> Estas credenciales se almacenan de forma segura y son necesarias para iniciar el flujo OAuth2.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !clientId.trim() || !clientSecret.trim()}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Guardando...
              </>
            ) : (
              'Guardar Credenciales'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
