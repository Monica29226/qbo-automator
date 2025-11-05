import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Calendar, Loader2 } from "lucide-react";

export const MonthSync = () => {
  const { activeOrganization } = useAuth();
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [selectedYear, setSelectedYear] = useState<string>("2025");
  const [isSyncing, setIsSyncing] = useState(false);

  const months = [
    { value: "1", label: "Enero" },
    { value: "2", label: "Febrero" },
    { value: "3", label: "Marzo" },
    { value: "4", label: "Abril" },
    { value: "5", label: "Mayo" },
    { value: "6", label: "Junio" },
    { value: "7", label: "Julio" },
    { value: "8", label: "Agosto" },
    { value: "9", label: "Septiembre" },
    { value: "10", label: "Octubre" },
    { value: "11", label: "Noviembre" },
    { value: "12", label: "Diciembre" },
  ];

  const years = ["2024", "2025", "2026"];

  const handleSync = async () => {
    if (!activeOrganization || !selectedMonth) {
      toast.error("Seleccione un mes para sincronizar");
      return;
    }

    setIsSyncing(true);
    toast.info(`Sincronizando ${months.find(m => m.value === selectedMonth)?.label} ${selectedYear}...`);

    try {
      // 1. Fetch invoices from Gmail for specific month
      const { data: gmailData, error: gmailError } = await supabase.functions.invoke(
        "gmail-fetch-invoices",
        {
          body: {
            organization_id: activeOrganization,
            month: parseInt(selectedMonth),
            year: parseInt(selectedYear),
          },
        }
      );

      if (gmailError) throw gmailError;

      const gmailProcessed = gmailData?.invoices_processed || 0;
      const gmailFailed = gmailData?.invoices_failed || 0;

      toast.success(
        `Gmail: ${gmailProcessed} procesadas, ${gmailFailed} fallidas`
      );

      // 2. Wait a bit for database to update
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 3. Publish to QuickBooks (will check for duplicates)
      if (gmailProcessed > 0) {
        const { data: qboData, error: qboError } = await supabase.functions.invoke(
          "publish-to-quickbooks",
          {
            body: {
              organization_id: activeOrganization,
            },
          }
        );

        if (qboError) throw qboError;

        const published = qboData?.published || 0;
        const failed = qboData?.failed || 0;

        toast.success(
          `QuickBooks: ${published} publicadas, ${failed} fallidas (duplicados omitidos)`
        );
      } else {
        toast.info("No se encontraron facturas nuevas para publicar");
      }

      // Reload after sync
      setTimeout(() => {
        window.location.reload();
      }, 2000);

    } catch (error) {
      console.error("Error syncing month:", error);
      toast.error("Error al sincronizar el mes");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Sincronizar Mes Específico
        </CardTitle>
        <CardDescription>
          Revisa Gmail y sube a QuickBooks las facturas faltantes de un mes específico
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row gap-3">
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Seleccione mes" />
            </SelectTrigger>
            <SelectContent>
              {months.map((month) => (
                <SelectItem key={month.value} value={month.value}>
                  {month.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-full sm:w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((year) => (
                <SelectItem key={year} value={year}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            onClick={handleSync}
            disabled={!selectedMonth || isSyncing}
            className="w-full sm:w-auto"
          >
            {isSyncing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sincronizando...
              </>
            ) : (
              "Sincronizar Mes"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
