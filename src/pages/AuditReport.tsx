import { useState, useEffect, useCallback } from "react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileText, ArrowLeft, Download, AlertTriangle, CheckCircle2, Search, RefreshCw, ExternalLink, Send } from "lucide-react";
import { OrganizationSwitcher } from "@/components/OrganizationSwitcher";
import { PdfViewer } from "@/components/PdfViewer";
import { AccountCombobox } from "@/components/AccountCombobox";
import { useQBOAccounts } from "@/hooks/useQBOAccounts";
import { usePublishQueue } from "@/hooks/usePublishQueue";
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
  default_account_ref: string | null;
  pdf_attachment_url: string | null;
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
  const [docTypeFilter, setDocTypeFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [selectedDocument, setSelectedDocument] = useState<AuditDocument | null>(null);
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [assigningDocId, setAssigningDocId] = useState<string | null>(null);

  const { accounts, getAccountById } = useQBOAccounts();
  const { addToQueue } = usePublishQueue();

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
      const { data: docs, error: docsError } = await supabase
        .from("processed_documents")
        .select("*")
        .eq("organization_id", activeOrganization)
        .order("issue_date", { ascending: false })
        .limit(1000);

      if (docsError) throw docsError;

      const { data: rules, error: rulesError } = await supabase
        .from("vendor_classification_rules")
        .select("vendor_name, account_code, account_description")
        .eq("organization_id", activeOrganization)
        .eq("is_active", true);

      if (rulesError) throw rulesError;

      setDocuments(docs || []);
      setVendorRules(rules || []);
    } catch (error) {
      console.error("Error fetching audit data:", error);
      toast.error("Error al cargar los datos de auditoría");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAssignAccount = useCallback(async (doc: AuditDocument, accountId: string) => {
    if (!activeOrganization || assigningDocId) return;
    
    const account = getAccountById(accountId);
    if (!account) return;

    setAssigningDocId(doc.id);
    const accountRef = account.accountNumber 
      ? `${account.accountNumber} ${account.name}` 
      : account.name;

    try {
      // 1. Update this document
      await supabase
        .from("processed_documents")
        .update({ 
          default_account_ref: accountRef, 
          status: "processed",
          error_message: null 
        })
        .eq("id", doc.id);

      // 2. Update ALL docs from same vendor without account
      const { data: sameVendorDocs } = await supabase
        .from("processed_documents")
        .select("id")
        .eq("organization_id", activeOrganization)
        .eq("supplier_name", doc.supplier_name)
        .is("qbo_entity_id", null)
        .neq("id", doc.id);

      if (sameVendorDocs && sameVendorDocs.length > 0) {
        await supabase
          .from("processed_documents")
          .update({ 
            default_account_ref: accountRef, 
            status: "processed",
            error_message: null 
          })
          .in("id", sameVendorDocs.map(d => d.id));
      }

      // 3. Save vendor_defaults rule for future invoices
      await supabase
        .from("vendor_defaults")
        .upsert({
          organization_id: activeOrganization,
          vendor_name: doc.supplier_name,
          default_account_ref: accountRef,
        }, { onConflict: "organization_id,vendor_name" });

      // 4. Save vendor_classification_rules too
      await supabase
        .from("vendor_classification_rules")
        .upsert({
          organization_id: activeOrganization,
          vendor_name: doc.supplier_name,
          account_code: accountRef,
          account_description: account.name,
          is_active: true,
        }, { onConflict: "organization_id,vendor_name" });

      const allDocIds = [doc.id, ...(sameVendorDocs?.map(d => d.id) || [])];
      const totalUpdated = allDocIds.length;

      toast.success(`✅ ${doc.supplier_name}: cuenta asignada a ${totalUpdated} factura(s). Publicando...`);

      // 5. Auto-publish all updated docs
      addToQueue({
        documentIds: allDocIds,
        vendorName: doc.supplier_name,
        organizationId: activeOrganization,
      });

      // 6. Refresh data
      await fetchData();
    } catch (error: any) {
      console.error("Error assigning account:", error);
      toast.error(`Error al asignar cuenta: ${error.message}`);
    } finally {
      setAssigningDocId(null);
    }
  }, [activeOrganization, getAccountById, addToQueue, assigningDocId]);

  const handlePublishUnpublished = useCallback(async (doc: AuditDocument) => {
    if (!activeOrganization) return;

    toast.info(`Publicando ${doc.doc_number}...`);
    addToQueue({
      documentIds: [doc.id],
      vendorName: doc.supplier_name,
      organizationId: activeOrganization,
    });
  }, [activeOrganization, addToQueue]);

  const getAccountForDocument = (doc: AuditDocument): string => {
    if (doc.default_account_ref) {
      return doc.default_account_ref.split(" ")[0];
    }
    const rule = vendorRules.find(r => 
      r.vendor_name.toLowerCase() === doc.supplier_name.toLowerCase()
    );
    if (rule) {
      return rule.account_code.split(" ")[0];
    }
    if (doc.xml_data?.cuentaContable) {
      return doc.xml_data.cuentaContable.split(" ")[0];
    }
    return "Sin asignar";
  };

  const getAccountDescriptionFromDoc = (doc: AuditDocument): string => {
    if (doc.default_account_ref && doc.default_account_ref.includes(" ")) {
      return doc.default_account_ref.split(" ").slice(1).join(" ");
    }
    const accountCode = getAccountForDocument(doc);
    const rule = vendorRules.find(r => r.account_code.startsWith(accountCode));
    return rule?.account_description || "Sin descripción";
  };

  const getAccountDescriptionFromCode = (accountCode: string): string => {
    const rule = vendorRules.find(r => r.account_code.startsWith(accountCode));
    return rule?.account_description || accountCode;
  };

  const getDocTypeCategory = (docType: string): "factura" | "nota_credito" => {
    const ncTypes = ["NotaCreditoElectronica", "NC"];
    return ncTypes.includes(docType) ? "nota_credito" : "factura";
  };

  const filteredDocuments = documents.filter(doc => {
    const matchesSearch = 
      doc.doc_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.supplier_name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || doc.status === statusFilter;
    const matchesDocType = docTypeFilter === "all" || getDocTypeCategory(doc.doc_type) === docTypeFilter;
    const docAccount = getAccountForDocument(doc);
    const matchesAccount = accountFilter === "all" || docAccount === accountFilter;
    return matchesSearch && matchesStatus && matchesDocType && matchesAccount;
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
      "Descripción Cuenta": getAccountDescriptionFromDoc(doc),
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
      review: "outline",
    };
    const labels: Record<string, string> = {
      published: "Publicado",
      processed: "Procesado",
      error: "Error",
      pending: "Pendiente",
      review: "Revisión",
    };
    return (
      <Badge variant={variants[status] || "outline"}>
        {labels[status] || status}
      </Badge>
    );
  };

  const needsAccountAssignment = (doc: AuditDocument) => 
    !doc.qbo_entity_id && !doc.default_account_ref && 
    (doc.status === "review" || doc.status === "pending" || doc.status === "pending_config");

  const canPublish = (doc: AuditDocument) => 
    !doc.qbo_entity_id && doc.default_account_ref && 
    (doc.status === "processed" || doc.status === "review" || doc.status === "pending");

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
        <div className="grid gap-4 md:grid-cols-5">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Facturas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{documents.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Publicadas en QBO</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {documents.filter(d => d.qbo_entity_id !== null).length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Sin Cuenta</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-500">
                {documents.filter(d => needsAccountAssignment(d)).length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Listas para Publicar</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-500">
                {documents.filter(d => canPublish(d)).length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Con Errores</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">
                {documents.filter(d => d.status === "error").length}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters and Export */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Facturas Procesadas</CardTitle>
                <CardDescription>Filtrar y analizar facturas por cuenta contable</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button 
                  onClick={handleRepublishCreditNotes} 
                  variant="outline"
                  disabled={isRepublishing}
                  className="border-orange-500 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950"
                >
                  {isRepublishing ? (
                    <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Republicando...</>
                  ) : (
                    <><RefreshCw className="h-4 w-4 mr-2" />Republicar NC</>
                  )}
                </Button>
                <Button onClick={exportToCSV} variant="outline">
                  <Download className="h-4 w-4 mr-2" />Exportar CSV
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Filters */}
            <div className="grid gap-4 md:grid-cols-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por número o proveedor..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={docTypeFilter} onValueChange={setDocTypeFilter}>
                <SelectTrigger><SelectValue placeholder="Filtrar por tipo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los tipos</SelectItem>
                  <SelectItem value="factura">Factura</SelectItem>
                  <SelectItem value="nota_credito">Nota de Crédito (NC)</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue placeholder="Filtrar por estado" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los estados</SelectItem>
                  <SelectItem value="published">Publicado</SelectItem>
                  <SelectItem value="processed">Procesado</SelectItem>
                  <SelectItem value="review">Revisión</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                  <SelectItem value="pending">Pendiente</SelectItem>
                </SelectContent>
              </Select>
              <Select value={accountFilter} onValueChange={setAccountFilter}>
                <SelectTrigger><SelectValue placeholder="Filtrar por cuenta" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las cuentas</SelectItem>
                  {uniqueAccounts.map(account => (
                    <SelectItem key={account} value={account}>
                      {account} - {getAccountDescriptionFromCode(account)}
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
                      <TableHead className="min-w-[200px]">Cuenta Contable</TableHead>
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
                        const accountDesc = getAccountDescriptionFromDoc(doc);
                        const showAccountPicker = needsAccountAssignment(doc);
                        const showPublishBtn = canPublish(doc);
                        
                        return (
                          <TableRow key={doc.id} className={showAccountPicker ? "bg-orange-50/50 dark:bg-orange-950/10" : ""}>
                            <TableCell className="font-mono text-sm">
                              {doc.pdf_attachment_url ? (
                                <button
                                  onClick={() => {
                                    setSelectedDocument(doc);
                                    setPdfDialogOpen(true);
                                  }}
                                  className="text-primary hover:underline cursor-pointer flex items-center gap-1"
                                >
                                  {doc.doc_number}
                                  <ExternalLink className="h-3 w-3" />
                                </button>
                              ) : (
                                <span className="text-muted-foreground">{doc.doc_number}</span>
                              )}
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
                              {showAccountPicker ? (
                                <AccountCombobox
                                  accounts={accounts}
                                  value=""
                                  onValueChange={(accountId) => handleAssignAccount(doc, accountId)}
                                  placeholder="Asignar cuenta..."
                                  disabled={assigningDocId === doc.id}
                                  className="w-full text-xs h-8"
                                />
                              ) : (
                                <div className="space-y-1">
                                  <div className="font-semibold">{accountCode}</div>
                                  <div className="text-xs text-muted-foreground">{accountDesc}</div>
                                </div>
                              )}
                            </TableCell>
                            <TableCell>{getStatusBadge(doc.status)}</TableCell>
                            <TableCell>
                              {doc.qbo_entity_id ? (
                                <div className="flex items-center gap-1 text-green-600">
                                  <CheckCircle2 className="h-4 w-4" />
                                  <span className="font-mono text-xs">{doc.qbo_entity_id}</span>
                                </div>
                              ) : showPublishBtn ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs border-blue-500 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
                                  onClick={() => handlePublishUnpublished(doc)}
                                >
                                  <Send className="h-3 w-3 mr-1" />
                                  Publicar
                                </Button>
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

        {/* PDF Viewer Dialog */}
        <Dialog open={pdfDialogOpen} onOpenChange={setPdfDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Factura #{selectedDocument?.doc_number}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                <span className="font-medium">Proveedor:</span> {selectedDocument?.supplier_name}
                {" | "}
                <span className="font-medium">Fecha:</span> {selectedDocument?.issue_date && new Date(selectedDocument.issue_date).toLocaleDateString()}
                {" | "}
                <span className="font-medium">Monto:</span> {selectedDocument?.currency} {selectedDocument?.total_amount?.toLocaleString()}
              </div>
              {selectedDocument?.pdf_attachment_url ? (
                <PdfViewer 
                  url={selectedDocument.pdf_attachment_url} 
                  fileName={`factura_${selectedDocument.doc_number}`}
                />
              ) : (
                <div className="flex items-center justify-center h-64 bg-muted rounded-md">
                  <p className="text-muted-foreground">No hay PDF disponible para este documento</p>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
