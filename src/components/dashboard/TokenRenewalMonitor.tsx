import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { RefreshCw, CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import { toast } from "sonner";

interface TokenStatus {
  expires_at: string;
  hours_until_expiry: number;
  status: "healthy" | "warning" | "expired" | "unknown";
}

export const TokenRenewalMonitor = () => {
  const [tokenStatus, setTokenStatus] = useState<TokenStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [renewing, setRenewing] = useState(false);

  useEffect(() => {
    fetchTokenStatus();
    // Verificar cada 30 minutos
    const interval = setInterval(fetchTokenStatus, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const fetchTokenStatus = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: activeOrg } = await supabase
        .from("user_active_organization")
        .select("organization_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!activeOrg?.organization_id) return;

      const { data: qboAccount } = await supabase
        .from("integration_accounts")
        .select("credentials")
        .eq("organization_id", activeOrg.organization_id)
        .eq("service_type", "quickbooks")
        .eq("is_active", true)
        .maybeSingle();

      if (qboAccount?.credentials) {
        const credentials = qboAccount.credentials as any;
        const expiresAt = new Date(credentials.expires_at);
        const now = new Date();
        const hoursUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);

        let status: TokenStatus["status"] = "healthy";
        if (hoursUntilExpiry < 0) {
          status = "expired";
        } else if (hoursUntilExpiry < 24) {
          status = "warning";
        }

        setTokenStatus({
          expires_at: credentials.expires_at,
          hours_until_expiry: hoursUntilExpiry,
          status,
        });
      }
    } catch (error) {
      console.error("Error fetching token status:", error);
      setTokenStatus({
        expires_at: "",
        hours_until_expiry: 0,
        status: "unknown",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRenew = async () => {
    setRenewing(true);
    try {
      toast.info("🔄 Renovando token de QuickBooks...");

      const { data, error } = await supabase.functions.invoke("auto-renew-tokens", {
        body: {},
      });

      if (error) throw error;

      const result = data as {
        renewed: number;
        expired: number;
        failed: number;
      };

      if (result.renewed > 0) {
        toast.success("✅ Token renovado exitosamente");
        await fetchTokenStatus();
      } else if (result.expired > 0 && result.failed > 0) {
        toast.error("❌ Token expirado - requiere reconexión manual", {
          description: "Ve a Integraciones para reconectar QuickBooks",
        });
      } else {
        toast.info("Token no requiere renovación");
      }
    } catch (error) {
      console.error("Error renewing token:", error);
      toast.error("Error al renovar token");
    } finally {
      setRenewing(false);
    }
  };

  if (loading || !tokenStatus) {
    return null;
  }

  const getStatusIcon = () => {
    switch (tokenStatus.status) {
      case "healthy":
        return <CheckCircle className="h-4 w-4 text-success" />;
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-warning" />;
      case "expired":
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = () => {
    const hours = Math.abs(tokenStatus.hours_until_expiry);
    const days = Math.floor(hours / 24);
    const remainingHours = Math.floor(hours % 24);

    if (tokenStatus.status === "expired") {
      return (
        <Badge variant="destructive">
          Expiró hace {days > 0 ? `${days}d ` : ""}{remainingHours}h
        </Badge>
      );
    }

    if (tokenStatus.status === "warning") {
      return (
        <Badge variant="secondary" className="bg-warning/10 text-warning">
          Expira en {remainingHours}h
        </Badge>
      );
    }

    return (
      <Badge variant="secondary" className="bg-success/10 text-success">
        Válido por {days > 0 ? `${days}d ` : ""}{remainingHours}h
        </Badge>
    );
  };

  // Solo mostrar si está en warning o expired
  if (tokenStatus.status !== "warning" && tokenStatus.status !== "expired") {
    return null;
  }

  return (
    <Card className="border-warning">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {getStatusIcon()}
          Token QuickBooks
          {getStatusBadge()}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {tokenStatus.status === "expired" 
            ? "El token de QuickBooks ha expirado. Renuévalo ahora o reconecta la integración."
            : "El token expirará pronto. Renovación automática recomendada."}
        </p>
        <Button
          onClick={handleRenew}
          disabled={renewing}
          size="sm"
          variant={tokenStatus.status === "expired" ? "destructive" : "default"}
          className="w-full"
        >
          {renewing ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Renovando...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Renovar Token Ahora
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
};
