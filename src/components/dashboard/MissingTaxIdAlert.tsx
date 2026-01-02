import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

interface MissingTaxIdAlertProps {
  organizationId: string | null;
}

export const MissingTaxIdAlert = ({ organizationId }: MissingTaxIdAlertProps) => {
  const [isMissing, setIsMissing] = useState(false);
  const [orgName, setOrgName] = useState("");

  useEffect(() => {
    const checkTaxId = async () => {
      if (!organizationId) return;

      const { data, error } = await supabase
        .from("organizations")
        .select("name, tax_id")
        .eq("id", organizationId)
        .maybeSingle();

      if (!error && data) {
        setOrgName(data.name);
        setIsMissing(!data.tax_id);
      }
    };

    checkTaxId();
  }, [organizationId]);

  if (!isMissing) return null;

  return (
    <Alert variant="destructive" className="mb-4 border-destructive/50 bg-destructive/10">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="font-semibold">Cédula Jurídica no Configurada</AlertTitle>
      <AlertDescription className="mt-2">
        <p className="mb-3">
          La organización <strong>{orgName}</strong> no tiene configurada su cédula jurídica. 
          Las nuevas facturas <strong>no podrán importarse</strong> porque el sistema no puede validar 
          que pertenezcan a esta empresa.
        </p>
        <Button asChild size="sm" variant="outline" className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground">
          <Link to="/my-company">
            <Building2 className="h-4 w-4 mr-2" />
            Configurar en Mi Empresa
          </Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
};
