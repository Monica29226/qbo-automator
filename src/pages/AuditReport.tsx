import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, ArrowLeft, Download, AlertTriangle, CheckCircle2, Search, RefreshCw } from "lucide-react";
import { OrganizationSwitcher } from "@/components/OrganizationSwitcher";
import { toast } from "sonner";

interface AuditDocument {
  id: string;
  doc_number: string;
  doc_type: string;
  supplier_name: string;
  issue_date: string;
  total_amount: number;
  currency: string;
  status: string;
  qbo_entity_id: string | null;
  qbo_entity_type: string | null;
  xml_data: any;
  vendor_id: string | null;
  error_message: string | null;
  processed_at: string | null;
}

interface VendorRule {
  vendor_name: string;
  account_code: string;
  account_description: string | null;
}

export default function AuditReport() {
  const { activeOrganization } = useAuth();
  const [documents, setDocuments] = useState<AuditDocument[]>([]);
  const [vendorRules, setVendorRules] = useState<VendorRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRepublishing, setIsRepublishing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");

  useEffect(() => {
    if (activeOrganization) {
      fetchData();
    } else {
      setIsLoading(false);
    }
  }, [activeOrganization]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Fetch ALL documents (sin filtro de fecha para auditoría completa)
      const { data: docs, error: docsError } = await supabase
        .from("processed_documents")
        .select("*")
        .eq("organization_id", activeOrganization)
        .order("issue_date", { ascending: false })
        .limit(1000);

      if (docsError) throw docsError;

      // Fetch vendor rules
      const { data: rules, error: rulesError } = await supabase
        .from("vendor_classification_rules")
        .select("vendor_name, account_code, account_description")
        .eq("organization_id", activeOrganization)
        .eq("is_active", true);

      if (rulesError) throw rulesError;

      console.log(`📊 Audit Report: ${docs?.length || 0} documents loaded`);
      setDocuments(docs || []);
      setVendorRules(rules || []);
    } catch (error) {
      console.error("Error fetching audit data:", error);
      toast.error("Error al cargar los datos de auditoría");
    } finally {
      setIsLoading(false);
    }
  };

  const getAccountForDocument = (doc: AuditDocument): string => {
    // Try to get from vendor rule
    const rule = vendorRules.find(r => 
      r.vendor_name.toLowerCase() === doc.supplier_name.toLowerCase()
    );
    
    if (rule) {
      return rule.account_code.split(" ")[0];
    }

    // Try to get from xml_data
    if (doc.xml_data?.cuentaContable) {
      return doc.xml_data.cuentaContable.split(" ")[0];
    }

    // Default account
    return "60";
  };

  const getAccountDescription = (accountCode: string): string => {
    const rule = vendorRules.find(r => r.account_code.startsWith(accountCode));
    return rule?.account_description || "Sin descripción";
  };

  const filteredDocuments = documents.filter(doc => {
    const matchesSearch = 
      doc.doc_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.supplier_name.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || doc.status === statusFilter;
    
    const docAccount = getAccountForDocument(doc);
    const matchesAccount = accountFilter === "all" || docAccount === accountFilter;
    
    return matchesSearch && matchesStatus && matchesAccount;
  });

  const exportToCSV = () => {
    const csvData = filteredDocuments.map(doc => ({
      "Número": doc.doc_number,
      "Tipo": doc.doc_type,
      "Proveedor": doc.supplier_name,
      "Fecha": doc.issue_date,
      "Monto": doc.total_amount,
      "Moneda": doc.currency,
      "Cuenta Contable": getAccountForDocument(doc),
      "Descripción Cuenta": getAccountDescription(getAccountForDocument(doc)),
      "Estado": doc.status,
      "QBO ID": doc.qbo_entity_id || "N/A",
      "Error": doc.error_message || ""
    }));

    const headers = Object.keys(csvData[0]);
    const csv = [
      headers.join(","),
      ...csvData.map(row => headers.map(header => `"${row[header as keyof typeof row]}"`).join(","))
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auditoria_facturas_${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    toast.success("Reporte exportado correctamente");
  };

  const handleRepublishCreditNotes = async () => {
    if (!activeOrganization) return;

    const creditNotes = documents.filter(d => d.doc_type === "NC" && d.status === "processed");
    
    if (creditNotes.length === 0) {
      toast.info("No hay notas de crédito publicadas para republicar");
      return;
    }

    const confirmed = window.confirm(
      `Se van a republicar ${creditNotes.length} notas de crédito con montos negativos.\n\n` +
      "Esto eliminará las NC existentes en QuickBooks y las volverá a crear correctamente.\n\n" +
      "¿Deseas continuar?"
    );

    if (!confirmed) return;

    setIsRepublishing(true);
    toast.info(`Republicando ${creditNotes.length} notas de crédito...`);

    try {
      const { data, error } = await supabase.functions.invoke("republish-credit-notes", {
        body: { organization_id: activeOrganization },
      });

      if (error) throw error;

      toast.success(
        `✓ ${data.republished} NC republicadas correctamente (${data.deleted} eliminadas, ${data.failed} fallidas)`
      );

      // Recargar datos
      await fetchData();
    } catch (error) {
      console.error("Error republishing credit notes:", error);
      toast.error("Error al republicar notas de crédito");
    } finally {
      setIsRepublishing(false);
    }
  };

  const uniqueAccounts = Array.from(new Set(documents.map(getAccountForDocument))).sort();

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      published: "default",
      processed: "secondary",
      error: "destructive",
      pending: "outline",
    };

    const labels: Record<string, string> = {
      published: "Publicado",
      processed: "Procesado",
      error: "Error",
      pending: "Pendiente",
    };

    return (
      <Badge variant={variants[status] || "outline"}>
        {labels[status] || status}
      </Badge>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <div className="container mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/dashboard">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                Reporte de Auditoría
              </h1>
              <p className="text-muted-foreground">
                Análisis detallado de facturas publicadas y cuentas contables
              </p>
            </div>
          </div>
          <OrganizationSwitcher />
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Facturas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{documents.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Publicadas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {documents.filter(d => d.status === "processed" || d.status === "duplicate").length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Con Errores
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">
                {documents.filter(d => d.status === "error").length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Cuentas Únicas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{uniqueAccounts.length}</div>
            </CardContent>
          </Card>
        </div>

        {/* Filters and Export */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Facturas Procesadas</CardTitle>
                <CardDescription>
                  Filtrar y analizar facturas por cuenta contable
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button 
                  onClick={handleRepublishCreditNotes} 
                  variant="outline"
                  disabled={isRepublishing}
                  className="border-orange-500 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950"
                >
                  {isRepublishing ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Republicando...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Republicar NC
                    </>
                  )}
                </Button>
                <Button onClick={exportToCSV} variant="outline">
                  <Download className="h-4 w-4 mr-2" />
                  Exportar CSV
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Filters */}
            <div className="grid gap-4 md:grid-cols-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por número o proveedor..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filtrar por estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los estados</SelectItem>
                  <SelectItem value="published">Publicado</SelectItem>
                  <SelectItem value="processed">Procesado</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                  <SelectItem value="pending">Pendiente</SelectItem>
                </SelectContent>
              </Select>
              <Select value={accountFilter} onValueChange={setAccountFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filtrar por cuenta" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las cuentas</SelectItem>
                  {uniqueAccounts.map(account => (
                    <SelectItem key={account} value={account}>
                      {account} - {getAccountDescription(account)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Table */}
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Número</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Proveedor</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Monto</TableHead>
                      <TableHead>Cuenta Contable</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>QBO ID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDocuments.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                          No se encontraron facturas
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredDocuments.map((doc) => {
                        const accountCode = getAccountForDocument(doc);
                        const accountDesc = getAccountDescription(accountCode);
                        
                        return (
                          <TableRow key={doc.id}>
                            <TableCell className="font-mono text-sm">
                              {doc.doc_number}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{doc.doc_type}</Badge>
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate">
                              {doc.supplier_name}
                            </TableCell>
                            <TableCell>
                              {new Date(doc.issue_date).toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              {doc.currency} {doc.total_amount.toLocaleString()}
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <div className="font-semibold">{accountCode}</div>
                                <div className="text-xs text-muted-foreground">
                                  {accountDesc}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>{getStatusBadge(doc.status)}</TableCell>
                            <TableCell>
                              {doc.qbo_entity_id ? (
                                <div className="flex items-center gap-1 text-green-600">
                                  <CheckCircle2 className="h-4 w-4" />
                                  <span className="font-mono text-xs">
                                    {doc.qbo_entity_id}
                                  </span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 text-muted-foreground">
                                  <AlertTriangle className="h-4 w-4" />
                                  <span className="text-xs">Sin publicar</span>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="text-sm text-muted-foreground">
              Mostrando {filteredDocuments.length} de {documents.length} facturas
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
