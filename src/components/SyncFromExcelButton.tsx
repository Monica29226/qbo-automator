import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { useState } from "react";

export const SyncFromExcelButton = () => {
  const { activeOrganization } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !activeOrganization) return;

    setIsProcessing(true);
    toast.info("Analizando archivo Excel y buscando facturas...");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("organization_id", activeOrganization);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No session");

      const { data, error } = await supabase.functions.invoke("sync-from-excel", {
        body: formData,
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (error) throw error;

      const {
        total,
        already_in_qbo,
        already_in_db,
        found_and_processed,
        not_found,
        failed,
      } = data;

      let message = `Análisis completado:\n`;
      message += `📊 Total: ${total}\n`;
      if (already_in_qbo > 0) message += `✓ Ya en QuickBooks: ${already_in_qbo}\n`;
      if (already_in_db > 0) message += `📝 Ya en base de datos: ${already_in_db}\n`;
      if (found_and_processed > 0) message += `🎉 Procesadas y subidas: ${found_and_processed}\n`;
      if (not_found > 0) message += `❌ No encontradas en Gmail: ${not_found}\n`;
      if (failed > 0) message += `⚠️ Fallidas: ${failed}`;

      if (found_and_processed > 0 || not_found > 0 || failed > 0) {
        toast.success(message, { duration: 10000 });
      } else {
        toast.info(message, { duration: 5000 });
      }

      // Reload after processing
      if (found_and_processed > 0) {
        setTimeout(() => {
          window.location.reload();
        }, 3000);
      }
    } catch (error) {
      console.error("Error syncing from Excel:", error);
      toast.error("Error al procesar el archivo Excel");
    } finally {
      setIsProcessing(false);
      // Reset input
      event.target.value = "";
    }
  };

  return (
    <div>
      <input
        type="file"
        accept=".xlsx,.xls"
        onChange={handleFileUpload}
        style={{ display: "none" }}
        id="excel-upload"
        disabled={isProcessing}
      />
      <Button 
        onClick={() => document.getElementById("excel-upload")?.click()}
        className="w-full"
        disabled={isProcessing}
      >
        <Upload className="h-4 w-4 mr-2" />
        {isProcessing ? "Procesando..." : "Sincronizar desde Excel"}
      </Button>
    </div>
  );
};
