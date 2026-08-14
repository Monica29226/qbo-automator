import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";

interface TokenAlert {
  type: "expiring" | "failed" | "disconnected";
  message: string;
  expiresIn?: number;
}

const TITLES: Record<TokenAlert["type"], string> = {
  disconnected: "QuickBooks Desconectado",
  failed: "Token de QuickBooks Expirado",
  expiring: "Token de QuickBooks Próximo a Expirar",
};

export const QuickBooksTokenAlert = () => {
  const { activeOrganization } = useAuth();
  const navigate = useNavigate();
  const [alert, setAlert] = useState<TokenAlert | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    if (!activeOrganization || isDismissed) return;

    const checkTokenStatus = async () => {
      try {
        // RPC segura: informa estado de la conexión sin exponer credenciales
        const { data, error } = await supabase.rpc("get_qbo_connection_status", {
          _org_id: activeOrganization,
        });

        if (error) {
          console.error("Error checking QuickBooks connection:", error);
          return;
        }

        const status = Array.isArray(data) ? data[0] : data;

        // Sin registro de QuickBooks: la empresa nunca lo conectó, no alertamos aquí
        if (!status) {
          setAlert(null);
          return;
        }

        // Conexión desactivada (token revocado o renovación fallida):
        // este es el caso que dejaba de publicar en silencio
        if (!status.is_active) {
          setAlert({
            type: "disconnected",
            message:
              "La conexión con QuickBooks de esta empresa está inactiva. Mientras no se reconecte, las facturas se reciben pero NO se publican en QuickBooks.",
          });
          return;
        }

        const expiresAtMs = status.expires_at_ms
          ? Number(status.expires_at_ms)
          : null;

        if (!expiresAtMs) {
          setAlert(null);
          return;
        }

        const minutesUntilExpiration = (expiresAtMs - Date.now()) / (1000 * 60);

        if (minutesUntilExpiration < 0) {
          setAlert({
            type: "failed",
            message:
              "El token de QuickBooks ha expirado. Reconecta la cuenta para continuar publicando facturas.",
          });
        } else if (minutesUntilExpiration < 5) {
          setAlert({
            type: "expiring",
            message: `El token de QuickBooks expirará en menos de ${Math.ceil(
              minutesUntilExpiration
            )} minutos. La renovación automática se ejecutará pronto.`,
            expiresIn: Math.ceil(minutesUntilExpiration),
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
      variant={alert.type === "expiring" ? "default" : "destructive"}
      className="mb-4 relative"
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="flex items-center justify-between">
        {TITLES[alert.type]}
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
        {alert.type === "expiring" && (
          <p className="text-xs text-muted-foreground">
            La renovación se ejecuta automáticamente cada hora.
          </p>
        )}
        {alert.type !== "expiring" && (
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
