import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Plus, Plug, Check, X, Mail, Building2, HardDrive, Loader2, Server } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { OrganizationSwitcher } from "@/components/OrganizationSwitcher";

interface IntegrationAccount {
  id: string;
  service_type: string;
  account_email: string | null;
  account_name: string | null;
  is_active: boolean;
}

interface Organization {
  gmail_connected: boolean;
  gmail_email: string | null;
  outlook_connected: boolean;
  outlook_email: string | null;
  quickbooks_connected: boolean;
  quickbooks_realm_id: string | null;
  google_drive_connected: boolean;
  google_drive_folder_id: string | null;
  bluehost_connected: boolean;
  bluehost_email: string | null;
  hostinger_connected: boolean;
  hostinger_email: string | null;
}

const Integrations = () => {
  const { activeOrganization } = useAuth();
  const [orgData, setOrgData] = useState<Organization | null>(null);
  const [accounts, setAccounts] = useState<IntegrationAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<string>("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountName, setAccountName] = useState("");
  const [bluehostPassword, setBluehostPassword] = useState("");
  const [bluehostHost, setBluehostHost] = useState("mail.cemsacr.com");
  const [bluehostPort, setBluehostPort] = useState("993");
...
      setAccountEmail("");
      setBluehostPassword("");
      setBluehostHost("mail.cemsacr.com");
      setBluehostPort("993");
      setSelectedService("");
...
                    id="bluehost-host"
                    value={bluehostHost}
                    onChange={(e) => setBluehostHost(e.target.value)}
                    placeholder="mail.cemsacr.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bluehost-port">Puerto</Label>
                  <Input
                    id="bluehost-port"
                    value={bluehostPort}
                    onChange={(e) => setBluehostPort(e.target.value)}
                    placeholder="993"
                  />
                </div>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-lg">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  <strong>Nota:</strong> Tus credenciales se almacenan de forma segura y solo se usan para leer correos con facturas.
                </p>
              </div>
            </div>
          ) : selectedService === "hostinger" ? (
            <div className="space-y-4">
              <div className="bg-muted p-4 rounded-lg border border-border">
                <p className="text-sm text-foreground mb-2">
                  <strong>Conexión IMAP con Hostinger</strong>
                </p>
                <p className="text-xs text-muted-foreground">
                  Ingresa tus credenciales de correo Hostinger para recibir facturas automáticamente.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="hostinger-email">
                  Correo electrónico <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="hostinger-email"
                  type="email"
                  value={accountEmail}
                  onChange={(e) => setAccountEmail(e.target.value)}
                  placeholder="facturas@tudominio.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="hostinger-password">
                  Contraseña <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="hostinger-password"
                  type="password"
                  value={hostingerPassword}
                  onChange={(e) => setHostingerPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="hostinger-host">Servidor IMAP</Label>
                  <Input
                    id="hostinger-host"
                    value={hostingerHost}
                    onChange={(e) => setHostingerHost(e.target.value)}
                    placeholder="imap.hostinger.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hostinger-port">Puerto</Label>
                  <Input
                    id="hostinger-port"
                    value={hostingerPort}
                    onChange={(e) => setHostingerPort(e.target.value)}
                    placeholder="993"
                  />
                </div>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-lg">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  <strong>Nota:</strong> Usa la contraseña del <em>buzón</em> de correo (no la del panel). Si tienes 2FA, usa una contraseña de aplicación. Tus credenciales se almacenan de forma segura y solo se usan para leer correos con facturas.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="account-email">
                  Correo electrónico <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="account-email"
                  type="email"
                  value={accountEmail}
                  onChange={(e) => setAccountEmail(e.target.value)}
                  placeholder="ejemplo@gmail.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="account-name">Nombre de la cuenta (opcional)</Label>
                <Input
                  id="account-name"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="Mi cuenta principal"
                />
              </div>

              <div className="bg-muted p-3 rounded-lg">
                <p className="text-xs text-muted-foreground">
                  <strong>Nota:</strong> Para conectar esta cuenta necesitarás autorizar el acceso
                  en {services.find((s) => s.id === selectedService)?.name}. Actualmente esto debe
                  configurarse manualmente mediante OAuth.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={(e) => {
                console.log("🔴 BUTTON CLICKED - selectedService:", selectedService);
                e.preventDefault();
                e.stopPropagation();
                handleAddAccount();
              }}
              type="button"
              disabled={isConnecting}
            >
              {isConnecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Conectando...
                </>
              ) : isLoading && selectedService !== "gmail" && selectedService !== "outlook" && selectedService !== "quickbooks" && selectedService !== "bluehost" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Agregando...
                </>
              ) : (
                selectedService === "gmail" || selectedService === "outlook" || selectedService === "quickbooks" 
                  ? `Conectar con ${services.find((s) => s.id === selectedService)?.name}` 
                  : selectedService === "bluehost"
                  ? "Conectar Bluehost"
                  : "Agregar Cuenta"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Integrations;
