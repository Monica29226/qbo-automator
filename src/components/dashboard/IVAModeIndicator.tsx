import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Receipt } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

interface IVAModeIndicatorProps {
  organizationId: string | null;
}

export const IVAModeIndicator = ({ organizationId }: IVAModeIndicatorProps) => {
  const [ivaRecoverable, setIvaRecoverable] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!organizationId) {
      setIsLoading(false);
      return;
    }

    const fetchIVAConfig = async () => {
      const { data, error } = await supabase
        .from("system_settings")
        .select("value")
        .eq("organization_id", organizationId)
        .eq("key", "default_uses_tax")
        .maybeSingle();

      if (error) {
        console.error("Error fetching IVA config:", error);
      }

      // Default to true (IVA recoverable) if not set
      setIvaRecoverable(data?.value !== "false");
      setIsLoading(false);
    };

    fetchIVAConfig();
  }, [organizationId]);

  if (isLoading || ivaRecoverable === null) {
    return null;
  }

  return (
    <Link to="/settings" className="no-underline">
      <Badge 
        variant={ivaRecoverable ? "default" : "secondary"}
        className={`cursor-pointer transition-all hover:opacity-80 ${
          ivaRecoverable 
            ? "bg-emerald-600 hover:bg-emerald-700 text-white" 
            : "bg-amber-600 hover:bg-amber-700 text-white"
        }`}
        title={ivaRecoverable 
          ? "El IVA se registra como crédito fiscal recuperable" 
          : "El IVA se incluye como parte del gasto"
        }
      >
        {ivaRecoverable ? (
          <>
            <DollarSign className="h-3 w-3 mr-1" />
            IVA Recuperable
          </>
        ) : (
          <>
            <Receipt className="h-3 w-3 mr-1" />
            IVA como Gasto
          </>
        )}
      </Badge>
    </Link>
  );
};
