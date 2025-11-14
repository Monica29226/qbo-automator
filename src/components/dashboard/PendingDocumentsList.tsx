import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, AlertCircle, Calendar, DollarSign, Building2 } from "lucide-react";
import { format } from "date-fns";

interface PendingDocument {
  id: string;
  doc_number: string;
  doc_type: string;
  supplier_name: string;
  supplier_tax_id: string | null;
  total_amount: number;
  currency: string;
  issue_date: string;
  status: string;
  vendor_id: string | null;
  created_at: string;
}

export const PendingDocumentsList = () => {
  const { activeOrganization } = useAuth();
  const [pendingDocs, setPendingDocs] = useState<PendingDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const fetchPendingDocuments = async () => {
    if (!activeOrganization) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("processed_documents")
        .select("*")
        .eq("organization_id", activeOrganization)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (!error && data) {
        setPendingDocs(data);
      }
    } catch (error) {
      console.error("Error fetching pending documents:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && activeOrganization) {
      fetchPendingDocuments();
    }
  }, [isOpen, activeOrganization]);

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('es-CR', {
      style: 'currency',
      currency: currency || 'CRC',
    }).format(amount);
  };

  const getReasonForPending = (doc: PendingDocument) => {
    if (!doc.vendor_id) {
      return "Sin vendor asignado";
    }
    return "Pendiente de revisión";
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <FileText className="h-4 w-4" />
          Ver Pendientes
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-warning" />
            Documentos Pendientes ({pendingDocs.length})
          </DialogTitle>
          <DialogDescription>
            Listado de facturas que requieren atención antes de publicar a QuickBooks
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[60vh] pr-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : pendingDocs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No hay documentos pendientes
            </div>
          ) : (
            <div className="space-y-3">
              {pendingDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="p-4 border rounded-lg bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-primary" />
                        <span className="font-medium">{doc.doc_number}</span>
                        <Badge variant="outline" className="text-xs">
                          {doc.doc_type}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Building2 className="h-3 w-3" />
                        <span className="font-medium text-foreground">
                          {doc.supplier_name}
                        </span>
                        {doc.supplier_tax_id && (
                          <span className="text-xs">• {doc.supplier_tax_id}</span>
                        )}
                      </div>

                      <div className="flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          <span>{format(new Date(doc.issue_date), 'dd/MM/yyyy')}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <DollarSign className="h-3 w-3 text-muted-foreground" />
                          <span className="font-medium">
                            {formatCurrency(doc.total_amount, doc.currency)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="gap-1">
                          <AlertCircle className="h-3 w-3" />
                          {getReasonForPending(doc)}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
