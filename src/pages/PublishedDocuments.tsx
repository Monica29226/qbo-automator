import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle, ArrowLeft, FileText, AlertTriangle, ExternalLink, HardDrive, Search, Download, Calendar, DollarSign, Building2, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface PublishedDocument {
  id: string;
  doc_number: string;
  doc_key: string;
  supplier_name: string;
  supplier_tax_id: string | null;
  issue_date: string;
  total_amount: number;
  currency: string;
  qbo_entity_id: string;
  pdf_attachment_url: string | null;
  google_drive_pdf_id: string | null;
  google_drive_xml_id: string | null;
  created_at: string;
  processed_at: string | null;
}

const PublishedDocuments = () => {
  const { activeOrganization } = useAuth();
  const [documents, setDocuments] = useState<PublishedDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [vendorFilter, setVendorFilter] = useState<string>("all");

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
      .select("id, doc_number, doc_key, supplier_name, supplier_tax_id, issue_date, total_amount, currency, qbo_entity_id, pdf_attachment_url, google_drive_pdf_id, google_drive_xml_id, created_at, processed_at")
      .eq("organization_id", activeOrganization)
      .eq("status", "published")
      .not("qbo_entity_id", "is", null)
      .order("issue_date", { ascending: false })
      .limit(500);

    if (error) {
      toast.error("Error al cargar facturas: " + error.message);
    } else if (data) {
      setDocuments(data);
    }
    setIsLoading(false);
  };

  // Get unique vendors for filter
  const uniqueVendors = useMemo(() => {
    const vendors = [...new Set(documents.map(d => d.supplier_name))];
    return vendors.sort((a, b) => a.localeCompare(b, 'es'));
  }, [documents]);

  // Filtered documents
  const filteredDocuments = useMemo(() => {
    let filtered = documents;

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(d => 
        d.doc_number.toLowerCase().includes(term) ||
        d.supplier_name.toLowerCase().includes(term) ||
        d.qbo_entity_id.toLowerCase().includes(term) ||
        (d.supplier_tax_id && d.supplier_tax_id.includes(term))
      );
    }

    // Vendor filter
    if (vendorFilter !== "all") {
      filtered = filtered.filter(d => d.supplier_name === vendorFilter);
    }

    // Date filter
    if (dateFilter !== "all") {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      filtered = filtered.filter(d => {
        const issueDate = new Date(d.issue_date);
        switch (dateFilter) {
          case "today":
            return issueDate >= today;
          case "week":
            const weekAgo = new Date(today);
            weekAgo.setDate(weekAgo.getDate() - 7);
            return issueDate >= weekAgo;
          case "month":
            const monthAgo = new Date(today);
            monthAgo.setMonth(monthAgo.getMonth() - 1);
            return issueDate >= monthAgo;
          case "november":
            return issueDate.getMonth() === 10 && issueDate.getFullYear() === 2025;
          case "december":
            return issueDate.getMonth() === 11 && issueDate.getFullYear() === 2025;
          default:
            return true;
        }
      });
    }

    return filtered;
  }, [documents, searchTerm, vendorFilter, dateFilter]);

  const formatCurrency = (amount: number, currency: string = 'CRC') => {
    if (currency === 'USD') {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2
      }).format(amount);
    }
    return new Intl.NumberFormat('es-CR', {
      style: 'currency',
      currency: 'CRC',
      minimumFractionDigits: 2
    }).format(amount);
  };

  const openInGoogleDrive = (fileId: string, fileName: string) => {
    const driveUrl = `https://drive.google.com/file/d/${fileId}/view`;
    window.open(driveUrl, '_blank');
  };

  const exportToCSV = () => {
    const headers = ["Consecutivo", "Clave", "Proveedor", "Cédula", "Fecha", "Monto", "Moneda", "QB ID", "Publicada"];
    const rows = filteredDocuments.map(d => [
      d.doc_number,
      d.doc_key,
      d.supplier_name,
      d.supplier_tax_id || "",
      d.issue_date,
      d.total_amount,
      d.currency,
      d.qbo_entity_id,
      d.processed_at || d.created_at
    ]);
    
    const csvContent = [headers.join(","), ...rows.map(r => r.map(c => `"${c}"`).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `facturas_publicadas_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    toast.success(`Exportadas ${filteredDocuments.length} facturas a CSV`);
  };

  // Stats
  const stats = useMemo(() => {
    const total = filteredDocuments.length;
    const totalAmount = filteredDocuments.reduce((sum, d) => sum + d.total_amount, 0);
    const withPdf = filteredDocuments.filter(d => d.pdf_attachment_url).length;
    const inDrive = filteredDocuments.filter(d => d.google_drive_pdf_id || d.google_drive_xml_id).length;
    const uniqueVendorCount = new Set(filteredDocuments.map(d => d.supplier_name)).size;
    
    return { total, totalAmount, withPdf, inDrive, uniqueVendorCount };
  }, [filteredDocuments]);

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
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" asChild>
                <Link to="/dashboard">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Volver
                </Link>
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Reporte QuickBooks</h1>
                <p className="text-sm text-muted-foreground">
                  {stats.total} factura{stats.total !== 1 ? 's' : ''} publicada{stats.total !== 1 ? 's' : ''} | Total: {formatCurrency(stats.totalAmount)}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={fetchPublishedDocuments}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Actualizar
              </Button>
              <Button variant="outline" size="sm" onClick={exportToCSV}>
                <Download className="h-4 w-4 mr-2" />
                Exportar CSV
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="h-6 w-6 text-green-500" />
              <div>
                <p className="text-xl font-bold">{stats.total}</p>
                <p className="text-xs text-muted-foreground">Publicadas</p>
              </div>
            </div>
          </Card>
          
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <DollarSign className="h-6 w-6 text-emerald-500" />
              <div>
                <p className="text-xl font-bold">{formatCurrency(stats.totalAmount)}</p>
                <p className="text-xs text-muted-foreground">Monto Total</p>
              </div>
            </div>
          </Card>
          
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <Building2 className="h-6 w-6 text-blue-500" />
              <div>
                <p className="text-xl font-bold">{stats.uniqueVendorCount}</p>
                <p className="text-xs text-muted-foreground">Proveedores</p>
              </div>
            </div>
          </Card>
          
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <FileText className="h-6 w-6 text-purple-500" />
              <div>
                <p className="text-xl font-bold">{stats.withPdf}</p>
                <p className="text-xs text-muted-foreground">Con PDF</p>
              </div>
            </div>
          </Card>
          
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <HardDrive className="h-6 w-6 text-orange-500" />
              <div>
                <p className="text-xl font-bold">{stats.inDrive}</p>
                <p className="text-xs text-muted-foreground">En Drive</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Filters */}
        <Card className="p-4 mb-6">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por número, proveedor, cédula o QB ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            
            <Select value={vendorFilter} onValueChange={setVendorFilter}>
              <SelectTrigger className="w-[250px]">
                <SelectValue placeholder="Todos los proveedores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los proveedores</SelectItem>
                {uniqueVendors.map(vendor => (
                  <SelectItem key={vendor} value={vendor}>{vendor}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger className="w-[180px]">
                <Calendar className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las fechas</SelectItem>
                <SelectItem value="today">Hoy</SelectItem>
                <SelectItem value="week">Última semana</SelectItem>
                <SelectItem value="month">Último mes</SelectItem>
                <SelectItem value="november">Noviembre 2025</SelectItem>
                <SelectItem value="december">Diciembre 2025</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>

        {/* Documents Table */}
        {filteredDocuments.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="text-muted-foreground">
              <p className="text-lg mb-2">No hay facturas que coincidan con los filtros</p>
              <p className="text-sm">Intenta ajustar los filtros de búsqueda.</p>
            </div>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Consecutivo</th>
                    <th className="px-4 py-3 text-left font-medium">Proveedor</th>
                    <th className="px-4 py-3 text-left font-medium">Cédula</th>
                    <th className="px-4 py-3 text-left font-medium">Fecha</th>
                    <th className="px-4 py-3 text-right font-medium">Monto</th>
                    <th className="px-4 py-3 text-center font-medium">QB ID</th>
                    <th className="px-4 py-3 text-center font-medium">PDF</th>
                    <th className="px-4 py-3 text-center font-medium">Drive</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredDocuments.map((doc) => (
                    <tr key={doc.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs">{doc.doc_number.slice(-8)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium">{doc.supplier_name}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-muted-foreground text-xs">{doc.supplier_tax_id || "-"}</span>
                      </td>
                      <td className="px-4 py-3">
                        {new Date(doc.issue_date).toLocaleDateString('es-CR')}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatCurrency(doc.total_amount, doc.currency)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant="outline" className="font-mono text-xs">
                          {doc.qbo_entity_id}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {doc.pdf_attachment_url ? (
                          <CheckCircle className="h-4 w-4 text-green-500 mx-auto" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-yellow-500 mx-auto" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex justify-center gap-1">
                          {doc.google_drive_pdf_id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => openInGoogleDrive(doc.google_drive_pdf_id!, 'PDF')}
                              title="Ver PDF en Drive"
                            >
                              <FileText className="h-3 w-3" />
                            </Button>
                          )}
                          {doc.google_drive_xml_id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => openInGoogleDrive(doc.google_drive_xml_id!, 'XML')}
                              title="Ver XML en Drive"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </Button>
                          )}
                          {!doc.google_drive_pdf_id && !doc.google_drive_xml_id && (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </main>
    </div>
  );
};

export default PublishedDocuments;
