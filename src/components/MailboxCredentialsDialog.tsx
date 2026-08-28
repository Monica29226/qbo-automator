import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Copy, Eye, EyeOff, Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  serviceType: string;
  serviceLabel: string;
}

interface Creds {
  email: string | null;
  password: string | null;
  imap_host: string | null;
  imap_port: number | null;
}

export const MailboxCredentialsDialog = ({
  open,
  onOpenChange,
  organizationId,
  serviceType,
  serviceLabel,
}: Props) => {
  const [loading, setLoading] = useState(false);
  const [creds, setCreds] = useState<Creds | null>(null);
  const [show, setShow] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("reveal-mailbox-credentials", {
        body: { organization_id: organizationId, service_type: serviceType },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "No se pudo obtener la credencial");
      setCreds(data.data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al consultar la credencial");
    } finally {
      setLoading(false);
    }
  };

  const copy = async (value: string | null, label: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copiado`);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setCreds(null);
      setShow(false);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Credenciales de {serviceLabel}</DialogTitle>
          <DialogDescription>
            Acceso restringido a administradores. Cada consulta queda registrada en la bitácora de
            auditoría.
          </DialogDescription>
        </DialogHeader>

        {!creds ? (
          <Button onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Mostrar credenciales
          </Button>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Usuario</Label>
              <div className="flex gap-2">
                <Input readOnly value={creds.email ?? "—"} className="font-mono text-sm" />
                <Button variant="outline" size="icon" onClick={() => copy(creds.email, "Usuario")}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Contraseña</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  type={show ? "text" : "password"}
                  value={creds.password ?? ""}
                  className="font-mono text-sm"
                />
                <Button variant="outline" size="icon" onClick={() => setShow((s) => !s)}>
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copy(creds.password, "Contraseña")}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              {!creds.password && (
                <p className="text-xs text-muted-foreground">
                  No hay contraseña almacenada para esta cuenta.
                </p>
              )}
            </div>

            <div className="text-xs text-muted-foreground">
              Servidor IMAP: {creds.imap_host ?? "—"}
              {creds.imap_port ? `:${creds.imap_port}` : ""}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
