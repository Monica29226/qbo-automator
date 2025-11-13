import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PublishSingleDocButton } from "../PublishSingleDocButton";

interface UnpublishedDoc {
  id: string;
  doc_number: string;
  supplier_name: string;
  supplier_tax_id: string;
  issue_date: string;
  total_amount: number;
  currency: string;
  xml_data: any;
  status: string;
  error_message: string | null;
}

export const UnpublishedDocuments = () => {
  const { activeOrganization } = useAuth();
  const [documents, setDocuments] = useState<UnpublishedDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (activeOrganization) {
      fetchUnpublishedDocs();
    }
  }, [activeOrganization]);

  const fetchUnpublishedDocs = async () => {
    if (!activeOrganization) return;

    setIsLoading(true);
    const { data, error } = await supabase
      .from("processed_documents")
      .select("id, doc_number, supplier_name, supplier_tax_id, issue_date, total_amount, currency, xml_data, status, error_message")
      .eq("organization_id", activeOrganization)
      .in("status", ["processed", "review"])
      .is("qbo_entity_id", null)
      .order("created_at", { ascending: false })
      .limit(20);

    if (!error && data) {
      setDocuments(data as any);
    }
    setIsLoading(false);
  };

  const formatCurrency = (amount: number, currency: string = 'CRC') => {
    try {
      return new Intl.NumberFormat('es-CR', {
        style: 'currency',
        currency: currency || 'CRC',
        minimumFractionDigits: 2
      }).format(amount);
    } catch {
      return `${currency} ${amount.toLocaleString('es-CR', { minimumFractionDigits: 2 })}`;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Documentos Sin Publicar
          </CardTitle>
          <CardDescription>Cargando...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (documents.length === 0) {
    return null; // Don't show if there are no unpublished docs
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-yellow-500" />
          Documentos Procesados Sin Publicar a QuickBooks
        </CardTitle>
        <CardDescription>
          {documents.length} documento{documents.length !== 1 ? 's' : ''} procesado{documents.length !== 1 ? 's' : ''} pero no publicado{documents.length !== 1 ? 's' : ''} a QuickBooks
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {documents.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm truncate">{doc.doc_number}</span>
                  {doc.status === 'review' && (
                    <Badge variant="destructive" className="text-xs">
                      Requiere Revisión
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-xs">
                    {doc.xml_data?.cuentaContable || 'Sin cuenta'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground truncate mb-1">
                  {doc.supplier_name}
                </p>
                {doc.error_message && (
                  <p className="text-xs text-destructive mb-1 line-clamp-2">
                    {doc.error_message}
                  </p>
                )}
                {doc.status === 'review' && doc.error_message?.includes('vendor not in vendor_categories') && (
                  <p className="text-xs text-orange-600 mb-1">
                    → Agregar proveedor ID {doc.supplier_tax_id} en Configuración → Proveedores
                  </p>
                )}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{new Date(doc.issue_date).toLocaleDateString('es-CR')}</span>
                  <span className="font-semibold">{formatCurrency(doc.total_amount, doc.currency)}</span>
                </div>
              </div>
              <PublishSingleDocButton docNumber={doc.doc_number} documentId={doc.id} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
