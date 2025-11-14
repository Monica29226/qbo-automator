import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";

interface TokenAlert {
  type: "expiring" | "failed";
  message: string;
  expiresIn?: number;
}

export const QuickBooksTokenAlert = () => {
  const { activeOrganization } = useAuth();
  const navigate = useNavigate();
  const [alert, setAlert] = useState<TokenAlert | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    if (!activeOrganization || isDismissed) return;

    const checkTokenStatus = async () => {
      try {
        const { data: qboAccount } = await supabase
          .from("integration_accounts")
          .select("*")
          .eq("organization_id", activeOrganization)
          .eq("service_type", "quickbooks")
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (!qboAccount) return;

        const credentials = qboAccount.credentials as any;
        if (!credentials?.expires_at) return;

        // Manejar tanto timestamp numérico como ISO string
        const expiresAt = typeof credentials.expires_at === 'string'
          ? new Date(credentials.expires_at).getTime()
          : credentials.expires_at;

        const now = Date.now();
        const hoursUntilExpiration = (expiresAt - now) / (1000 * 60 * 60);

        // Token expirado o próximo a expirar (menos de 48 horas)
        if (hoursUntilExpiration < 0) {
          setAlert({
            type: "failed",
            message: "El token de QuickBooks ha expirado. Reconecta tu cuenta para continuar publicando facturas.",
          });
        } else if (hoursUntilExpiration < 48) {
          setAlert({
            type: "expiring",
            message: `El token de QuickBooks expirará en ${Math.floor(hoursUntilExpiration)} horas. Se renovará automáticamente en las próximas horas.`,
            expiresIn: Math.floor(hoursUntilExpiration),
          });
        } else {
          setAlert(null);
        }
      } catch (error) {
        console.error("Error checking QuickBooks token status:", error);
      }
    };

    checkTokenStatus();
    
    // Verificar cada 15 minutos
    const interval = setInterval(checkTokenStatus, 15 * 60 * 1000);
    
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
        {alert.type === "failed" ? "Token de QuickBooks Expirado" : "Token de QuickBooks Próximo a Expirar"}
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
            Reconectar QuickBooks
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
};
