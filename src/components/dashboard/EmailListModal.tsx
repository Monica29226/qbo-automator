import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Mail, Calendar, FileText, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface EmailListModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface EmailDocument {
  id: string;
  doc_number: string;
  supplier_name: string;
  issue_date: string;
  total_amount: number;
  currency: string;
  status: string;
  error_message: string | null;
  created_at: string;
  doc_type: string;
}

export const EmailListModal = ({ open, onOpenChange }: EmailListModalProps) => {
  const { activeOrganization } = useAuth();
  const [emails, setEmails] = useState<EmailDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (open && activeOrganization) {
      fetchEmails();
    }
  }, [open, activeOrganization]);

  const fetchEmails = async () => {
    if (!activeOrganization) return;
    
    setIsLoading(true);
    
    const { data, error } = await supabase
      .from("processed_documents")
      .select("id, doc_number, supplier_name, issue_date, total_amount, currency, status, error_message, created_at, doc_type")
      .eq("organization_id", activeOrganization)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Error fetching emails:", error);
    } else {
      setEmails(data || []);
    }
    
    setIsLoading(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "processed":
        return <Badge variant="outline" className="bg-success/10 text-success border-success/20">Procesado</Badge>;
      case "pending":
        return <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20">Pendiente</Badge>;
      case "review":
        return <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/20">Revisión</Badge>;
      case "error":
        return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">Error</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
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
            <Mail className="h-5 w-5" />
            Correos Recibidos
          </DialogTitle>
          <DialogDescription>
            Últimos 50 documentos procesados desde Gmail/Outlook
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : emails.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Mail className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No se encontraron correos procesados</p>
          </div>
        ) : (
          <ScrollArea className="h-[500px] pr-4">
            <div className="space-y-3">
              {emails.map((email) => (
                <div
                  key={email.id}
                  className="p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <span className="font-semibold text-sm">{email.doc_number}</span>
                        {getDocTypeBadge(email.doc_type)}
                        {getStatusBadge(email.status)}
                      </div>
                      
                      <p className="text-sm text-foreground">{email.supplier_name}</p>
                      
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(email.issue_date), "d MMM yyyy", { locale: es })}
                        </div>
                        <div className="font-medium">
                          {(() => {
                            const validCurrency = email.currency && ['CRC', 'USD', 'EUR'].includes(email.currency) 
                              ? email.currency 
                              : 'CRC';
                            return new Intl.NumberFormat("es-CR", {
                              style: "currency",
                              currency: validCurrency,
                            }).format(email.total_amount);
                          })()}
                        </div>
                      </div>

                      {email.error_message && (
                        <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 p-2 rounded">
                          <AlertCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                          <span>{email.error_message}</span>
                        </div>
                      )}
                    </div>

                    <div className="text-right text-xs text-muted-foreground">
                      {format(new Date(email.created_at), "d MMM HH:mm", { locale: es })}
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
