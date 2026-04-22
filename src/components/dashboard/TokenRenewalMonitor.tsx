import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { RefreshCw, CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import { toast } from "sonner";

interface TokenStatus {
  expires_at: string;
  minutes_until_expiry: number;
  status: "healthy" | "warning" | "critical" | "expired" | "unknown";
}

export const TokenRenewalMonitor = () => {
  const [tokenStatus, setTokenStatus] = useState<TokenStatus | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [renewing, setRenewing] = useState(false);

  const fetchTokenStatus = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: activeOrg } = await supabase
        .from("user_active_organization")
        .select("organization_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!activeOrg?.organization_id) {
        setTokenStatus(null);
        return;
      }
      setOrganizationId(activeOrg.organization_id);

      const { data: qboAccount } = await supabase
        .from("integration_accounts")
        .select("credentials, is_active")
        .eq("organization_id", activeOrg.organization_id)
        .eq("service_type", "quickbooks")
        .eq("is_active", true)
        .maybeSingle();

      if (!qboAccount?.credentials) {
        setTokenStatus(null);
        return;
      }

      const credentials = qboAccount.credentials as any;
      const expiresAt = new Date(credentials.expires_at);
      const minutesUntilExpiry = (expiresAt.getTime() - Date.now()) / (1000 * 60);

      let status: TokenStatus["status"] = "healthy";
      if (minutesUntilExpiry < 0) status = "expired";
      else if (minutesUntilExpiry < 5) status = "critical";
      else if (minutesUntilExpiry < 30) status = "warning";

      setTokenStatus({
        expires_at: credentials.expires_at,
        minutes_until_expiry: minutesUntilExpiry,
        status,
      });
    } catch (error) {
      console.error("Error fetching token status:", error);
      setTokenStatus({ expires_at: "", minutes_until_expiry: 0, status: "unknown" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTokenStatus();
    // Refresh every minute for real-time countdown
    const interval = setInterval(fetchTokenStatus, 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchTokenStatus]);

  const handleRenew = async () => {
    setRenewing(true);
    try {
      toast.info("🔄 Renovando token de QuickBooks...");
      const { data, error } = await supabase.functions.invoke("auto-renew-tokens", {
        body: { organization_id: organizationId },
      });
      if (error) throw error;

      const result = data as { renewed: number; expired: number; failed: number };
      if (result.renewed > 0) {
        toast.success("✅ Token renovado exitosamente");
        await fetchTokenStatus();
      } else if (result.failed > 0) {
        toast.error("❌ Renovación falló - puede requerir reconexión", {
          description: "Ve a Integraciones para reconectar QuickBooks si el problema persiste",
        });
      } else {
        toast.info("Token aún no requiere renovación");
        await fetchTokenStatus();
      }
    } catch (error) {
      console.error("Error renewing token:", error);
      toast.error("Error al renovar token");
    } finally {
      setRenewing(false);
    }
  };

  if (loading || !tokenStatus) return null;

  const formatTimeLeft = (minutes: number): string => {
    const abs = Math.abs(minutes);
    if (abs < 60) return `${Math.floor(abs)} min`;
    const hours = Math.floor(abs / 60);
    const mins = Math.floor(abs % 60);
    if (hours < 24) return `${hours}h ${mins}m`;
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days}d ${remHours}h`;
  };

  const getStatusIcon = () => {
    switch (tokenStatus.status) {
      case "healthy": return <CheckCircle className="h-4 w-4 text-success" />;
      case "warning": return <AlertTriangle className="h-4 w-4 text-warning" />;
      case "critical":
      case "expired": return <XCircle className="h-4 w-4 text-destructive" />;
      default: return <AlertTriangle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = () => {
    const timeLeft = formatTimeLeft(tokenStatus.minutes_until_expiry);
    if (tokenStatus.status === "expired") {
      return <Badge variant="destructive">Expirado hace {timeLeft}</Badge>;
    }
    if (tokenStatus.status === "critical") {
      return <Badge variant="destructive">Crítico: {timeLeft}</Badge>;
    }
    if (tokenStatus.status === "warning") {
      return <Badge variant="secondary" className="bg-warning/20 text-warning">Expira en {timeLeft}</Badge>;
    }
    return <Badge variant="secondary" className="bg-success/20 text-success">Válido por {timeLeft}</Badge>;
  };

  const cardClass = tokenStatus.status === "expired" || tokenStatus.status === "critical"
    ? "border-destructive"
    : tokenStatus.status === "warning"
      ? "border-warning"
      : "";

  const description = (() => {
    switch (tokenStatus.status) {
      case "expired":
        return "El token de QuickBooks ha expirado. Las publicaciones están bloqueadas hasta renovar.";
      case "critical":
        return "El token expira en menos de 5 minutos. Renueva ahora para evitar bloqueos.";
      case "warning":
        return "El token expirará pronto. La renovación automática se activará al publicar.";
      default:
        return "Token activo. Renovación automática programada cada hora.";
    }
  })();

  return (
    <Card className={cardClass}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {getStatusIcon()}
          Token QuickBooks
          {getStatusBadge()}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{description}</p>
        <Button
          onClick={handleRenew}
          disabled={renewing}
          size="sm"
          variant={tokenStatus.status === "expired" || tokenStatus.status === "critical" ? "destructive" : "default"}
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
