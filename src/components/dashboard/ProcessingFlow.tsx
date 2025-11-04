import { cn } from "@/lib/utils";
import { Mail, FileSearch, Database, CheckCircle, ArrowRight, Upload, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Link } from "react-router-dom";

interface ProcessingFlowProps {
  organizationId: string;
  gmailConnected: boolean;
  quickbooksConnected: boolean;
  onRefresh?: () => void;
}

export const ProcessingFlow = ({ organizationId, gmailConnected, quickbooksConnected, onRefresh }: ProcessingFlowProps) => {
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleFetchInvoices = async () => {
    if (!gmailConnected) {
      toast({
        title: "Gmail no conectado",
        description: "Primero debes conectar Gmail en la página de Integraciones",
        variant: "destructive",
      });
      return;
    }

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
    if (!quickbooksConnected) {
      toast({
        title: "QuickBooks no conectado",
        description: "Primero debes conectar QuickBooks en la página de Integraciones",
        variant: "destructive",
      });
      return;
    }

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
      status: gmailConnected ? "active" : "inactive",
      onClick: handleFetchInvoices,
      actionLabel: "Importar",
      disabled: !gmailConnected,
    },
    {
      icon: FileSearch,
      label: "Extraer XML",
      description: "Parser CR v4.x",
      status: gmailConnected ? "active" : "inactive",
      onClick: handleFetchInvoices,
      actionLabel: "Procesar",
      disabled: !gmailConnected,
    },
    {
      icon: Database,
      label: "Clasificar",
      description: "Catálogo proveedores",
      status: gmailConnected ? "active" : "inactive",
      onClick: handleFetchInvoices,
      actionLabel: "Clasificar",
      disabled: !gmailConnected,
    },
    {
      icon: CheckCircle,
      label: "Publicar QBO",
      description: "Bill/VendorCredit",
      status: quickbooksConnected ? "active" : "inactive",
      onClick: handleSyncToQuickBooks,
      actionLabel: "Publicar",
      disabled: !quickbooksConnected,
    },
  ];

  if (!gmailConnected && !quickbooksConnected) {
    return (
      <div className="text-center py-8 space-y-4">
        <div className="bg-muted/50 rounded-lg p-6 space-y-3">
          <p className="text-sm text-muted-foreground">
            <strong>¿Quieres procesar facturas manualmente?</strong>
          </p>
          <p className="text-xs text-muted-foreground">
            Este flujo es para importación automática desde Gmail. Para subir archivos XML manualmente, usa el botón de arriba.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Button asChild variant="default">
              <Link to="/upload">
                <Upload className="h-4 w-4 mr-2" />
                Subir XML Manualmente
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/integrations">
                <Plug className="h-4 w-4 mr-2" />
                Configurar Gmail/QuickBooks
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {steps.map((step, index) => (
          <div key={step.label} className="flex items-center gap-4">
            <div className="flex flex-col items-center gap-3">
              <Button
                variant="ghost"
                disabled={isProcessing || step.disabled}
                onClick={step.onClick}
                className={cn(
                  "h-16 w-16 rounded-xl flex items-center justify-center transition-all p-0",
                  step.status === "active" 
                    ? "bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 hover:scale-105" 
                    : "bg-muted text-muted-foreground cursor-not-allowed opacity-50"
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
      {(!gmailConnected || !quickbooksConnected) && (
        <div className="text-center text-sm text-muted-foreground bg-muted/30 p-3 rounded-lg">
          {!gmailConnected && !quickbooksConnected ? (
            <>Conecta Gmail y QuickBooks para activar el flujo completo</>
          ) : !gmailConnected ? (
            <>Conecta Gmail para activar los pasos 1-3</>
          ) : (
            <>Conecta QuickBooks para activar el paso 4</>
          )}
          {" · "}
          <Link to="/integrations" className="text-primary underline">Ir a Integraciones</Link>
        </div>
      )}
    </div>
  );
};
