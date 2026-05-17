import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Cloud, CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SharePointKpiCard({ organizationId }: { organizationId?: string | null }) {
  const [hasAccount, setHasAccount] = useState<boolean | null>(null);
  const [uploaded, setUploaded] = useState(0);
  const [published, setPublished] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: acc } = await supabase
        .from("sharepoint_admin_account")
        .select("id")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      setHasAccount(!!acc);

      if (organizationId) {
        const startMonth = new Date();
        startMonth.setUTCDate(1);
        startMonth.setUTCHours(0, 0, 0, 0);
        const iso = startMonth.toISOString();

        const [{ count: up }, { count: pub }] = await Promise.all([
          supabase.from("processed_documents")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .gte("sharepoint_uploaded_at", iso),
          supabase.from("processed_documents")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .not("qbo_entity_id", "is", null)
            .gte("processed_at", iso),
        ]);
        setUploaded(up || 0);
        setPublished(pub || 0);
      }
      setLoading(false);
    })();
  }, [organizationId]);

  if (loading) return null;

  if (!hasAccount) {
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CloudOff className="h-4 w-4" /> SharePoint no conectado
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Link to="/admin/sharepoint-setup">
            <Button size="sm" variant="outline">Configurar</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const pct = published > 0 ? Math.round((uploaded / published) * 100) : 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Cloud className="h-4 w-4 text-primary" /> SharePoint este mes
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{uploaded}</div>
        <div className="text-xs text-muted-foreground">{pct}% del total publicado ({published})</div>
      </CardContent>
    </Card>
  );
}
