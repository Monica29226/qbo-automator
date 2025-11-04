import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, ExternalLink, Loader2, AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Document {
  id: string;
  doc_number: string;
  supplier_name: string;
  issue_date: string;
  total_amount: number;
  currency: string;
  status: string;
  qbo_entity_id: string | null;
  doc_type: string;
  error_message: string | null;
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline"; color: string }> = {
  processed: { label: "Procesada", variant: "default", color: "text-success" },
  review: { label: "En Revisión", variant: "secondary", color: "text-warning" },
  pending: { label: "Pendiente", variant: "outline", color: "text-muted-foreground" },
  error: { label: "Error", variant: "outline", color: "text-destructive" },
  duplicate: { label: "Duplicado", variant: "outline", color: "text-muted-foreground" },
};

export const RecentDocuments = () => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    const { data, error } = await supabase
      .from("processed_documents")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5);

    if (!error && data) {
      setDocuments(data);
    }
    setIsLoading(false);
  };

  const formatCurrency = (amount: number, currency: string) => {
    const symbol = currency === "USD" ? "$" : "₡";
    const formatted = amount.toLocaleString("es-CR", { minimumFractionDigits: 2 });
    return `${symbol}${formatted}`;
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
        <p>No hay documentos procesados aún</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {documents.map((doc) => (
        <div
          key={doc.id}
          className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
        >
          <div className="flex items-center gap-4 flex-1">
            <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${
              doc.error_message ? "bg-destructive/10" : "bg-primary/10"
            }`}>
              {doc.error_message ? (
                <AlertCircle className="h-5 w-5 text-destructive" />
              ) : (
                <FileText className="h-5 w-5 text-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="font-semibold text-sm text-foreground">{doc.doc_number}</p>
                {doc.qbo_entity_id && (
                  <Badge variant="outline" className="text-xs">
                    QBO: {doc.qbo_entity_id}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground truncate">{doc.supplier_name}</p>
              {doc.error_message && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className="text-xs text-destructive mt-1 cursor-help flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Error: {doc.error_message.substring(0, 50)}...
                      </p>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-md">
                      <p className="text-xs">{doc.error_message}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="font-semibold text-sm text-foreground">
                {formatCurrency(doc.total_amount, doc.currency)}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(doc.issue_date).toLocaleDateString("es-CR")}
              </p>
            </div>
            <Badge variant={statusConfig[doc.status]?.variant || "outline"} className="min-w-[100px] justify-center">
              {statusConfig[doc.status]?.label || doc.status}
            </Badge>
            {doc.qbo_entity_id && (
              <Button variant="ghost" size="sm">
                <ExternalLink className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};
