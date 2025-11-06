import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Loader2, CheckCircle, AlertCircle, Clock } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ProcessedDocument {
  id: string;
  doc_number: string;
  doc_type: string;
  supplier_name: string;
  total_amount: number;
  currency: string;
  issue_date: string;
  status: string;
  error_message: string | null;
  created_at: string;
}

interface PublishQBOModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const PublishQBOModal = ({ open, onOpenChange }: PublishQBOModalProps) => {
  const { activeOrganization } = useAuth();
  const [readyDocs, setReadyDocs] = useState<ProcessedDocument[]>([]);
  const [errorDocs, setErrorDocs] = useState<ProcessedDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (open && activeOrganization) {
      fetchDocuments();
    }
  }, [open, activeOrganization]);

  const fetchDocuments = async () => {
    if (!activeOrganization) return;

    setIsLoading(true);

    try {
      // Fetch documents ready to publish (processed status, no errors)
      const { data: ready } = await supabase
        .from("processed_documents")
        .select("*")
        .eq("organization_id", activeOrganization)
        .eq("status", "processed")
        .is("error_message", null)
        .order("created_at", { ascending: false })
        .limit(50);

      // Fetch documents with errors
      const { data: errors } = await supabase
        .from("processed_documents")
        .select("*")
        .eq("organization_id", activeOrganization)
        .not("error_message", "is", null)
        .order("created_at", { ascending: false })
        .limit(50);

      setReadyDocs(ready || []);
      setErrorDocs(errors || []);
    } catch (error) {
      console.error("Error fetching documents:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "processed":
        return <Badge variant="default" className="gap-1"><CheckCircle className="h-3 w-3" />Procesado</Badge>;
      case "pending":
        return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />Pendiente</Badge>;
      case "review":
        return <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" />En Revisión</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getDocTypeBadge = (type: string) => {
    const types: Record<string, { label: string; variant: "default" | "secondary" }> = {
      "invoice": { label: "Factura", variant: "default" },
      "credit": { label: "NC", variant: "secondary" },
      "debit": { label: "ND", variant: "default" },
    };
    const docType = types[type] || { label: type, variant: "secondary" as const };
    return <Badge variant={docType.variant}>{docType.label}</Badge>;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Publicar a QuickBooks</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="ready" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="ready" className="gap-2">
                <CheckCircle className="h-4 w-4" />
                Listos ({readyDocs.length})
              </TabsTrigger>
              <TabsTrigger value="errors" className="gap-2">
                <AlertCircle className="h-4 w-4" />
                Con Errores ({errorDocs.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="ready" className="mt-4">
              <ScrollArea className="h-[500px] pr-4">
                {readyDocs.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No hay documentos listos para publicar
                  </div>
                ) : (
                  <div className="space-y-3">
                    {readyDocs.map((doc) => (
                      <div key={doc.id} className="p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              {getDocTypeBadge(doc.doc_type)}
                              <span className="font-mono text-sm font-semibold">{doc.doc_number}</span>
                              {getStatusBadge(doc.status)}
                            </div>
                            <div className="text-sm">
                              <span className="font-medium">{doc.supplier_name}</span>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                              <span>{format(new Date(doc.issue_date), "d MMM yyyy", { locale: es })}</span>
                              <span className="font-medium">
                                {(() => {
                                  const validCurrency = doc.currency && ['CRC', 'USD', 'EUR'].includes(doc.currency) 
                                    ? doc.currency 
                                    : 'CRC';
                                  return new Intl.NumberFormat("es-CR", {
                                    style: "currency",
                                    currency: validCurrency,
                                  }).format(doc.total_amount);
                                })()}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="errors" className="mt-4">
              <ScrollArea className="h-[500px] pr-4">
                {errorDocs.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No hay documentos con errores
                  </div>
                ) : (
                  <div className="space-y-3">
                    {errorDocs.map((doc) => (
                      <div key={doc.id} className="p-4 border border-destructive/30 rounded-lg bg-destructive/5">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              {getDocTypeBadge(doc.doc_type)}
                              <span className="font-mono text-sm font-semibold">{doc.doc_number}</span>
                              {getStatusBadge(doc.status)}
                            </div>
                            <div className="text-sm">
                              <span className="font-medium">{doc.supplier_name}</span>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                              <span>{format(new Date(doc.issue_date), "d MMM yyyy", { locale: es })}</span>
                              <span className="font-medium">
                                {(() => {
                                  const validCurrency = doc.currency && ['CRC', 'USD', 'EUR'].includes(doc.currency) 
                                    ? doc.currency 
                                    : 'CRC';
                                  return new Intl.NumberFormat("es-CR", {
                                    style: "currency",
                                    currency: validCurrency,
                                  }).format(doc.total_amount);
                                })()}
                              </span>
                            </div>
                            {doc.error_message && (
                              <>
                                <Separator className="my-2" />
                                <div className="flex items-start gap-2 p-2 bg-destructive/10 rounded text-xs">
                                  <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                                  <span className="text-destructive">{doc.error_message}</span>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
};
