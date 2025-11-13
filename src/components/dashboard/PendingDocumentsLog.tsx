import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { FileText, Loader2, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

interface PendingDoc {
  id: string;
  doc_number: string;
  supplier_name: string;
  total_amount: number;
  currency: string;
  created_at: string;
  error_message: string | null;
  retry_count: number;
}

export const PendingDocumentsLog = () => {
  const { activeOrganization } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingDocs, setPendingDocs] = useState<PendingDoc[]>([]);

  const fetchPendingDocs = async () => {
    if (!activeOrganization) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("processed_documents")
        .select("id, doc_number, supplier_name, total_amount, currency, created_at, error_message, retry_count")
        .eq("organization_id", activeOrganization)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (error) throw error;

      setPendingDocs(data || []);
      console.log("📋 Documentos pendientes:", data);
      toast.success(`${data?.length || 0} documentos pendientes encontrados`);
    } catch (error: any) {
      console.error("Error fetching pending docs:", error);
      toast.error("Error al cargar documentos pendientes");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchPendingDocs();
    }
  }, [isOpen, activeOrganization]);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full">
          <FileText className="h-4 w-4 mr-2" />
          Ver Facturas Pendientes
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Facturas en Estado Pendiente</DialogTitle>
          <DialogDescription>
            Documentos que están esperando ser procesados
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Button 
            onClick={fetchPendingDocs}
            disabled={isLoading}
            variant="outline"
            size="sm"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Cargando...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refrescar
              </>
            )}
          </Button>

          <div className="text-sm text-muted-foreground">
            Total: <strong>{pendingDocs.length}</strong> documentos pendientes
          </div>

          <ScrollArea className="h-[400px] border rounded-lg">
            <div className="p-4 space-y-3">
              {pendingDocs.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  No hay documentos pendientes
                </div>
              ) : (
                pendingDocs.map((doc) => (
                  <div key={doc.id} className="p-3 border rounded-lg bg-muted/30 space-y-1">
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <p className="font-semibold">{doc.doc_number}</p>
                        <p className="text-sm text-muted-foreground">{doc.supplier_name}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">
                          {new Intl.NumberFormat('es-CR', {
                            style: 'currency',
                            currency: doc.currency || 'CRC',
                          }).format(doc.total_amount)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Reintentos: {doc.retry_count}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Creado: {new Date(doc.created_at).toLocaleString('es-CR')}
                    </p>
                    {doc.error_message && (
                      <p className="text-xs text-destructive mt-2">
                        Error: {doc.error_message}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
};
