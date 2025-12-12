import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Calendar, CheckCircle2, XCircle, Clock, TrendingUp } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface TodayStats {
  published: number;
  errors: number;
  pending: number;
  total_amount: number;
}

export const TodayProcessingReport = () => {
  const [stats, setStats] = useState<TodayStats>({
    published: 0,
    errors: 0,
    pending: 0,
    total_amount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  const fetchTodayStats = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: activeOrg } = await supabase
        .from("user_active_organization")
        .select("organization_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!activeOrg?.organization_id) return;

      setOrganizationId(activeOrg.organization_id);

      const today = format(new Date(), "yyyy-MM-dd");

      const { data: documents } = await supabase
        .from("processed_documents")
        .select("status, total_amount")
        .eq("organization_id", activeOrg.organization_id)
        .gte("created_at", `${today}T00:00:00`)
        .lte("created_at", `${today}T23:59:59`);

      if (documents) {
        const published = documents.filter(d => d.status === "published").length;
        const errors = documents.filter(d => d.status === "error").length;
        const pending = documents.filter(d => d.status === "pending").length;
        const total_amount = documents
          .filter(d => d.status === "published")
          .reduce((sum, d) => sum + Math.abs(d.total_amount), 0);

        setStats({ published, errors, pending, total_amount });
      }
    } catch (error) {
      console.error("Error fetching today stats:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTodayStats();
  }, [fetchTodayStats]);

  // Suscripción realtime para actualizar cuando cambien documentos
  useEffect(() => {
    if (!organizationId) return;

    const channel = supabase
      .channel(`today-stats-${organizationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'processed_documents',
          filter: `organization_id=eq.${organizationId}`
        },
        () => {
          console.log('📊 TodayReport: documento actualizado, refrescando...');
          fetchTodayStats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, fetchTodayStats]);


  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("es-CR", {
      style: "currency",
      currency: "CRC",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Procesamiento de Hoy
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-muted rounded w-3/4"></div>
            <div className="h-4 bg-muted rounded w-1/2"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalDocuments = stats.published + stats.errors + stats.pending;
  const successRate = totalDocuments > 0 
    ? ((stats.published / totalDocuments) * 100).toFixed(1)
    : "0";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Procesamiento de Hoy - {format(new Date(), "d 'de' MMMM", { locale: es })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" />
              Publicadas
            </div>
            <div className="text-2xl font-bold text-success">{stats.published}</div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <XCircle className="h-4 w-4 text-destructive" />
              Con Error
            </div>
            <div className="text-2xl font-bold text-destructive">{stats.errors}</div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4 text-warning" />
              Pendientes
            </div>
            <div className="text-2xl font-bold text-warning">{stats.pending}</div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <TrendingUp className="h-4 w-4 text-primary" />
              Tasa de Éxito
            </div>
            <div className="text-2xl font-bold text-primary">{successRate}%</div>
          </div>
        </div>

        {stats.published > 0 && (
          <div className="pt-4 border-t">
            <div className="text-sm text-muted-foreground">Total Procesado</div>
            <div className="text-xl font-bold text-primary">
              {formatCurrency(stats.total_amount)}
            </div>
          </div>
        )}

        {totalDocuments === 0 && (
          <div className="text-center text-muted-foreground py-4">
            No se han procesado facturas hoy
          </div>
        )}
      </CardContent>
    </Card>
  );
};
