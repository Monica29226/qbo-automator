import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Search, RefreshCw, FileText, CheckCircle, Clock, AlertTriangle, Eye } from "lucide-react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { PdfViewer } from "@/components/PdfViewer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Invoice {
  id: string;
  doc_number: string;
  supplier_name: string;
  supplier_tax_id: string | null;
  total_amount: number;
  currency: string;
  issue_date: string;
  created_at: string;
  status: string;
  qbo_entity_id: string | null;
  pdf_attachment_url: string | null;
  default_account_ref: string | null;
  error_message: string | null;
}

const AllInvoices = () => {
  const { activeOrganization } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [pdfViewerOpen, setPdfViewerOpen] = useState(false);
  const [currentPdfUrl, setCurrentPdfUrl] = useState<string | null>(null);
  const [currentPdfName, setCurrentPdfName] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);

  const fetchAllInvoices = async () => {
    if (!activeOrganization) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("processed_documents")
        .select("*")
        .eq("organization_id", activeOrganization)
        .gte("issue_date", "2025-11-01")
        .order("issue_date", { ascending: false })
        .limit(500);

      if (error) throw error;
      setInvoices(data || []);
    } catch (error: any) {
      console.error("Error fetching invoices:", error);
      toast.error("Error al cargar facturas");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAllInvoices();

    if (!activeOrganization) return;

    const channel = supabase
      .channel('all_invoices_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'processed_documents',
          filter: `organization_id=eq.${activeOrganization}`
        },
        () => fetchAllInvoices()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeOrganization]);

  const filteredInvoices = useMemo(() => {
    let filtered = [...invoices];

    if (statusFilter !== "all") {
      if (statusFilter === "published") {
        filtered = filtered.filter(inv => inv.qbo_entity_id);
      } else if (statusFilter === "pending") {
        filtered = filtered.filter(inv => !inv.qbo_entity_id && inv.status !== "error");
      } else if (statusFilter === "error") {
        filtered = filtered.filter(inv => inv.status === "error");
      }
    }

    if (searchTerm.trim()) {
      const search = searchTerm.toLowerCase();
      filtered = filtered.filter(inv =>
        inv.doc_number.toLowerCase().includes(search) ||
        inv.supplier_name.toLowerCase().includes(search) ||
        (inv.supplier_tax_id && inv.supplier_tax_id.toLowerCase().includes(search))
      );
    }

    return filtered;
  }, [invoices, searchTerm, statusFilter]);

  const stats = useMemo(() => ({
    total: invoices.length,
    published: invoices.filter(i => i.qbo_entity_id).length,
    pending: invoices.filter(i => !i.qbo_entity_id && i.status !== "error").length,
    errors: invoices.filter(i => i.status === "error").length,
  }), [invoices]);

  const handleOpenPDF = async (invoice: Invoice) => {
    if (!invoice.pdf_attachment_url) {
      toast.error("No hay PDF disponible");
      return;
    }
    setCurrentPdfUrl(invoice.pdf_attachment_url);
    setCurrentPdfName(`Factura_${invoice.doc_number}.pdf`);
    setPdfViewerOpen(true);
  };

  const getStatusBadge = (invoice: Invoice) => {
    if (invoice.qbo_entity_id) {
      return <Badge className="bg-green-500 text-white"><CheckCircle className="h-3 w-3 mr-1" />Publicada</Badge>;
    }
    if (invoice.status === "error") {
      return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Error</Badge>;
    }
    return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pendiente</Badge>;
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('es-CR', {
      style: 'currency',
      currency: currency === 'USD' ? 'USD' : 'CRC',
      minimumFractionDigits: 2
    }).format(amount);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" asChild>
                <Link to="/dashboard">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Volver
                </Link>
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Todas las Facturas</h1>
                <p className="text-sm text-muted-foreground">
                  Historial completo de facturas recibidas por correo
                </p>
              </div>
            </div>
            <Button onClick={fetchAllInvoices} disabled={isLoading} variant="outline" size="sm">
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Actualizar
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter("all")}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <FileText className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-2xl font-bold">{stats.total}</p>
                  <p className="text-sm text-muted-foreground">Total Recibidas</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter("published")}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <CheckCircle className="h-8 w-8 text-green-500" />
                <div>
                  <p className="text-2xl font-bold">{stats.published}</p>
                  <p className="text-sm text-muted-foreground">En QuickBooks</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter("pending")}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Clock className="h-8 w-8 text-yellow-500" />
                <div>
                  <p className="text-2xl font-bold">{stats.pending}</p>
                  <p className="text-sm text-muted-foreground">Pendientes</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter("error")}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-8 w-8 text-red-500" />
                <div>
                  <p className="text-2xl font-bold">{stats.errors}</p>
                  <p className="text-sm text-muted-foreground">Con Errores</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-center">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por número, proveedor o cédula..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filtrar por estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="published">Publicadas en QB</SelectItem>
                  <SelectItem value="pending">Pendientes</SelectItem>
                  <SelectItem value="error">Con Errores</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredInvoices.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No hay facturas que mostrar</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Número</TableHead>
                    <TableHead>Proveedor</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Cuenta</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-center">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInvoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="whitespace-nowrap">
                        {format(new Date(invoice.issue_date), "dd/MM/yyyy", { locale: es })}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{invoice.doc_number}</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{invoice.supplier_name}</p>
                          {invoice.supplier_tax_id && (
                            <p className="text-xs text-muted-foreground">{invoice.supplier_tax_id}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap">
                        {formatCurrency(invoice.total_amount, invoice.currency)}
                      </TableCell>
                      <TableCell>
                        {invoice.default_account_ref ? (
                          <span className="text-xs">{invoice.default_account_ref}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Sin configurar</span>
                        )}
                      </TableCell>
                      <TableCell>{getStatusBadge(invoice)}</TableCell>
                      <TableCell>
                        <div className="flex justify-center gap-1">
                          {invoice.pdf_attachment_url && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenPDF(invoice)}
                            >
                              <FileText className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedInvoice(invoice);
                              setShowDetailDialog(true);
                            }}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>

      {/* PDF Viewer Dialog */}
      <Dialog open={pdfViewerOpen} onOpenChange={(open) => {
        if (!open) {
          setPdfViewerOpen(false);
          setCurrentPdfUrl(null);
        }
      }}>
        <DialogContent className="max-w-4xl h-[80vh]">
          <DialogHeader>
            <DialogTitle>{currentPdfName}</DialogTitle>
          </DialogHeader>
          {currentPdfUrl && (
            <div className="flex-1 h-full overflow-hidden">
              <PdfViewer url={currentPdfUrl} fileName={currentPdfName} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Detalle de Factura</DialogTitle>
          </DialogHeader>
          {selectedInvoice && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Número</p>
                  <p className="font-medium">{selectedInvoice.doc_number}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Fecha</p>
                  <p className="font-medium">
                    {format(new Date(selectedInvoice.issue_date), "dd/MM/yyyy", { locale: es })}
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="text-muted-foreground">Proveedor</p>
                  <p className="font-medium">{selectedInvoice.supplier_name}</p>
                  {selectedInvoice.supplier_tax_id && (
                    <p className="text-xs text-muted-foreground">{selectedInvoice.supplier_tax_id}</p>
                  )}
                </div>
                <div>
                  <p className="text-muted-foreground">Monto</p>
                  <p className="font-medium">
                    {formatCurrency(selectedInvoice.total_amount, selectedInvoice.currency)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Estado</p>
                  {getStatusBadge(selectedInvoice)}
                </div>
                {selectedInvoice.default_account_ref && (
                  <div className="col-span-2">
                    <p className="text-muted-foreground">Cuenta Contable</p>
                    <p className="font-medium">{selectedInvoice.default_account_ref}</p>
                  </div>
                )}
                {selectedInvoice.qbo_entity_id && (
                  <div className="col-span-2">
                    <p className="text-muted-foreground">ID QuickBooks</p>
                    <p className="font-mono text-xs">{selectedInvoice.qbo_entity_id}</p>
                  </div>
                )}
                {selectedInvoice.error_message && (
                  <div className="col-span-2">
                    <p className="text-muted-foreground">Error</p>
                    <p className="text-sm text-red-500">{selectedInvoice.error_message}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AllInvoices;
