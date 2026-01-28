import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";

interface TokenAlert {
  type: "disconnected" | "expiring";
  message: string;
}

export const GmailTokenAlert = () => {
  const { activeOrganization } = useAuth();
  const navigate = useNavigate();
  const [alert, setAlert] = useState<TokenAlert | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    if (!activeOrganization || isDismissed) return;

    const checkTokenStatus = async () => {
      try {
        // Verificar si Gmail está conectado en la organización
        const { data: org } = await supabase
          .from("organizations")
          .select("gmail_connected")
          .eq("id", activeOrganization)
          .single();

        if (!org?.gmail_connected) {
          // Gmail no está conectado - no mostrar alerta (es estado normal)
          setAlert(null);
          return;
        }

        // Obtener cuenta de Gmail activa
        const { data: gmailAccount } = await supabase
          .from("integration_accounts")
          .select("*")
          .eq("organization_id", activeOrganization)
          .eq("service_type", "gmail")
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        // Si no hay cuenta activa pero org dice conectado, hay inconsistencia
        if (!gmailAccount) {
          setAlert({
            type: "disconnected",
            message: "La conexión de Gmail necesita ser restablecida. Por favor reconecte su cuenta.",
          });
          return;
        }

        const credentials = gmailAccount.credentials as any;
        
        // Solo verificar si hay refresh_token - Gmail se auto-renueva con refresh token
        // El access_token expira cada hora pero se renueva automáticamente
        if (!credentials?.refresh_token) {
          setAlert({
            type: "disconnected",
            message: "Las credenciales de Gmail están incompletas. Por favor reconecte su cuenta.",
          });
          return;
        }

        // Gmail con refresh_token válido = conexión OK
        // No mostrar alertas por access_token expirado, ya que se renueva automáticamente
        setAlert(null);
        
      } catch (error) {
        console.error("Error checking Gmail token status:", error);
        setAlert(null);
      }
    };

    checkTokenStatus();
    
    // Verificar cada 10 minutos
    const interval = setInterval(checkTokenStatus, 10 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, [activeOrganization, isDismissed]);

  const handleReconnect = () => {
    navigate("/integrations");
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    setAlert(null);
  };

  if (!alert) return null;

  return (
    <Alert 
      variant="destructive"
      className="mb-4 relative"
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="flex items-center justify-between">
        Gmail Desconectado
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 absolute right-2 top-2"
          onClick={handleDismiss}
        >
          <X className="h-4 w-4" />
        </Button>
      </AlertTitle>
      <AlertDescription className="mt-2">
        <p className="mb-3">{alert.message}</p>
        <Button 
          onClick={handleReconnect} 
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Reconectar Gmail
        </Button>
      </AlertDescription>
    </Alert>
  );
};
