import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ExternalLink, Server, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: () => void;
}

export const OutlookImapConnectDialog = ({ open, onOpenChange, onConnected }: Props) => {
  const { activeOrganization } = useAuth();
  const [email, setEmail] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [host, setHost] = useState("outlook.office365.com");
  const [port, setPort] = useState("993");
  const [loading, setLoading] = useState(false);
  const emailDomain = email.trim().toLowerCase().split("@")[1] || "";
  const isPersonalMicrosoftAccount = ["hotmail.com", "outlook.com", "live.com", "msn.com"].includes(emailDomain);

  const handleConnect = async () => {
    if (!activeOrganization) return toast.error("No hay organización activa");
    if (!email || !appPassword) return toast.error("Email y contraseña de aplicación son requeridos");
    if (isPersonalMicrosoftAccount) {
      toast.error("Hotmail, Outlook.com, Live y MSN deben conectarse con Microsoft OAuth, no con IMAP avanzado.", { duration: 10000 });
      return;
    }

    setLoading(true);
    const t = toast.loading("Probando conexión IMAP con Microsoft 365...");

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuario no autenticado");

      const { data, error } = await supabase.functions.invoke("outlook-imap-connect", {
        body: {
          organization_id: activeOrganization,
          user_id: user.id,
          email,
          password: appPassword,
          imap_host: host,
          imap_port: parseInt(port),
        },
      });

      toast.dismiss(t);

      if (error) throw error;

      if (data?.success === false) {
        toast.error(data.message || "No se pudo conectar", { duration: 10000 });
        return;
      }

      toast.success(`Microsoft 365 IMAP conectado: ${data.email || email}`);
      setEmail("");
      setAppPassword("");
      onOpenChange(false);
      onConnected?.();
    } catch (e: any) {
      toast.dismiss(t);
      toast.error("Error: " + (e?.message || "desconocido"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Conectar Microsoft 365 empresarial vía IMAP
          </DialogTitle>
          <DialogDescription>
            Opción avanzada solo para buzones empresariales cuando el administrador de TI bloquea OAuth.
            Hotmail, Outlook.com, Live y MSN deben usar la conexión segura con Microsoft.
          </DialogDescription>
        </DialogHeader>

        {isPersonalMicrosoftAccount && (
          <Alert variant="destructive">
            <Info className="h-4 w-4" />
            <AlertDescription>
              Esta cuenta es personal de Microsoft. No use IMAP avanzado para Hotmail; cierre esta ventana y presione
              <strong> Conectar con Microsoft (OAuth)</strong> en la tarjeta de Outlook / Hotmail / Microsoft 365.
            </AlertDescription>
          </Alert>
        )}

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="space-y-2">
            <p className="font-semibold">Para buzones Microsoft 365 empresariales:</p>
            <ol className="list-decimal pl-5 space-y-1 text-sm">
              <li>Entra a{" "}
                <a
                  href="https://account.microsoft.com/security"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline inline-flex items-center gap-1"
                >
                  account.microsoft.com/security <ExternalLink className="h-3 w-3" />
                </a>
              </li>
              <li>Ve a <strong>Seguridad</strong> → <strong>Opciones de seguridad avanzadas</strong></li>
              <li>Bajo <strong>"Contraseñas de aplicación"</strong> → <strong>"Crear una nueva contraseña de aplicación"</strong></li>
              <li>Copia la contraseña (solo se muestra una vez)</li>
              <li>Pégala abajo</li>
            </ol>
            <p className="text-xs text-muted-foreground pt-2">
              Si la cuenta es de Microsoft 365 empresarial, el administrador de TI debe habilitar IMAP y la autenticación permitida para ese buzón.
            </p>
          </AlertDescription>
        </Alert>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="o365-email">Email de Microsoft 365</Label>
            <Input
              id="o365-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@miempresa.com"
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">
              Para hotmail.com, outlook.com, live.com o msn.com use Microsoft OAuth, no este formulario.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="o365-pass">Contraseña de aplicación</Label>
            <Input
              id="o365-pass"
              type="password"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              placeholder="xxxxxxxxxxxxxxxx"
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">No es la contraseña habitual; es la contraseña de aplicación empresarial generada en Microsoft 365.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="o365-host">Servidor IMAP</Label>
              <Input id="o365-host" value={host} onChange={(e) => setHost(e.target.value)} disabled={loading} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="o365-port">Puerto</Label>
              <Input id="o365-port" value={port} onChange={(e) => setPort(e.target.value)} disabled={loading} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancelar</Button>
          <Button onClick={handleConnect} disabled={loading || isPersonalMicrosoftAccount}>
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Conectar y probar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default OutlookImapConnectDialog;
