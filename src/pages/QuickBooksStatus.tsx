import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Search, CheckCircle2, XCircle, Clock, FileText, HardDrive, ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface ProcessedDocument {
  id: string;
  doc_number: string;
  created_at: string;
  issue_date: string;
  supplier_name: string;
  supplier_tax_id: string | null;
  total_amount: number;
  qbo_entity_id: string | null;
  status: string;
  xml_data: any;
  currency: string;
  google_drive_pdf_id: string | null;
  google_drive_xml_id: string | null;
}

const QuickBooksStatus = () => {
  const navigate = useNavigate();
  const { activeOrganization } = useAuth();
  const [documents, setDocuments] = useState<ProcessedDocument[]>([]);
  const [filteredDocuments, setFilteredDocuments] = useState<ProcessedDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (activeOrganization) {
      fetchDocuments();
    } else {
      setIsLoading(false);
    }
  }, [activeOrganization]);

  useEffect(() => {
    filterDocuments();
  }, [searchTerm, documents]);

  const fetchDocuments = async () => {
    if (!activeOrganization) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("processed_documents")
        .select("*")
        .eq("organization_id", activeOrganization)
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) throw error;
      setDocuments(data || []);
    } catch (error) {
      console.error("Error fetching documents:", error);
      toast.error("Error al cargar documentos");
    } finally {
      setIsLoading(false);
    }
  };

  const filterDocuments = () => {
    if (!searchTerm.trim()) {
      setFilteredDocuments(documents);
      return;
    }

    const term = searchTerm.toLowerCase();
    const filtered = documents.filter(
      (doc) =>
        doc.doc_number.toLowerCase().includes(term) ||
        doc.supplier_name.toLowerCase().includes(term) ||
        (doc.supplier_tax_id && doc.supplier_tax_id.toLowerCase().includes(term))
    );
    setFilteredDocuments(filtered);
  };

  const formatCurrency = (amount: number, currency: string = "CRC") => {
    return new Intl.NumberFormat("es-CR", {
      style: "currency",
      currency: currency,
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("es-CR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  const getQBStatus = (doc: ProcessedDocument) => {
    if (doc.qbo_entity_id && doc.status === "published") {
      return {
        icon: <CheckCircle2 className="h-4 w-4" />,
        text: "Aceptado",
        variant: "default" as const,
        color: "text-green-600",
      };
    }
    if (doc.status === "error") {
      return {
        icon: <XCircle className="h-4 w-4" />,
        text: "Error",
        variant: "destructive" as const,
        color: "text-red-600",
      };
    }
    return {
      icon: <Clock className="h-4 w-4" />,
      text: "Pendiente",
      variant: "secondary" as const,
      color: "text-yellow-600",
    };
  };

  const getReceiverResponse = (xmlData: any) => {
    try {
      if (!xmlData) return "-";
      // Try to extract receiver response from XML data
      const response = xmlData?.MensajeReceptor?.MensajeHacienda;
      if (response === "1") return "Aceptado";
      if (response === "2") return "Aceptado Parcialmente";
      if (response === "3") return "Rechazado";
      return "-";
    } catch {
      return "-";
    }
  };

  const getHaciendaStatus = (xmlData: any) => {
    try {
      if (!xmlData) return "-";
      // Try to extract Hacienda status from XML data
      const status = xmlData?.SituacionComprobante;
      if (status === "aceptado") return "Aceptado";
      if (status === "rechazado") return "Rechazado";
      if (status === "procesando") return "Procesando";
      return "-";
    } catch {
      return "-";
    }
  };

  const openInGoogleDrive = (fileId: string, fileName: string) => {
    const driveUrl = `https://drive.google.com/file/d/${fileId}/view`;
    window.open(driveUrl, '_blank');
    toast.success(`Abriendo ${fileName} en Google Drive`);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Volver
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Estado QuickBooks</h1>
                <p className="text-sm text-muted-foreground">
                  Registro completo de facturas procesadas
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Facturas Procesadas ({filteredDocuments.length})
              </CardTitle>
              <div className="flex items-center gap-2 w-full max-w-sm">
                <div className="relative w-full">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por número, proveedor o cédula..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <Clock className="h-8 w-8 animate-spin mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Cargando facturas...</p>
                </div>
              </div>
            ) : filteredDocuments.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">
                  {searchTerm ? "No se encontraron resultados" : "No hay facturas"}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {searchTerm
                    ? "Intenta con otros términos de búsqueda"
                    : "Las facturas procesadas aparecerán aquí"}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                  <Table>
                   <TableHeader>
                    <TableRow>
                      <TableHead>No. Consecutivo</TableHead>
                      <TableHead>Fecha Registro</TableHead>
                      <TableHead>Fecha Factura</TableHead>
                      <TableHead>Proveedor</TableHead>
                      <TableHead>Cédula</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead>Respuesta Receptor</TableHead>
                      <TableHead>QB</TableHead>
                      <TableHead>R.Hacienda</TableHead>
                      <TableHead>Google Drive</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDocuments.map((doc) => {
                      const qbStatus = getQBStatus(doc);
                      return (
                        <TableRow key={doc.id}>
                          <TableCell className="font-medium">{doc.doc_number}</TableCell>
                          <TableCell>{formatDate(doc.created_at)}</TableCell>
                          <TableCell>{formatDate(doc.issue_date)}</TableCell>
                          <TableCell>{doc.supplier_name}</TableCell>
                          <TableCell>{doc.supplier_tax_id || "-"}</TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(doc.total_amount, doc.currency)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {getReceiverResponse(doc.xml_data)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className={qbStatus.color}>{qbStatus.icon}</span>
                              <Badge variant={qbStatus.variant} className="gap-1">
                                {qbStatus.text}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {getHaciendaStatus(doc.xml_data)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {(doc.google_drive_pdf_id || doc.google_drive_xml_id) ? (
                              <div className="flex gap-1">
                                {doc.google_drive_pdf_id && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => openInGoogleDrive(doc.google_drive_pdf_id!, 'PDF')}
                                    className="h-8 w-8 p-0"
                                    title="Ver PDF en Drive"
                                  >
                                    <FileText className="h-4 w-4" />
                                  </Button>
                                )}
                                {doc.google_drive_xml_id && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => openInGoogleDrive(doc.google_drive_xml_id!, 'XML')}
                                    className="h-8 w-8 p-0"
                                    title="Ver XML en Drive"
                                  >
                                    <HardDrive className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                // TODO: Add view details action
                                toast.info("Ver detalles próximamente");
                              }}
                            >
                              Ver
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default QuickBooksStatus;
