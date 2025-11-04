import { cn } from "@/lib/utils";
import { Mail, FileSearch, Database, CheckCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";

interface ProcessingFlowProps {
  organizationId: string;
  onRefresh?: () => void;
}

export const ProcessingFlow = ({ organizationId, onRefresh }: ProcessingFlowProps) => {
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleFetchInvoices = async () => {
    setIsProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-gmail-invoices", {
        body: { organization_id: organizationId },
      });

      if (error) throw error;

      toast({
        title: "Importación iniciada",
        description: `Se están procesando ${data.processed_count || 0} facturas desde Gmail`,
      });
      
      onRefresh?.();
    } catch (error: any) {
      toast({
        title: "Error al importar",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSyncToQuickBooks = async () => {
    setIsProcessing(true);
    try {
      const { data: docs, error: docsError } = await supabase
        .from("processed_documents")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("status", "review")
        .limit(10);

      if (docsError) throw docsError;

      if (!docs || docs.length === 0) {
        toast({
          title: "No hay documentos",
          description: "No hay documentos en estado 'review' para sincronizar",
          variant: "destructive",
        });
        return;
      }

      for (const doc of docs) {
        await supabase.functions.invoke("sync-to-quickbooks", {
          body: { 
            organization_id: organizationId,
            document_id: doc.id 
          },
        });
      }

      toast({
        title: "Sincronización completada",
        description: `Se sincronizaron ${docs.length} documentos a QuickBooks`,
      });
      
      onRefresh?.();
    } catch (error: any) {
      toast({
        title: "Error al sincronizar",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const steps = [
    {
      icon: Mail,
      label: "Recibir Correo",
      description: "Gmail/Outlook",
      status: "active",
      onClick: handleFetchInvoices,
      actionLabel: "Importar",
    },
    {
      icon: FileSearch,
      label: "Extraer XML",
      description: "Parser CR v4.x",
      status: "active",
      onClick: handleFetchInvoices,
      actionLabel: "Procesar",
    },
    {
      icon: Database,
      label: "Clasificar",
      description: "Catálogo proveedores",
      status: "active",
      onClick: handleFetchInvoices,
      actionLabel: "Clasificar",
    },
    {
      icon: CheckCircle,
      label: "Publicar QBO",
      description: "Bill/VendorCredit",
      status: "active",
      onClick: handleSyncToQuickBooks,
      actionLabel: "Publicar",
    },
  ];

  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      {steps.map((step, index) => (
        <div key={step.label} className="flex items-center gap-4">
          <div className="flex flex-col items-center gap-3">
            <Button
              variant="ghost"
              disabled={isProcessing}
              onClick={step.onClick}
              className={cn(
                "h-16 w-16 rounded-xl flex items-center justify-center transition-all p-0 hover:scale-105",
                step.status === "active" 
                  ? "bg-primary text-primary-foreground shadow-lg hover:bg-primary/90" 
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
            >
              <step.icon className="h-8 w-8" />
            </Button>
            <div className="text-center">
              <p className="font-semibold text-sm text-foreground">{step.label}</p>
              <p className="text-xs text-muted-foreground">{step.description}</p>
            </div>
          </div>
          {index < steps.length - 1 && (
            <ArrowRight className="h-6 w-6 text-muted-foreground flex-shrink-0 mt-[-30px]" />
          )}
        </div>
      ))}
    </div>
  );
};
