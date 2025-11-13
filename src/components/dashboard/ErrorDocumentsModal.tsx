import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, AlertCircle, Calendar, FileText } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface ErrorDocumentsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ErrorDocument {
  id: string;
  doc_number: string;
  supplier_name: string;
  issue_date: string;
  total_amount: number;
  currency: string;
  error_message: string | null;
  created_at: string;
  doc_type: string;
  retry_count: number;
}

export const ErrorDocumentsModal = ({ open, onOpenChange }: ErrorDocumentsModalProps) => {
  const { activeOrganization } = useAuth();
  const [errors, setErrors] = useState<ErrorDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (open && activeOrganization) {
      fetchErrors();
    }
  }, [open, activeOrganization]);

  const fetchErrors = async () => {
    if (!activeOrganization) return;
    
    setIsLoading(true);
    
    const { data, error } = await supabase
      .from("processed_documents")
      .select("id, doc_number, supplier_name, issue_date, total_amount, currency, error_message, created_at, doc_type, retry_count")
      .eq("organization_id", activeOrganization)
      .eq("status", "error")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Error fetching error documents:", error);
    } else {
      setErrors(data || []);
    }
    
    setIsLoading(false);
  };

  const getDocTypeBadge = (docType: string) => {
    return docType === "CreditNote" ? (
      <Badge variant="secondary" className="text-xs">NC</Badge>
    ) : (
      <Badge variant="secondary" className="text-xs">Factura</Badge>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            Documentos con Errores
          </DialogTitle>
          <DialogDescription>
            Últimos 50 documentos con errores de procesamiento
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : errors.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No se encontraron documentos con errores</p>
          </div>
        ) : (
          <ScrollArea className="h-[500px] pr-4">
            <div className="space-y-3">
              {errors.map((error) => (
                <div
                  key={error.id}
                  className="border border-destructive/20 rounded-lg p-4 bg-destructive/5 hover:bg-destructive/10 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="font-medium text-sm">{error.doc_number}</span>
                      {getDocTypeBadge(error.doc_type)}
                    </div>
                    <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">
                      Error
                    </Badge>
                  </div>

                  <div className="space-y-1.5 text-sm">
                    <p className="text-muted-foreground font-medium">{error.supplier_name}</p>
                    
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {error.issue_date ? format(new Date(error.issue_date), "d 'de' MMMM, yyyy", { locale: es }) : "Sin fecha"}
                      </div>
                      <div className="font-semibold">
                        {new Intl.NumberFormat('es-CR', {
                          style: 'currency',
                          currency: ['CRC', 'USD', 'EUR'].includes(error.currency) ? error.currency : 'CRC',
                        }).format(error.total_amount)}
                      </div>
                    </div>

                    {error.error_message && (
                      <div className="mt-2 p-2 bg-destructive/10 rounded border border-destructive/20">
                        <p className="text-xs text-destructive font-medium">
                          {error.error_message}
                        </p>
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-destructive/10">
                      <span className="text-xs text-muted-foreground">
                        Creado: {format(new Date(error.created_at), "d MMM, HH:mm", { locale: es })}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Reintentos: {error.retry_count}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
};
