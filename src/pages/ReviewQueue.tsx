import React, { useState, useEffect } from "react";
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
import { FileText, ArrowLeft, Loader2, CheckCircle, X, Eye, ChevronDown, ChevronUp } from "lucide-react";
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
  supplier_email: string | null;
  total_amount: number;
  total_tax: number | null;
  total_discount: number | null;
  currency: string;
  exchange_rate: number | null;
  error_message: string | null;
  vendor_id: string | null;
  default_account_ref: string | null;
  pdf_attachment_url: string | null;
  file_path: string | null;
  status: string;
  qbo_entity_id: string | null;
  xml_data: any;
  processed_at: string | null;
  created_at: string;
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

const EditableAccountField = ({ doc, accounts, activeOrganization, onUpdated }: {
  doc: Document;
  accounts: Account[];
  activeOrganization: string | null;
  onUpdated: () => void;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleAccountChange = async (accountId: string) => {
    if (!activeOrganization) return;
    setIsSaving(true);

    const selectedAcc = accounts.find(a => a.id === accountId);
    const accountRef = selectedAcc?.accountNumber
      ? `${selectedAcc.accountNumber} ${selectedAcc.name}`
      : selectedAcc?.name || accountId;

    try {
      // Update document
      await supabase
        .from("processed_documents")
        .update({
          default_account_ref: accountRef,
          status: "pending",
          error_message: null,
        })
        .eq("id", doc.id);

      // Also update vendor_defaults for future invoices
      await supabase
        .from("vendor_defaults")
        .upsert({
          vendor_name: doc.supplier_name,
          default_account_ref: accountRef,
          organization_id: activeOrganization,
        }, { onConflict: "organization_id,vendor_name" });

      // Update all other error/pending docs from same supplier
      await supabase
        .from("processed_documents")
        .update({
          default_account_ref: accountRef,
          status: "pending",
          error_message: null,
        })
        .eq("organization_id", activeOrganization)
        .eq("supplier_name", doc.supplier_name)
        .in("status", ["error", "pending_config", "review"]);

      toast.success(`Cuenta actualizada a ${accountRef} para ${doc.supplier_name}`);
      setIsEditing(false);
      onUpdated();
    } catch (err) {
      console.error(err);
      toast.error("Error al actualizar cuenta");
    } finally {
      setIsSaving(false);
    }
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-1 mt-0.5">
        <AccountCombobox
          accounts={accounts.map(a => ({
            id: a.id,
            name: a.name,
            accountNumber: a.accountNumber || undefined,
          }))}
          value=""
          onValueChange={handleAccountChange}
          placeholder="Buscar cuenta..."
          disabled={isSaving}
        />
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setIsEditing(false)}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
      className="font-medium text-left hover:text-primary hover:underline cursor-pointer transition-colors"
      title="Clic para cambiar cuenta"
    >
      {doc.default_account_ref || "Sin asignar ✏️"}
    </button>
  );
};

const ReviewQueue = () => {
  const { activeOrganization, organizations } = useAuth();
  const currentOrg = organizations.find((org) => org.id === activeOrganization);
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
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);

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
        .gte("issue_date", "2026-01-01")
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
    // Mostrar PDF automáticamente si está disponible
    setShowPdfPreview(!!(doc.pdf_attachment_url || doc.file_path));
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
              <p className="text-xs text-muted-foreground">
                {currentOrg ? <span className="font-semibold">{currentOrg.name}</span> : "Documentos"} — Documentos pendientes de clasificación manual
              </p>
            </div>
          </div>
          {documents.filter(d => d.status === "review").length > 0 ? (
            <Badge variant="secondary" className="text-lg px-4 py-2">
              {documents.filter(d => d.status === "review").length} pendientes
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-lg px-4 py-2 bg-green-100 text-green-800 border-green-300">
              ✓ Al día
            </Badge>
          )}
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
              <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Sin documentos</h3>
              <p className="text-muted-foreground">No se encontraron documentos para esta empresa</p>
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
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
              {[...documents].sort((a, b) => {
                const statusOrder: Record<string, number> = { error: 0, pending: 1, pending_config: 1, review: 1, processed: 2, published: 3 };
                const aOrder = statusOrder[a.status] ?? 2;
                const bOrder = statusOrder[b.status] ?? 2;
                if (aOrder !== bOrder) return aOrder - bOrder;
                return new Date(b.issue_date).getTime() - new Date(a.issue_date).getTime();
              }).map((doc) => {
                const isExpanded = expandedDocId === doc.id;
                const lines = doc.xml_data?.lineas || doc.xml_data?.items || [];
                const vendor = vendors.find(v => v.id === doc.vendor_id);
                const isNC = doc.doc_type?.toLowerCase().includes("nota") || doc.doc_type?.toLowerCase().includes("credit") || doc.doc_type === "NC" || doc.doc_type === "ND";
                return (
                  <React.Fragment key={doc.id}>
                    <TableRow 
                      className={`cursor-pointer hover:bg-muted/60 transition-colors ${isNC ? "bg-purple-50/50" : ""}`}
                      onClick={() => setExpandedDocId(isExpanded ? null : doc.id)}
                    >
                      <TableCell className="font-mono text-sm">
                        <div className="flex items-center gap-2">
                          {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          {doc.doc_number}
                          {isNC && <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-300 text-[10px] px-1.5 py-0">NC</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>{new Date(doc.issue_date).toLocaleDateString("es-CR")}</TableCell>
                      <TableCell className="font-medium">{doc.supplier_name}</TableCell>
                      <TableCell>{doc.supplier_tax_id || "-"}</TableCell>
                      <TableCell className="font-semibold">
                        {formatCurrency(doc.total_amount, doc.currency)}
                      </TableCell>
                      <TableCell>
                        {doc.status === "review" ? (
                          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">Pendiente</Badge>
                        ) : doc.status === "published" ? (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300">Publicada</Badge>
                        ) : doc.status === "error" ? (
                          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300">Error</Badge>
                        ) : doc.status === "processed" ? (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300">Procesada</Badge>
                        ) : (
                          <Badge variant="outline">{doc.status}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {(doc.pdf_attachment_url || doc.file_path) && (
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={(e) => { e.stopPropagation(); openPdfOnly(doc); }}
                              title="Ver PDF"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          )}
                          {doc.status === "review" && (
                            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); openDialog(doc); }}>
                              Revisar
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-muted/30 p-0">
                          <div className="px-6 py-4">
                            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                              {/* Left: document info + lines (3/5) */}
                              <div className="lg:col-span-3 space-y-3">
                                <div className="flex gap-6">
                                  <div className="flex-1 grid grid-cols-3 gap-x-6 gap-y-2 text-sm">
                                    <div>
                                      <span className="text-muted-foreground block text-xs">Tipo documento</span>
                                      <span className="font-medium">{doc.doc_type || "-"}</span>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground block text-xs">Moneda</span>
                                      <span className="font-medium">{doc.currency}{doc.exchange_rate ? ` (TC: ${doc.exchange_rate})` : ""}</span>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground block text-xs">Email proveedor</span>
                                      <span className="font-medium text-xs">{doc.supplier_email || "-"}</span>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground block text-xs">Vendor QBO</span>
                                      <span className="font-medium">{vendor?.vendor_name || "-"}</span>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground block text-xs">Cuenta asignada</span>
                                      {doc.status !== "published" ? (
                                        <EditableAccountField
                                          doc={doc}
                                          accounts={accounts}
                                          activeOrganization={activeOrganization}
                                          onUpdated={fetchData}
                                        />
                                      ) : (
                                        <span className="font-medium">{doc.default_account_ref || "-"}</span>
                                      )}
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground block text-xs">QBO ID</span>
                                      <span className="font-medium">{doc.qbo_entity_id || "-"}</span>
                                    </div>
                                  </div>

                                  <div className="border rounded overflow-hidden w-56 shrink-0 self-start">
                                    <table className="w-full text-sm">
                                      <tbody>
                                        {(doc.total_discount || 0) > 0 && (
                                          <tr className="bg-muted/20">
                                            <td className="px-3 py-1 text-muted-foreground">Venta bruta</td>
                                            <td className="px-3 py-1 text-right font-medium">{formatCurrency((doc.total_amount - (doc.total_tax || 0) + (doc.total_discount || 0)), doc.currency)}</td>
                                          </tr>
                                        )}
                                        {(doc.total_discount || 0) > 0 && (
                                          <tr className="bg-muted/20">
                                            <td className="px-3 py-1 text-muted-foreground">Descuento</td>
                                            <td className="px-3 py-1 text-right font-medium text-destructive">-{formatCurrency(doc.total_discount || 0, doc.currency)}</td>
                                          </tr>
                                        )}
                                        <tr className="bg-muted/20">
                                          <td className="px-3 py-1 text-muted-foreground">Subtotal</td>
                                          <td className="px-3 py-1 text-right font-medium">{formatCurrency((doc.total_amount - (doc.total_tax || 0)), doc.currency)}</td>
                                        </tr>
                                        <tr className="bg-muted/20">
                                          <td className="px-3 py-1 text-muted-foreground">Impuestos</td>
                                          <td className="px-3 py-1 text-right font-medium">{formatCurrency(doc.total_tax || 0, doc.currency)}</td>
                                        </tr>
                                        <tr className="bg-muted/30 border-t">
                                          <td className="px-3 py-1.5 font-semibold">Total</td>
                                          <td className="px-3 py-1.5 text-right font-semibold">{formatCurrency(doc.total_amount, doc.currency)}</td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  </div>
                                </div>

                                {doc.error_message && (
                                  <div className="text-sm p-2 rounded bg-red-50 text-red-700 border border-red-200">
                                    <span className="font-medium">Error: </span>{doc.error_message}
                                  </div>
                                )}

                                {lines.length > 0 && (
                                  <div>
                                    <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase">Detalle de líneas</h4>
                                    <div className="border rounded overflow-hidden">
                                      <table className="w-full text-sm">
                                        <thead className="bg-muted/50">
                                          <tr>
                                            <th className="text-left px-3 py-1.5 font-medium">Descripción</th>
                                            <th className="text-right px-3 py-1.5 font-medium">Cant</th>
                                            <th className="text-right px-3 py-1.5 font-medium">Precio</th>
                                            <th className="text-right px-3 py-1.5 font-medium">IVA</th>
                                            <th className="text-right px-3 py-1.5 font-medium">Subtotal</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {lines.map((line: any, idx: number) => (
                                            <tr key={idx} className="border-t">
                                              <td className="px-3 py-1.5">{line.descripcion || line.description || "-"}</td>
                                              <td className="px-3 py-1.5 text-right">{line.cantidad || line.quantity || 1}</td>
                                              <td className="px-3 py-1.5 text-right">{formatCurrency(line.precioUnitario || line.unitPrice || 0, doc.currency)}</td>
                                              <td className="px-3 py-1.5 text-right">{line.montoImpuesto || line.taxAmount || 0}</td>
                                              <td className="px-3 py-1.5 text-right">{formatCurrency(line.montoTotalLinea || line.lineTotal || 0, doc.currency)}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                )}

                                <div className="text-xs text-muted-foreground">
                                  <span className="font-medium">Clave: </span>
                                  <span className="font-mono">{doc.doc_key}</span>
                                </div>
                              </div>

                              {/* Right: inline PDF viewer (2/5) */}
                              <div className="lg:col-span-2 border rounded-lg overflow-hidden" style={{ height: '500px' }}>
                                <PdfViewer
                                  url={doc.pdf_attachment_url || undefined}
                                  storagePath={doc.file_path || undefined}
                                  fileName={doc.doc_number}
                                  organizationId={activeOrganization || undefined}
                                  docNumber={doc.doc_number}
                                  documentId={doc.id}
                                  onPdfDownloaded={() => fetchData()}
                                />
                              </div>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
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
                    organizationId={activeOrganization || undefined}
                    docNumber={selectedDoc.doc_number}
                    documentId={selectedDoc.id}
                    onPdfDownloaded={(newUrl) => {
                      setDocuments(prev => prev.map(d => 
                        d.id === selectedDoc.id 
                          ? { ...d, pdf_attachment_url: newUrl }
                          : d
                      ));
                      setSelectedDoc(prev => prev ? { ...prev, pdf_attachment_url: newUrl } : null);
                    }}
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
            <DialogDescription className="sr-only">
              Vista previa del documento en PDF
            </DialogDescription>
          </DialogHeader>
          {pdfOnlyDoc && (
            <div className="h-[600px]">
              <PdfViewer 
                url={pdfOnlyDoc.pdf_attachment_url || undefined}
                storagePath={pdfOnlyDoc.file_path || undefined}
                fileName={`${pdfOnlyDoc.doc_number}-${pdfOnlyDoc.supplier_name}`}
                organizationId={activeOrganization || undefined}
                docNumber={pdfOnlyDoc.doc_number}
                documentId={pdfOnlyDoc.id}
                onPdfDownloaded={(newUrl) => {
                  // Actualizar el documento en la lista local
                  setDocuments(prev => prev.map(d => 
                    d.id === pdfOnlyDoc.id 
                      ? { ...d, pdf_attachment_url: newUrl }
                      : d
                  ));
                  setPdfOnlyDoc(prev => prev ? { ...prev, pdf_attachment_url: newUrl } : null);
                }}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ReviewQueue;
