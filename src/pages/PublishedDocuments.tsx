import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle, ArrowLeft, FileText, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface PublishedDocument {
  id: string;
  doc_number: string;
  supplier_name: string;
  issue_date: string;
  total_amount: number;
  qbo_entity_id: string;
  pdf_attachment_url: string | null;
  created_at: string;
}

const PublishedDocuments = () => {
  const { activeOrganization } = useAuth();
  const [documents, setDocuments] = useState<PublishedDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (activeOrganization) {
      fetchPublishedDocuments();
    }
  }, [activeOrganization]);

  const fetchPublishedDocuments = async () => {
    if (!activeOrganization) return;

    setIsLoading(true);
    const { data, error } = await supabase
      .from("processed_documents")
      .select("id, doc_number, supplier_name, issue_date, total_amount, qbo_entity_id, pdf_attachment_url, created_at")
      .eq("organization_id", activeOrganization)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(100);

    if (!error && data) {
      setDocuments(data);
    }
    setIsLoading(false);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-CR', {
      style: 'currency',
      currency: 'CRC',
      minimumFractionDigits: 2
    }).format(amount);
  };

  const handleReattachPdf = async (docId: string, docNumber: string) => {
    toast.info(`Reintentando adjuntar PDF para factura ${docNumber}...`);
    // Aquí se puede implementar lógica de reintento
  };

  const stats = {
    total: documents.length,
    withPdf: documents.filter(d => d.pdf_attachment_url).length,
    withoutPdf: documents.filter(d => !d.pdf_attachment_url).length,
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <FileText className="h-8 w-8 animate-pulse mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">Cargando facturas publicadas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/dashboard">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Volver
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Facturas Publicadas en QuickBooks</h1>
              <p className="text-sm text-muted-foreground">
                {stats.total} factura{stats.total !== 1 ? 's' : ''} publicada{stats.total !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card className="p-6">
            <div className="flex items-center gap-3">
              <CheckCircle className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-sm text-muted-foreground">Total Publicadas</p>
              </div>
            </div>
          </Card>
          
          <Card className="p-6">
            <div className="flex items-center gap-3">
              <FileText className="h-8 w-8 text-blue-500" />
              <div>
                <p className="text-2xl font-bold">{stats.withPdf}</p>
                <p className="text-sm text-muted-foreground">Con PDF Adjunto</p>
              </div>
            </div>
          </Card>
          
          <Card className="p-6">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-yellow-500" />
              <div>
                <p className="text-2xl font-bold">{stats.withoutPdf}</p>
                <p className="text-sm text-muted-foreground">Sin PDF Adjunto</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Documents List */}
        {documents.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="text-muted-foreground">
              <p className="text-lg mb-2">No hay facturas publicadas aún</p>
              <p className="text-sm">Las facturas procesadas aparecerán aquí una vez publicadas en QuickBooks.</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-4">
            {documents.map((doc) => (
              <Card key={doc.id} className="p-6 hover:shadow-lg transition-shadow">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-start gap-3 mb-3">
                      {doc.pdf_attachment_url ? (
                        <CheckCircle className="h-5 w-5 text-green-500 mt-1 flex-shrink-0" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-yellow-500 mt-1 flex-shrink-0" />
                      )}
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                          <h3 className="font-semibold text-lg">
                            Factura #{doc.doc_number}
                          </h3>
                          <Badge variant={doc.pdf_attachment_url ? "default" : "secondary"} className="text-xs">
                            {doc.pdf_attachment_url ? "PDF Adjunto" : "Sin PDF"}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            QB ID: {doc.qbo_entity_id}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mb-1">
                          <span className="font-medium">Proveedor:</span> {doc.supplier_name}
                        </p>
                        <p className="text-sm text-muted-foreground mb-1">
                          <span className="font-medium">Fecha:</span> {new Date(doc.issue_date).toLocaleDateString('es-CR')}
                        </p>
                        <p className="text-sm text-muted-foreground mb-1">
                          <span className="font-medium">Monto:</span> {formatCurrency(doc.total_amount)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium">Publicada:</span> {new Date(doc.created_at).toLocaleString('es-CR')}
                        </p>
                      </div>
                    </div>

                    {!doc.pdf_attachment_url && (
                      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                        <p className="text-sm text-yellow-800 dark:text-yellow-200">
                          ⚠️ Esta factura no tiene PDF adjunto en QuickBooks
                        </p>
                      </div>
                    )}
                  </div>

                  {!doc.pdf_attachment_url && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleReattachPdf(doc.id, doc.doc_number)}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      Adjuntar PDF
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default PublishedDocuments;
