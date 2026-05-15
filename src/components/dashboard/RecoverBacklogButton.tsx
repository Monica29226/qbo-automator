import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, History } from "lucide-react";

export const RecoverBacklogButton = () => {
  const { activeOrganization } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (!activeOrganization) {
      toast.error("No hay organización activa");
      return;
    }
    if (!confirm("Esto recorrerá hasta 30 lotes de correos sin procesar (puede tomar varios minutos). ¿Continuar?")) {
      return;
    }
    setLoading(true);
    const t = toast.loading("Recuperando facturas pendientes...");
    try {
      const { data, error } = await supabase.functions.invoke("recover-org-backlog", {
        body: { organization_id: activeOrganization, max_chunks: 30 },
      });
      if (error) throw error;

      toast.dismiss(t);
      const processed = Number(data?.total_processed || 0);
      const failed = Number(data?.total_failed || 0);
      const chunks = Number(data?.chunks_run || 0);
      const qbo = Number(data?.qbo_published || 0);
      const remaining = Number(data?.next_skip || 0);
      const total = data?.total_messages ?? "?";

      toast.success(
        `✅ Recuperación completada\n📦 Lotes: ${chunks}\n✨ Nuevas: ${processed}\n📤 Publicadas a QBO: ${qbo}\n❌ Errores: ${failed}\n⏭️ Cursor restante: ${remaining}/${total}`,
        { duration: 12000 }
      );
      if (data?.last_error) {
        toast.error(`Detalle: ${data.last_error}`, { duration: 10000 });
      }
      window.dispatchEvent(new CustomEvent("dashboard:refresh"));
    } catch (e: any) {
      toast.dismiss(t);
      toast.error(`Error en recuperación: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      onClick={handleClick}
      disabled={loading}
      size="lg"
      variant="outline"
      className="gap-2 shadow-md"
    >
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <History className="h-5 w-5" />
      )}
      🔁 Recuperar facturas pendientes
    </Button>
  );
};
