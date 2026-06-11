import { useEffect, useState, useCallback } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";

interface ProviderAlert {
  provider: "gmail" | "outlook" | "bluehost" | "hostinger";
  label: string;
  message: string;
}

const PROVIDER_LABELS: Record<ProviderAlert["provider"], string> = {
  gmail: "Gmail",
  outlook: "Outlook",
  bluehost: "Email IMAP (Bluehost)",
  hostinger: "Email IMAP (Hostinger)",
};

const PRIORITY: ProviderAlert["provider"][] = ["gmail", "outlook", "bluehost", "hostinger"];

/**
 * Detects email-provider connectivity issues for the active organization.
 * Reads credential health via the SECURITY DEFINER RPC `get_email_provider_health`
 * because `integration_accounts` has no client-side SELECT policy by design.
 */
export const GmailTokenAlert = () => {
  const { activeOrganization } = useAuth();
  const navigate = useNavigate();
  const [alert, setAlert] = useState<ProviderAlert | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);

  const checkTokenStatus = useCallback(async () => {
    if (!activeOrganization) return;
    try {
      const { data: org } = await supabase
        .from("organizations")
        .select("gmail_connected, outlook_connected, bluehost_connected, hostinger_connected")
        .eq("id", activeOrganization)
        .single();

      if (!org) {
        setAlert(null);
        return;
      }

      const flags: Record<ProviderAlert["provider"], boolean> = {
        gmail: !!org.gmail_connected,
        outlook: !!org.outlook_connected,
        bluehost: !!org.bluehost_connected,
        hostinger: !!org.hostinger_connected,
      };

      const activeProvider = PRIORITY.find((p) => flags[p]);
      if (!activeProvider) {
        setAlert(null);
        return;
      }

      const { data: health, error } = await supabase.rpc("get_email_provider_health", {
        _org_id: activeOrganization,
      });

      if (error) {
        // Surface the failure instead of hiding it — a silent null read as
        // "connection fine" even when we never verified it.
        setAlert({
          provider: activeProvider,
          label: PROVIDER_LABELS[activeProvider],
          message: `No se pudo verificar la conexión de ${PROVIDER_LABELS[activeProvider]}. Si las facturas no están entrando, reconéctela desde Integraciones.`,
        });
        return;
      }

      const rows = (health ?? []) as Array<{
        service_type: string;
        is_active: boolean;
        has_credentials: boolean;
      }>;

      const match = rows.find((r) => {
        if (activeProvider === "outlook") {
          return r.service_type === "outlook" || r.service_type === "outlook_imap";
        }
        return r.service_type === activeProvider;
      });

      if (!match || !match.is_active) {
        setAlert({
          provider: activeProvider,
          label: PROVIDER_LABELS[activeProvider],
          message: `La conexión de ${PROVIDER_LABELS[activeProvider]} necesita ser restablecida. Por favor reconéctela desde Integraciones.`,
        });
        return;
      }

      if (!match.has_credentials) {
        const isImap = activeProvider === "bluehost" || activeProvider === "hostinger";
        setAlert({
          provider: activeProvider,
          label: PROVIDER_LABELS[activeProvider],
          message: isImap
            ? `Las credenciales IMAP de ${PROVIDER_LABELS[activeProvider]} están incompletas. Por favor reconfígurelas.`
            : `Las credenciales de ${PROVIDER_LABELS[activeProvider]} están incompletas. Por favor reconéctela.`,
        });
        return;
      }

      setAlert(null);
    } catch (err) {
      console.error("Error checking email provider status:", err);
      setAlert(null);
    }
  }, [activeOrganization]);

  useEffect(() => {
    if (!activeOrganization || isDismissed) return;

    checkTokenStatus();
    const interval = setInterval(checkTokenStatus, 60 * 1000);

    const onRefresh = () => checkTokenStatus();
    const onVisibility = () => {
      if (document.visibilityState === "visible") checkTokenStatus();
    };

    window.addEventListener("dashboard:refresh", onRefresh);
    window.addEventListener("integrations:updated", onRefresh);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(interval);
      window.removeEventListener("dashboard:refresh", onRefresh);
      window.removeEventListener("integrations:updated", onRefresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [activeOrganization, isDismissed, checkTokenStatus]);

  // Reset dismissed state when switching organizations
  useEffect(() => {
    setIsDismissed(false);
  }, [activeOrganization]);

  const handleReconnect = () => {
    navigate("/integrations");
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    setAlert(null);
  };

  if (!alert) return null;

  return (
    <Alert variant="destructive" className="mb-4 relative">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="flex items-center justify-between">
        {alert.label} desconectado
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
        <Button onClick={handleReconnect} variant="outline" size="sm" className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Reconectar {alert.label}
        </Button>
      </AlertDescription>
    </Alert>
  );
};
