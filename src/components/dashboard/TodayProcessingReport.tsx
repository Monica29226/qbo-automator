import { useEffect, useState, useCallback, useRef } from "react";
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
  
  // Debounce ref to prevent excessive refetches
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const lastFetchRef = useRef<number>(0);

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

      // Use timezone-aware date range for Costa Rica (UTC-6)
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

      const { data: documents } = await supabase
        .from("processed_documents")
        .select("status, total_amount, qbo_entity_id")
        .eq("organization_id", activeOrg.organization_id)
        .gte("created_at", todayStart.toISOString())
        .lte("created_at", todayEnd.toISOString());

      if (documents) {
        // Count "published" and "processed" with qbo_entity_id as successfully published
        const published = documents.filter(d => d.status === "published" || (d.status === "processed" && d.qbo_entity_id)).length;
        const errors = documents.filter(d => d.status === "error").length;
        const pending = documents.filter(d => d.status === "pending" || d.status === "review" || (d.status === "processed" && !d.qbo_entity_id)).length;
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

  // Debounced fetch function to prevent excessive refetches
  const debouncedFetch = useCallback(() => {
    const now = Date.now();
    // Minimum 5 seconds between fetches for stats
    if (now - lastFetchRef.current < 5000) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        lastFetchRef.current = Date.now();
        fetchTodayStats();
      }, 5000);
      return;
    }
    lastFetchRef.current = now;
    fetchTodayStats();
  }, [fetchTodayStats]);

  useEffect(() => {
    fetchTodayStats();
  }, [fetchTodayStats]);

  // Suscripción realtime con filtro y debounce
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
          // Use debounced fetch to prevent cascade
          debouncedFetch();
        }
      )
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [organizationId, debouncedFetch]);


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
  const resolvedDocuments = stats.published + stats.errors;
  const successRate = resolvedDocuments > 0 
    ? ((stats.published / resolvedDocuments) * 100).toFixed(1)
    : (stats.pending > 0 ? "—" : "100");

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
