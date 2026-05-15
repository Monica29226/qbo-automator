import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";

const FN_MAP: Record<string, string> = {
  gmail: "gmail-fetch-invoices",
  outlook: "outlook-fetch-invoices",
  hostinger: "hostinger-fetch-invoices",
  bluehost: "bluehost-fetch-invoices",
};

export const SyncEmailNowButton = () => {
  const { activeOrganization } = useAuth();
  const [loading, setLoading] = useState(false);

  const pickNum = (obj: any, keys: string[]): number => {
    if (!obj || typeof obj !== "object") return 0;
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "number") return v;
      if (typeof v === "string" && !isNaN(Number(v))) return Number(v);
    }
    return 0;
  };

  const handleClick = async () => {
    if (!activeOrganization) {
      toast.error("No hay organización activa");
      return;
    }
    setLoading(true);
    const t = toast.loading("Sincronizando correos...");
    try {
      const { data: accounts, error } = await supabase
        .rpc("get_active_email_services", { _org_id: activeOrganization });

      if (error) throw error;

      if (!accounts || accounts.length === 0) {
        toast.dismiss(t);
        toast.warning("No hay integraciones de correo activas");
        return;
      }

      const unique = Array.from(
        new Set((accounts as Array<{ service_type: string }>).map((a) => a.service_type))
      ).filter((s) => FN_MAP[s]);

      const results = await Promise.allSettled(
        unique.map(async (svc) => {
          const fn = FN_MAP[svc];
          const { data, error: fnErr } = await supabase.functions.invoke(fn, {
            body: { organization_id: activeOrganization },
          });
          if (fnErr) throw new Error(`${svc}: ${fnErr.message}`);
          return { svc, data };
        })
      );

      let found = 0, imported = 0, existed = 0, errors = 0;
      const errMsgs: string[] = [];

      for (const r of results) {
        if (r.status === "fulfilled") {
          const d = r.value.data || {};
          found += pickNum(d, ["found", "total_found", "messages_found", "fetched", "emails_found"]);
          imported += pickNum(d, ["imported", "new", "new_invoices", "processed", "created"]);
          existed += pickNum(d, ["duplicates", "existed", "already_existed", "skipped"]);
          errors += pickNum(d, ["errors", "failed", "error_count"]);
        } else {
          errors += 1;
          errMsgs.push(r.reason?.message || "Error desconocido");
        }
      }

      toast.dismiss(t);
      toast.success(
        `✅ Sincronización completa\n📧 Encontradas: ${found}\n✨ Nuevas: ${imported}\n✓ Ya existían: ${existed}\n❌ Con error: ${errors}`,
        { duration: 8000 }
      );
      if (errMsgs.length) {
        toast.error(errMsgs.join(" | "), { duration: 8000 });
      }

      window.dispatchEvent(new CustomEvent("dashboard:refresh"));
    } catch (e: any) {
      toast.dismiss(t);
      toast.error(`Error sincronizando: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      onClick={handleClick}
      disabled={loading}
      size="lg"
      className="gap-2 shadow-md"
    >
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <RefreshCw className="h-5 w-5" />
      )}
      🔄 Sincronizar correo ahora
    </Button>
  );
};
