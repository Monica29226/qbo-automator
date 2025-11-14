import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface TokenAlert {
  type: "expiring" | "failed";
  message: string;
  expiresIn?: number;
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
        // Obtener cuenta de Gmail activa
        const { data: gmailAccount } = await supabase
          .from("integration_accounts")
          .select("*")
          .eq("organization_id", activeOrganization)
          .eq("service_type", "gmail")
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (!gmailAccount) return;

        const credentials = gmailAccount.credentials as any;
        if (!credentials?.expires_at) return;

        const expiresAt = typeof credentials.expires_at === 'string'
          ? new Date(credentials.expires_at).getTime()
          : credentials.expires_at;

        const now = Date.now();
        const hoursUntilExpiration = (expiresAt - now) / (1000 * 60 * 60);

        // Token expirado o próximo a expirar (menos de 24 horas)
        if (hoursUntilExpiration < 0) {
          setAlert({
            type: "failed",
            message: "El token de Gmail ha expirado. Reconecta tu cuenta para continuar sincronizando facturas.",
          });
        } else if (hoursUntilExpiration < 24) {
          setAlert({
            type: "expiring",
            message: `El token de Gmail expirará en ${Math.floor(hoursUntilExpiration)} horas. Se renovará automáticamente en la próxima sincronización.`,
            expiresIn: Math.floor(hoursUntilExpiration),
          });
        } else {
          setAlert(null);
        }
      } catch (error) {
        console.error("Error checking token status:", error);
      }
    };

    checkTokenStatus();
    
    // Verificar cada 5 minutos
    const interval = setInterval(checkTokenStatus, 5 * 60 * 1000);
    
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
      variant={alert.type === "failed" ? "destructive" : "default"}
      className="mb-4 relative"
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="flex items-center justify-between">
        {alert.type === "failed" ? "Token de Gmail Expirado" : "Token de Gmail Próximo a Expirar"}
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
        {alert.type === "failed" && (
          <Button 
            onClick={handleReconnect} 
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Reconectar Gmail
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
};
