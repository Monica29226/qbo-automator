import { useEffect, useState } from "react";
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

/**
 * Detects email-provider connectivity issues for the active organization.
 * Only surfaces an alert when the org claims a provider is connected but
 * the corresponding integration_account is missing/inactive/incomplete.
 * Stays silent when no provider is configured (normal state for new orgs).
 */
export const GmailTokenAlert = () => {
  const { activeOrganization } = useAuth();
  const navigate = useNavigate();
  const [alert, setAlert] = useState<ProviderAlert | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    if (!activeOrganization || isDismissed) return;

    const checkTokenStatus = async () => {
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

        // Determine which provider this org actively uses (priority matches auto-sync-invoices)
        const providers: ProviderAlert["provider"][] = [];
        if (org.gmail_connected) providers.push("gmail");
        if (org.outlook_connected) providers.push("outlook");
        if (org.bluehost_connected) providers.push("bluehost");
        if (org.hostinger_connected) providers.push("hostinger");

        if (providers.length === 0) {
          setAlert(null);
          return;
        }

        const activeProvider = providers[0];

        const { data: account } = await supabase
          .from("integration_accounts")
          .select("credentials, is_active")
          .eq("organization_id", activeOrganization)
          .eq("service_type", activeProvider)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!account) {
          setAlert({
            provider: activeProvider,
            label: PROVIDER_LABELS[activeProvider],
            message: `La conexión de ${PROVIDER_LABELS[activeProvider]} necesita ser restablecida. Por favor reconéctela desde Integraciones.`,
          });
          return;
        }

        const credentials = account.credentials as Record<string, unknown> | null;

        // OAuth providers need a refresh_token; IMAP providers need host + password
        if (activeProvider === "gmail" || activeProvider === "outlook") {
          if (!credentials?.refresh_token) {
            setAlert({
              provider: activeProvider,
              label: PROVIDER_LABELS[activeProvider],
              message: `Las credenciales de ${PROVIDER_LABELS[activeProvider]} están incompletas. Por favor reconéctela.`,
            });
            return;
          }
        } else {
          // bluehost / hostinger
          if (!credentials?.password || !credentials?.imap_host) {
            setAlert({
              provider: activeProvider,
              label: PROVIDER_LABELS[activeProvider],
              message: `Las credenciales IMAP de ${PROVIDER_LABELS[activeProvider]} están incompletas. Por favor reconfígurelas.`,
            });
            return;
          }
        }

        setAlert(null);
      } catch (error) {
        console.error("Error checking email provider status:", error);
        setAlert(null);
      }
    };

    checkTokenStatus();
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
