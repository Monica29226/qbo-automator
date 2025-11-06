import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface AICreditsMonitorProps {
  organizationId: string | null;
}

export const AICreditsMonitor = ({ organizationId }: AICreditsMonitorProps) => {
  const [creditErrorCount, setCreditErrorCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!organizationId) return;
    
    checkCreditErrors();
    
    // Refresh every 5 minutes
    const interval = setInterval(checkCreditErrors, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [organizationId]);

  const checkCreditErrors = async () => {
    if (!organizationId) return;
    
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const { data: recentErrors } = await supabase
        .from("processed_documents")
        .select("error_message, created_at")
        .eq("organization_id", organizationId)
        .eq("status", "error")
        .gte("created_at", yesterday.toISOString());
      
      const creditErrors = recentErrors?.filter(e => 
        e.error_message?.toLowerCase().includes("payment required") ||
        e.error_message?.toLowerCase().includes("credits") ||
        e.error_message?.toLowerCase().includes("402")
      ).length || 0;
      
      setCreditErrorCount(creditErrors);
    } catch (error) {
      console.error("Error checking AI credits:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || creditErrorCount <= 5) {
    return null;
  }

  return (
    <Alert variant="destructive" className="mb-6">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Créditos de IA Agotados</AlertTitle>
      <AlertDescription className="mt-2">
        <p className="mb-3">
          {creditErrorCount} facturas no se pudieron procesar en las últimas 24 horas debido a falta de créditos de IA.
        </p>
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => window.open("https://docs.lovable.dev/features/ai", "_blank")}
          className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
        >
          <ExternalLink className="h-4 w-4 mr-2" />
          Ver cómo agregar créditos
        </Button>
      </AlertDescription>
    </Alert>
  );
};
