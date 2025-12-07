import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Upload, Loader2, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

interface OrphanedInvoice {
  id: string;
  doc_number: string;
  supplier_name: string;
  total_amount: number;
  currency: string;
  default_account_ref: string | null;
  status: string;
}

export const PublishOrphanedInvoices = () => {
  const { activeOrganization } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [orphanedInvoices, setOrphanedInvoices] = useState<OrphanedInvoice[]>([]);

  const fetchOrphanedInvoices = async () => {
    if (!activeOrganization) return;

    setIsLoading(true);
    try {
      // Facturas con status processed pero sin qbo_entity_id
      const { data, error } = await supabase
        .from("processed_documents")
        .select("id, doc_number, supplier_name, total_amount, currency, default_account_ref, status")
        .eq("organization_id", activeOrganization)
        .eq("status", "processed")
        .is("qbo_entity_id", null)
        .order("created_at", { ascending: false });

      if (error) throw error;

      setOrphanedInvoices(data || []);
      
      if (data && data.length > 0) {
        toast.info(`${data.length} facturas procesadas pendientes de publicar`);
      } else {
        toast.success("No hay facturas huérfanas");
      }
    } catch (error: any) {
      console.error("Error fetching orphaned invoices:", error);
      toast.error("Error al buscar facturas huérfanas");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePublishAll = async () => {
    if (orphanedInvoices.length === 0 || !activeOrganization) return;

    // Filtrar solo las que tienen cuenta configurada
    const readyToPublish = orphanedInvoices.filter(inv => inv.default_account_ref);
    
    if (readyToPublish.length === 0) {
      toast.error("Ninguna factura tiene cuenta configurada");
      return;
    }

    setIsPublishing(true);
    try {
      const documentIds = readyToPublish.map(inv => inv.id);
      
      const { data, error } = await supabase.functions.invoke(
        "publish-to-quickbooks",
        {
          body: { organization_id: activeOrganization, document_ids: documentIds },
        }
      );

      if (error) throw error;

      const published = data?.published || 0;
      const errors = data?.errors?.length || 0;

      if (errors > 0) {
        toast.warning(`⚠️ ${published} publicadas, ${errors} con errores`);
      } else {
        toast.success(`✅ ${published} facturas publicadas a QuickBooks`);
      }

      // Refrescar lista
      await fetchOrphanedInvoices();
    } catch (error: any) {
      console.error("Error publishing orphaned invoices:", error);
      toast.error(error.message || "Error al publicar facturas");
    } finally {
      setIsPublishing(false);
    }
  };

  const formatCurrency = (amount: number, currency: string) => {
    try {
      return new Intl.NumberFormat("es-CR", {
        style: "currency",
        currency: currency || "CRC",
      }).format(amount);
    } catch {
      return `${currency} ${amount.toFixed(2)}`;
    }
  };

  const readyCount = orphanedInvoices.filter(inv => inv.default_account_ref).length;
  const needsConfigCount = orphanedInvoices.filter(inv => !inv.default_account_ref).length;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      setIsOpen(open);
      if (open) fetchOrphanedInvoices();
    }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Upload className="h-4 w-4" />
          Publicar Huérfanas
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            Facturas Procesadas Sin Publicar
          </DialogTitle>
          <DialogDescription>
            Facturas con status "processed" que no llegaron a QuickBooks
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-4 text-sm">
            <Badge variant="default" className="bg-green-500">
              {readyCount} listas para publicar
            </Badge>
            {needsConfigCount > 0 && (
              <Badge variant="destructive">
                {needsConfigCount} sin cuenta configurada
              </Badge>
            )}
          </div>

          <ScrollArea className="h-[400px] border rounded-lg">
            <div className="p-4 space-y-2">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : orphanedInvoices.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  No hay facturas huérfanas
                </div>
              ) : (
                orphanedInvoices.map((inv) => (
                  <div 
                    key={inv.id} 
                    className={`p-3 border rounded-lg ${inv.default_account_ref ? 'bg-green-50 dark:bg-green-950/30' : 'bg-red-50 dark:bg-red-950/30'}`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-mono text-sm">{inv.doc_number}</p>
                        <p className="text-sm font-medium">{inv.supplier_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {inv.default_account_ref || "⚠️ Sin cuenta configurada"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">
                          {formatCurrency(inv.total_amount, inv.currency)}
                        </p>
                        <Badge variant={inv.default_account_ref ? "default" : "destructive"} className="text-xs">
                          {inv.default_account_ref ? "Lista" : "Falta cuenta"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Cerrar
          </Button>
          <Button 
            onClick={handlePublishAll} 
            disabled={isPublishing || readyCount === 0}
            className="gap-2"
          >
            {isPublishing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Publicando...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Publicar {readyCount} Facturas
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
