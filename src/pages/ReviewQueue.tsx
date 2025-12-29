import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { FileText, ArrowLeft, Loader2, CheckCircle, X, Eye } from "lucide-react";
import { PdfViewer } from "@/components/PdfViewer";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { AccountCombobox } from "@/components/AccountCombobox";

interface Document {
  id: string;
  doc_key: string;
  doc_number: string;
  doc_type: string;
  issue_date: string;
  supplier_name: string;
  supplier_tax_id: string | null;
  total_amount: number;
  currency: string;
  error_message: string | null;
  vendor_id: string | null;
  default_account_ref: string | null;
  pdf_attachment_url: string | null;
  file_path: string | null;
}

interface Vendor {
  id: string;
  vendor_name: string;
  qbo_vendor_ref: string;
}

interface Account {
  id: string;
  name: string;
  accountNumber?: string | null;
}

const ReviewQueue = () => {
  const { activeOrganization } = useAuth();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [selectedVendor, setSelectedVendor] = useState<string>("");
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [pdfOnlyDoc, setPdfOnlyDoc] = useState<Document | null>(null);
  const [isPdfDialogOpen, setIsPdfDialogOpen] = useState(false);

  useEffect(() => {
    if (activeOrganization) {
      fetchData();
    } else {
      setIsLoading(false);
    }
  }, [activeOrganization]);

  const fetchData = async () => {
    if (!activeOrganization) return;

    setIsLoading(true);
    
    // Fetch documents, vendors, and accounts in parallel
    const [docsResult, vendorsResult, accountsResult] = await Promise.all([
      supabase
        .from("processed_documents")
        .select("*")
        .eq("organization_id", activeOrganization)
        .eq("status", "review")
        .gte("issue_date", "2025-11-01")
        .order("issue_date", { ascending: false }),
      supabase
        .from("vendors")
        .select("id, vendor_name, qbo_vendor_ref")
        .eq("organization_id", activeOrganization)
        .eq("is_active", true)
        .order("vendor_name"),
      supabase.functions.invoke("list-quickbooks-accounts", {
        body: { organization_id: activeOrganization }
      })
    ]);

    if (docsResult.error) {
      toast.error("Error al cargar documentos");
      console.error(docsResult.error);
    } else {
      setDocuments(docsResult.data || []);
    }

    if (vendorsResult.error) {
      toast.error("Error al cargar proveedores");
      console.error(vendorsResult.error);
    } else {
      setVendors(vendorsResult.data || []);
    }

    // Process accounts - usar formato correcto
    if (accountsResult.data?.accounts) {
      const formattedAccounts = accountsResult.data.accounts
        .filter((acc: any) => acc.active !== false) // Solo cuentas activas
        .map((acc: any) => ({
          id: acc.id, // ID interno de QB (ej: "158")
          name: acc.name, // Nombre (ej: "Alimentos y Bebidas")
          accountNumber: acc.accountNumber || null // AcctNum (ej: "6310")
        }))
        .sort((a: Account, b: Account) => {
          // Ordenar por número de cuenta si existe, luego por nombre
          if (a.accountNumber && b.accountNumber) {
            return a.accountNumber.localeCompare(b.accountNumber, undefined, { numeric: true });
          }
          if (a.accountNumber) return -1;
          if (b.accountNumber) return 1;
          return a.name.localeCompare(b.name);
        });
      
      console.log(`📊 Cuentas cargadas para Review: ${formattedAccounts.length}`);
      setAccounts(formattedAccounts);
    } else {
      console.warn('⚠️ No se recibieron cuentas de QuickBooks');
    }

    setIsLoading(false);
  };

  const openDialog = (doc: Document) => {
    setSelectedDoc(doc);
    setSelectedVendor(doc.vendor_id || "");
    setSelectedAccount(doc.default_account_ref || "");
    setShowPdfPreview(false);
    setIsDialogOpen(true);
  };

  const handleViewPdf = () => {
    setShowPdfPreview(true);
  };

  const openPdfOnly = (doc: Document) => {
    setPdfOnlyDoc(doc);
    setIsPdfDialogOpen(true);
  };

  const handleApprove = async () => {
    if (!selectedDoc || !selectedAccount) {
      toast.error("Seleccione una cuenta contable");
      return;
    }

    // Obtener el código de cuenta formateado correctamente
    const selectedAccountObj = accounts.find(acc => acc.id === selectedAccount);
    const accountRef = selectedAccountObj?.accountNumber 
      ? `${selectedAccountObj.accountNumber} ${selectedAccountObj.name}`
      : selectedAccountObj?.name || selectedAccount;
    
    console.log('📌 Guardando cuenta:', { id: selectedAccount, ref: accountRef, supplier: selectedDoc.supplier_name });

    // OPTIMISTIC UI UPDATE - Cerrar diálogo y actualizar lista inmediatamente
    const supplierName = selectedDoc.supplier_name;
    const affectedDocs = documents.filter(d => d.supplier_name === supplierName);
    
    setDocuments(prev => prev.filter(d => d.supplier_name !== supplierName));
    setIsDialogOpen(false);
    
    toast.success(
      affectedDocs.length > 1 
        ? `${affectedDocs.length} facturas de ${supplierName} clasificadas`
        : "Documento clasificado - listo para publicar"
    );

    // BACKGROUND OPERATIONS - No bloquean el UI
    Promise.allSettled([
      // 1. Guardar vendor default
      supabase
        .from("vendor_defaults")
        .upsert({
          vendor_name: supplierName,
          default_account_ref: accountRef,
          organization_id: activeOrganization,
        }, {
          onConflict: 'organization_id,vendor_name'
        }),
      
      // 2. Actualizar TODAS las facturas del mismo proveedor
      supabase
        .from("processed_documents")
        .update({
          vendor_id: selectedVendor || null,
          default_account_ref: accountRef,
          status: "pending",
          error_message: null,
        })
        .eq("organization_id", activeOrganization)
        .eq("supplier_name", supplierName)
        .eq("status", "review")
    ]).then(results => {
      const errors = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value?.error));
      if (errors.length > 0) {
        console.error('❌ Errores en operaciones background:', errors);
        // Recargar datos si hubo errores para sincronizar estado
        fetchData();
      } else {
        console.log(`✅ ${affectedDocs.length} facturas de ${supplierName} guardadas en BD`);
      }
    });
  };

  const handleReject = async () => {
    if (!selectedDoc) return;

    setIsProcessing(true);

    const { error } = await supabase
      .from("processed_documents")
      .update({
        status: "error",
        error_message: "Rechazado manualmente",
      })
      .eq("id", selectedDoc.id);

    setIsProcessing(false);

    if (error) {
      toast.error("Error al rechazar documento");
      console.error(error);
    } else {
      toast.success("Documento rechazado");
      setIsDialogOpen(false);
      fetchData();
    }
  };

  const formatCurrency = (amount: number, currency: string) => {
    const symbol = currency === "USD" ? "$" : "₡";
    return `${symbol}${amount.toLocaleString("es-CR", { minimumFractionDigits: 2 })}`;
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/dashboard">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Volver
              </Link>
            </Button>
            <div className="h-10 w-10 rounded-lg bg-warning flex items-center justify-center">
              <FileText className="h-6 w-6 text-warning-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Cola de Revisión</h1>
              <p className="text-xs text-muted-foreground">Documentos pendientes de clasificación manual</p>
            </div>
          </div>
          <Badge variant="secondary" className="text-lg px-4 py-2">
            {documents.length} pendientes
          </Badge>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <Card className="p-6">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle className="h-16 w-16 text-success mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">¡Todo al día!</h3>
              <p className="text-muted-foreground">No hay documentos pendientes de revisión</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Cédula</TableHead>
                  <TableHead>Monto</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
              {documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="font-mono text-sm">
                      {(doc.pdf_attachment_url || doc.file_path) ? (
                        <button
                          onClick={() => openPdfOnly(doc)}
                          className="text-primary hover:text-primary/80 hover:underline cursor-pointer font-mono"
                          title="Ver PDF de la factura"
                        >
                          {doc.doc_number}
                        </button>
                      ) : (
                        doc.doc_number
                      )}
                    </TableCell>
                    <TableCell>{new Date(doc.issue_date).toLocaleDateString("es-CR")}</TableCell>
                    <TableCell className="font-medium">{doc.supplier_name}</TableCell>
                    <TableCell>{doc.supplier_tax_id || "-"}</TableCell>
                    <TableCell className="font-semibold">
                      {formatCurrency(doc.total_amount, doc.currency)}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {doc.error_message || "Sin clasificar"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {(doc.pdf_attachment_url || doc.file_path) && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => openPdfOnly(doc)}
                            title="Ver PDF"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        )}
                        <Button variant="outline" size="sm" onClick={() => openDialog(doc)}>
                          Revisar
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </main>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className={showPdfPreview ? "max-w-6xl max-h-[90vh]" : "max-w-2xl"}>
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Revisar Documento</span>
              {selectedDoc && (selectedDoc.pdf_attachment_url || selectedDoc.file_path) && (
                <Button 
                  variant={showPdfPreview ? "default" : "outline"} 
                  size="sm" 
                  onClick={() => setShowPdfPreview(!showPdfPreview)}
                  className="ml-4"
                >
                  <Eye className="h-4 w-4 mr-2" />
                  {showPdfPreview ? "Ocultar PDF" : "Ver PDF"}
                </Button>
              )}
            </DialogTitle>
            <DialogDescription>
              Asigne la cuenta contable para este documento
            </DialogDescription>
          </DialogHeader>

          {selectedDoc && (
            <div className={showPdfPreview ? "grid grid-cols-2 gap-4" : ""}>
              {/* Panel izquierdo - Datos del documento */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
                  <div>
                    <p className="text-xs text-muted-foreground">Número</p>
                    <p className="font-semibold">{selectedDoc.doc_number}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Fecha</p>
                    <p className="font-semibold">
                      {new Date(selectedDoc.issue_date).toLocaleDateString("es-CR")}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Proveedor</p>
                    <p className="font-semibold">{selectedDoc.supplier_name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Cédula</p>
                    <p className="font-semibold">{selectedDoc.supplier_tax_id || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Monto Total</p>
                    <p className="font-semibold text-lg">
                      {formatCurrency(selectedDoc.total_amount, selectedDoc.currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Motivo de Revisión</p>
                    <p className="text-sm text-warning">{selectedDoc.error_message || "Sin clasificar"}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="account">Cuenta Contable *</Label>
                  <AccountCombobox
                    accounts={accounts}
                    value={selectedAccount}
                    onValueChange={setSelectedAccount}
                    placeholder="Seleccione cuenta contable..."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="vendor">Proveedor QBO (opcional)</Label>
                  <Select value={selectedVendor} onValueChange={setSelectedVendor}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccione un proveedor..." />
                    </SelectTrigger>
                    <SelectContent>
                      {vendors.map((vendor) => (
                        <SelectItem key={vendor.id} value={vendor.id}>
                          {vendor.vendor_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Panel derecho - Vista previa del PDF */}
              {showPdfPreview && (
                <div className="border rounded-lg overflow-hidden h-[500px]">
                  <PdfViewer 
                    url={selectedDoc.pdf_attachment_url || undefined}
                    storagePath={selectedDoc.file_path || undefined}
                    fileName={`${selectedDoc.doc_number}-${selectedDoc.supplier_name}`}
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleReject} disabled={isProcessing}>
              <X className="mr-2 h-4 w-4" />
              Rechazar
            </Button>
            <Button onClick={handleApprove} disabled={isProcessing || !selectedAccount}>
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Procesando...
                </>
              ) : (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Aprobar
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo solo para ver PDF */}
      <Dialog open={isPdfDialogOpen} onOpenChange={setIsPdfDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>
              {pdfOnlyDoc ? `${pdfOnlyDoc.doc_number} - ${pdfOnlyDoc.supplier_name}` : "Ver PDF"}
            </DialogTitle>
          </DialogHeader>
          {pdfOnlyDoc && (
            <div className="h-[600px]">
              <PdfViewer 
                url={pdfOnlyDoc.pdf_attachment_url || undefined}
                storagePath={pdfOnlyDoc.file_path || undefined}
                fileName={`${pdfOnlyDoc.doc_number}-${pdfOnlyDoc.supplier_name}`}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ReviewQueue;
