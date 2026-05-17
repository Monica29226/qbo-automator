import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  organizationId: string;
}

export function OnboardingBanner({ organizationId }: Props) {
  const [data, setData] = useState<any | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from("onboarding_progress")
        .select("current_step,completed_steps,completed_at")
        .eq("organization_id", organizationId)
        .maybeSingle();
      setData(data);
    })();
  }, [organizationId]);

  if (!data || data.completed_at) return null;

  const done = (data.completed_steps ?? []).length;
  const pct = (done / 7) * 100;

  return (
    <Alert className="border-amber-500/40 bg-amber-50 dark:bg-amber-950/20">
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <AlertTitle>Configuración incompleta ({done}/7)</AlertTitle>
      <AlertDescription className="space-y-3 mt-2">
        <Progress value={pct} className="h-2" />
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Termina la configuración para empezar a recibir y publicar facturas.</span>
          <Button size="sm" asChild>
            <Link to={`/onboarding/${organizationId}`}>
              Continuar wizard <ArrowRight className="h-4 w-4 ml-1" />
            </Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
