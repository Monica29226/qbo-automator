import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { AccountCombobox } from "@/components/AccountCombobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Search, Trash2, Upload, Star, Eye, FileText } from "lucide-react";
import { PublishValidationDialog } from "@/components/PublishValidationDialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface QBOAccount {
  id: string;
  name: string;
  accountNumber: string;
  accountType: string;
}

interface VendorDefault {
  id: string;
  vendor_name: string;
  default_account_ref: string | null;
  default_uses_tax: boolean;
}

interface PendingInvoice {
  id: string;
  doc_number: string;
  supplier_name: string;
  supplier_tax_id: string | null;
  total_amount: number;
  currency: string;
  created_at: string;
  vendor_id: string | null;
  default_account_ref?: string;
  default_class_ref?: string | null;
  uses_tax?: boolean;
  has_vendor_default?: boolean;
  pdf_attachment_url?: string | null;
  xml_data?: any;
  issue_date?: string;
}

const InvoicesPendingLog = () => {
  const { activeOrganization } = useAuth();
  const [invoices, setInvoices] = useState<PendingInvoice[]>([]);
  const [filteredInvoices, setFilteredInvoices] = useState<PendingInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set());
  const [qboAccounts, setQboAccounts] = useState<QBOAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [vendorDefaults, setVendorDefaults] = useState<Map<string, VendorDefault>>(new Map());
  const [selectedInvoice, setSelectedInvoice] = useState<PendingInvoice | null>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);

  const fetchVendorDefaults = async () => {
    if (!activeOrganization) return;

    try {
      const { data, error } = await supabase
        .from("vendor_defaults")
        .select("*")
        .eq("organization_id", activeOrganization);

      if (error) throw error;

      const defaultsMap = new Map<string, VendorDefault>();
      data?.forEach((def) => {
        defaultsMap.set(def.vendor_name, def);
      });
      setVendorDefaults(defaultsMap);
    } catch (error: any) {
      console.error("Error fetching vendor defaults:", error);
    }
  };

  const fetchQBOAccounts = async () => {
    if (!activeOrganization) return;
    
    setLoadingAccounts(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "list-quickbooks-accounts",
        {
          body: { organization_id: activeOrganization },
        }
      );

      if (error) throw error;
      
      if (data?.accounts) {
        setQboAccounts(data.accounts);
      }
    } catch (error: any) {
      console.error("Error fetching QBO accounts:", error);
      toast.error("Error al cargar cuentas de QuickBooks");
    } finally {
      setLoadingAccounts(false);
    }
  };

  const fetchPendingInvoices = async () => {
    if (!activeOrganization) return;

    setIsLoading(true);
    try {
      // Fetch documents
      const { data: docsData, error: docsError } = await supabase
        .from("processed_documents")
        .select("*")
        .eq("organization_id", activeOrganization)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (docsError) throw docsError;

      if (!docsData || docsData.length === 0) {
        setInvoices([]);
        setFilteredInvoices([]);
        return;
      }

      // Get unique vendor IDs (filter out nulls)
      const vendorIds = [...new Set(docsData.map(doc => doc.vendor_id).filter(Boolean))];
      
      // Batch fetch all vendors at once (OPTIMIZACIÓN: Una sola query en lugar de N queries)
      let vendorsMap = new Map();
      if (vendorIds.length > 0) {
        const { data: vendorsData } = await supabase
          .from("vendors")
          .select("id, default_account_ref, default_class_ref")
          .in("id", vendorIds);

        vendorsData?.forEach(vendor => {
          vendorsMap.set(vendor.id, vendor);
        });
      }

      // Apply vendor data and defaults in memory (OPTIMIZACIÓN: Sin queries adicionales)
      const invoicesWithVendors = docsData.map((doc) => {
        let invoiceData: PendingInvoice = { 
          ...doc,
          default_account_ref: undefined,
          default_class_ref: undefined,
          has_vendor_default: false
        };
        
        // Apply vendor data from batch fetch
        if (doc.vendor_id && vendorsMap.has(doc.vendor_id)) {
          const vendorData = vendorsMap.get(doc.vendor_id);
          invoiceData.default_account_ref = vendorData.default_account_ref;
          invoiceData.default_class_ref = vendorData.default_class_ref;
        }

        // Apply vendor defaults if available
        const vendorDefault = vendorDefaults.get(doc.supplier_name);
        if (vendorDefault) {
          const hasDefaultApplied = !invoiceData.default_account_ref || !invoiceData.uses_tax;
          
          if (!invoiceData.default_account_ref && vendorDefault.default_account_ref) {
            invoiceData.default_account_ref = vendorDefault.default_account_ref;
          }
          if (invoiceData.uses_tax === null || invoiceData.uses_tax === undefined) {
            invoiceData.uses_tax = vendorDefault.default_uses_tax;
          }
          
          invoiceData.has_vendor_default = hasDefaultApplied;
        }
        
        return invoiceData;
      });

      setInvoices(invoicesWithVendors);
      setFilteredInvoices(invoicesWithVendors);
    } catch (error: any) {
      console.error("Error fetching pending invoices:", error);
      toast.error("Error al cargar facturas pendientes");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      // OPTIMIZACIÓN: Cargar todo en paralelo en lugar de secuencial
      await Promise.all([
        fetchVendorDefaults(),
        fetchQBOAccounts(),
      ]);
      // Fetch invoices después de tener los defaults para aplicarlos correctamente
      await fetchPendingInvoices();
    };
    loadData();

    // Suscripción realtime para actualizaciones automáticas
    if (!activeOrganization) return;

    const channel = supabase
      .channel('pending_invoices_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'processed_documents',
          filter: `organization_id=eq.${activeOrganization}`
        },
        (payload) => {
          console.log('📡 Realtime: Documento actualizado', payload);
          fetchPendingInvoices();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'vendor_defaults',
          filter: `organization_id=eq.${activeOrganization}`
        },
        (payload) => {
          console.log('📡 Realtime: Vendor default actualizado', payload);
          fetchVendorDefaults();
          fetchPendingInvoices();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'vendor_classification_rules',
          filter: `organization_id=eq.${activeOrganization}`
        },
        (payload) => {
          console.log('📡 Realtime: Regla de clasificación actualizada', payload);
          fetchPendingInvoices();
        }
      )
      .subscribe((status) => {
        console.log('📡 Realtime subscription status:', status);
      });

    return () => {
      console.log('📡 Cerrando suscripción realtime');
      supabase.removeChannel(channel);
    };
  }, [activeOrganization]);

  // OPTIMIZACIÓN: Memoizar el mapa de accounts para búsquedas rápidas
  const accountsMap = useMemo(() => {
    const map = new Map();
    qboAccounts.forEach(acc => map.set(acc.id, acc));
    return map;
  }, [qboAccounts]);

  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredInvoices(invoices);
      return;
    }

    const searchLower = searchTerm.toLowerCase();
    
    const filtered = invoices.filter((inv) => {
      // Buscar por número de documento
      if (inv.doc_number.toLowerCase().includes(searchLower)) return true;
      
      // Buscar por nombre de proveedor
      if (inv.supplier_name.toLowerCase().includes(searchLower)) return true;
      
      // Buscar por cuenta contable
      if (inv.default_account_ref && inv.default_account_ref.toLowerCase().includes(searchLower)) return true;
      
      // Buscar en la descripción de la cuenta (OPTIMIZACIÓN: uso de Map en lugar de find)
      if (inv.default_account_ref && accountsMap.has(inv.default_account_ref)) {
        const account = accountsMap.get(inv.default_account_ref);
        if (account.name.toLowerCase().includes(searchLower)) return true;
        if (account.accountNumber && account.accountNumber.toLowerCase().includes(searchLower)) return true;
      }
      
      return false;
    });
    setFilteredInvoices(filtered);
  }, [searchTerm, invoices, accountsMap]);

  const saveVendorDefault = async (
    vendorName: string,
    accountRef: string | null,
    usesTax: boolean
  ) => {
    if (!activeOrganization) return;

    try {
      // 1. Guardar en vendor_defaults
      const { data, error } = await supabase
        .from("vendor_defaults")
        .upsert(
          {
            organization_id: activeOrganization,
            vendor_name: vendorName,
            default_account_ref: accountRef,
            default_uses_tax: usesTax,
          },
          { onConflict: "organization_id,vendor_name" }
        )
        .select()
        .single();

      if (error) throw error;

      // 2. Crear/actualizar regla de clasificación para futuras facturas
      if (accountRef) {
        const accountInfo = qboAccounts.find(acc => 
          `${acc.accountNumber} - ${acc.name}` === accountRef || 
          acc.accountNumber === accountRef
        );
        
        const { error: ruleError } = await supabase
          .from("vendor_classification_rules")
          .upsert(
            {
              organization_id: activeOrganization,
              vendor_name: vendorName,
              account_code: accountInfo?.accountNumber || accountRef,
              account_description: accountInfo?.name || "Cuenta configurada desde Log Pendientes",
              is_active: true,
            },
            { onConflict: "organization_id,vendor_name" }
          );

        if (ruleError) {
          console.error("Error creating classification rule:", ruleError);
        } else {
          console.log(`✓ Regla de clasificación creada para ${vendorName}: ${accountRef}`);
        }
      }

      // 3. Update local cache
      if (data) {
        setVendorDefaults((prev) => {
          const newMap = new Map(prev);
          newMap.set(vendorName, data);
          return newMap;
        });
      }
    } catch (error: any) {
      console.error("Error saving vendor default:", error);
    }
  };

  const handleUpdateInvoice = async (
    id: string,
    field: string,
    value: string | boolean
  ) => {
    try {
      const invoice = invoices.find((inv) => inv.id === id);
      if (!invoice) return;

      console.log('💾 Guardando campo:', field, 'valor:', value, 'para factura:', id);

      // CRÍTICO: Actualizar processed_documents SIEMPRE que cambie un campo
      const { error: docUpdateError } = await supabase
        .from("processed_documents")
        .update({ [field]: value })
        .eq("id", id);

      if (docUpdateError) {
        console.error('❌ Error actualizando processed_documents:', docUpdateError);
        throw docUpdateError;
      }

      console.log('✅ Campo actualizado en processed_documents');

      // If updating account or class, also update the vendor record
      if (field === "default_account_ref" || field === "default_class_ref") {
        if (invoice.vendor_id) {
          const { error } = await supabase
            .from("vendors")
            .update({ [field]: value })
            .eq("id", invoice.vendor_id);

          if (error) {
            console.error('⚠️ Error actualizando vendor (no crítico):', error);
          }
        }

        // Save as vendor default if updating account
        if (field === "default_account_ref") {
          await saveVendorDefault(
            invoice.supplier_name,
            value as string,
            invoice.uses_tax ?? true
          );
          
          toast.success(`✓ Configuración guardada para ${invoice.supplier_name}. Se aplicará a futuras facturas.`);
          
          // AUTO-PUBLICAR: Si se asignó una cuenta contable válida, publicar automáticamente
          if (value && typeof value === 'string' && value.trim() !== '') {
            toast.info("Publicando factura automáticamente a QuickBooks...");
            try {
              const { data, error: publishError } = await supabase.functions.invoke(
                "publish-to-quickbooks",
                {
                  body: { organization_id: activeOrganization, document_ids: [id] },
                }
              );

              if (publishError) throw publishError;

              toast.success("✓ Factura publicada exitosamente a QuickBooks");
              // Refrescar la lista para que desaparezca de pendientes
              await fetchPendingInvoices();
              return; // Exit early since we refreshed the list
            } catch (publishError: any) {
              console.error("Error publishing invoice:", publishError);
              toast.error("Cuenta guardada pero error al publicar: " + (publishError.message || "Error desconocido"));
            }
          }
        }
      }

      // If updating uses_tax, also save as vendor default
      if (field === "uses_tax") {
        await saveVendorDefault(
          invoice.supplier_name,
          invoice.default_account_ref || null,
          value as boolean
        );
      }

      // Update local state
      setInvoices((prev) =>
        prev.map((inv) => (inv.id === id ? { ...inv, [field]: value } : inv))
      );
      
      if (field !== "default_account_ref") {
        toast.success("Actualizado correctamente");
      }
    } catch (error: any) {
      console.error("Error updating invoice:", error);
      toast.error(`Error al actualizar: ${error.message || 'Error desconocido'}`);
    }
  };

  const handleDeleteInvoice = async (id: string) => {
    try {
      const { error } = await supabase
        .from("processed_documents")
        .delete()
        .eq("id", id);

      if (error) throw error;

      setInvoices((prev) => prev.filter((inv) => inv.id !== id));
      toast.success("Factura eliminada");
    } catch (error: any) {
      console.error("Error deleting invoice:", error);
      toast.error("Error al eliminar factura");
    }
  };

  const handlePublishSingle = async (id: string) => {
    setPublishingIds((prev) => new Set(prev).add(id));
    try {
      const { data, error } = await supabase.functions.invoke(
        "publish-to-quickbooks",
        {
          body: { organization_id: activeOrganization, document_ids: [id] },
        }
      );

      if (error) throw error;

      toast.success("Factura publicada correctamente");
      await fetchPendingInvoices();
    } catch (error: any) {
      console.error("Error publishing invoice:", error);
      toast.error(error.message || "Error al publicar factura");
    } finally {
      setPublishingIds((prev) => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    }
  };

  const handlePublishAll = async () => {
    if (filteredInvoices.length === 0) {
      toast.error("No hay facturas para publicar");
      return;
    }

    setIsPublishing(true);
    try {
      const documentIds = filteredInvoices.map((inv) => inv.id);
      const { data, error } = await supabase.functions.invoke(
        "publish-to-quickbooks",
        {
          body: { organization_id: activeOrganization, document_ids: documentIds },
        }
      );

      if (error) throw error;

      toast.success(`${filteredInvoices.length} facturas publicadas correctamente`);
      await fetchPendingInvoices();
      setShowPublishDialog(false);
    } catch (error: any) {
      console.error("Error publishing all:", error);
      toast.error(error.message || "Error al publicar facturas");
    } finally {
      setIsPublishing(false);
    }
  };

  const handleOpenPDF = async (invoice: PendingInvoice) => {
    console.log("🔍 handleOpenPDF llamado para:", invoice.doc_number);
    console.log("📎 PDF URL:", invoice.pdf_attachment_url);
    
    if (!invoice.pdf_attachment_url) {
      console.warn("⚠️ PDF no disponible para:", invoice.doc_number);
      toast.error("PDF no disponible para esta factura");
      return;
    }

    try {
      toast.loading("Generando enlace de descarga...");
      
      // Extraer el path del storage de la URL
      let pdfPath = invoice.pdf_attachment_url;
      if (pdfPath.includes('/object/public/company-documents/')) {
        pdfPath = pdfPath.split('/object/public/company-documents/')[1];
      } else if (pdfPath.includes('company-documents/')) {
        pdfPath = pdfPath.split('company-documents/')[1];
      }
      
      // Generar URL firmada con 1 hora de validez
      const { data, error } = await supabase.storage
        .from('company-documents')
        .createSignedUrl(pdfPath, 3600);

      if (error) throw error;

      toast.dismiss();
      console.log("✅ URL firmada generada");
      
      const opened = window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
      
      if (!opened) {
        console.error("❌ window.open fue bloqueado por el navegador");
        toast.error("El navegador bloqueó la ventana emergente. Por favor, permite ventanas emergentes para este sitio.");
      } else {
        console.log("✅ PDF abierto exitosamente");
        toast.success("Abriendo PDF...");
      }
    } catch (error: any) {
      toast.dismiss();
      console.error("❌ Error al abrir PDF:", error);
      toast.error(`Error al abrir PDF: ${error.message}`);
    }
  };

  const handleShowDetail = (invoice: PendingInvoice) => {
    setSelectedInvoice(invoice);
    setShowDetailDialog(true);
  };

  // OPTIMIZACIÓN: Memoizar totales por proveedor
  const totalsBySupplier = useMemo(() => {
    return filteredInvoices.reduce((acc, inv) => {
      if (!acc[inv.supplier_name]) {
        acc[inv.supplier_name] = 0;
      }
      acc[inv.supplier_name] += inv.total_amount;
      return acc;
    }, {} as Record<string, number>);
  }, [filteredInvoices]);

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat("es-CR", {
      style: "currency",
      currency: currency || "CRC",
    }).format(amount);
  };

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Log de Facturas Pendientes</h1>
          <p className="text-muted-foreground">
            Gestiona y configura las facturas antes de publicar a QuickBooks
          </p>
        </div>
        <Button
          onClick={() => setShowPublishDialog(true)}
          disabled={filteredInvoices.length === 0 || isPublishing}
          size="lg"
        >
          {isPublishing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Publicando...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 mr-2" />
              Publicar Todas ({filteredInvoices.length})
            </>
          )}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por número de factura, proveedor o cuenta contable..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : filteredInvoices.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No hay facturas pendientes
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Número</TableHead>
                    <TableHead>Proveedor</TableHead>
                    <TableHead>Monto</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Cuenta Contable</TableHead>
                    <TableHead>Centro de Costo</TableHead>
                    <TableHead>Usa IVA</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInvoices.map((invoice) => (
                    <TableRow 
                      key={invoice.id}
                      className="hover:bg-muted/50"
                    >
                      <TableCell 
                        className="font-medium cursor-pointer hover:underline hover:text-primary"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          handleOpenPDF(invoice);
                        }}
                      >
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>{invoice.doc_number}</span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Doble click para ver PDF</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{invoice.supplier_name}</div>
                          {invoice.supplier_tax_id && (
                            <div className="text-xs text-muted-foreground">
                              {invoice.supplier_tax_id}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {formatCurrency(invoice.total_amount, invoice.currency)}
                      </TableCell>
                      <TableCell>
                        {new Date(invoice.created_at).toLocaleDateString("es-CR")}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <AccountCombobox
                            accounts={qboAccounts}
                            value={invoice.default_account_ref || ""}
                            onValueChange={(value) =>
                              handleUpdateInvoice(
                                invoice.id,
                                "default_account_ref",
                                value
                              )
                            }
                            disabled={loadingAccounts}
                            className="w-[200px]"
                            placeholder="Seleccionar cuenta"
                          />
                          {invoice.has_vendor_default && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Usando configuración predeterminada del proveedor</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          placeholder="Opcional"
                          value={invoice.default_class_ref || ""}
                          onChange={(e) =>
                            handleUpdateInvoice(
                              invoice.id,
                              "default_class_ref",
                              e.target.value
                            )
                          }
                          className="w-32"
                        />
                      </TableCell>
                      <TableCell>
                        <Checkbox
                          checked={invoice.uses_tax ?? true}
                          onCheckedChange={(checked) =>
                            handleUpdateInvoice(
                              invoice.id,
                              "uses_tax",
                              checked as boolean
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-2 justify-end">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleShowDetail(invoice)}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Ver detalle</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          {invoice.pdf_attachment_url && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleOpenPDF(invoice)}
                                  >
                                    <FileText className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Ver PDF</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handlePublishSingle(invoice.id)}
                            disabled={publishingIds.has(invoice.id)}
                          >
                            {publishingIds.has(invoice.id) ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Upload className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDeleteInvoice(invoice.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {Object.keys(totalsBySupplier).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Totales por Proveedor</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(totalsBySupplier).map(([supplier, total]) => (
                <div key={supplier} className="flex justify-between items-center">
                  <span className="font-medium">{supplier}</span>
                  <span className="text-muted-foreground">
                    {formatCurrency(total, "CRC")}
                  </span>
                </div>
              ))}
              <div className="border-t pt-2 flex justify-between items-center font-bold">
                <span>Total General</span>
                <span>
                  {formatCurrency(
                    Object.values(totalsBySupplier).reduce((a, b) => a + b, 0),
                    "CRC"
                  )}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <PublishValidationDialog
        open={showPublishDialog}
        onOpenChange={setShowPublishDialog}
        onConfirm={handlePublishAll}
        documentIds={filteredInvoices.map((inv) => inv.id)}
      />

      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Detalle de Factura {selectedInvoice?.doc_number}
            </DialogTitle>
          </DialogHeader>
          {selectedInvoice && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
                <div>
                  <p className="text-sm text-muted-foreground">Proveedor</p>
                  <p className="font-medium">{selectedInvoice.supplier_name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Cédula</p>
                  <p className="font-medium">{selectedInvoice.supplier_tax_id || "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Fecha de Emisión</p>
                  <p className="font-medium">
                    {selectedInvoice.issue_date 
                      ? new Date(selectedInvoice.issue_date).toLocaleDateString("es-CR")
                      : "N/A"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total</p>
                  <p className="font-medium text-lg">
                    {formatCurrency(selectedInvoice.total_amount, selectedInvoice.currency)}
                  </p>
                </div>
              </div>

              {selectedInvoice.xml_data?.detalle && (
                <div>
                  <h3 className="font-semibold mb-3">Líneas de Detalle</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Código</TableHead>
                        <TableHead>Descripción</TableHead>
                        <TableHead className="text-right">Cantidad</TableHead>
                        <TableHead className="text-right">Precio Unit.</TableHead>
                        <TableHead className="text-right">Descuento</TableHead>
                        <TableHead className="text-right">Impuesto</TableHead>
                        <TableHead className="text-right">Total Línea</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedInvoice.xml_data.detalle.map((linea: any, index: number) => (
                        <TableRow key={index}>
                          <TableCell>{linea.codigoProducto || "N/A"}</TableCell>
                          <TableCell className="max-w-xs truncate">
                            {linea.descripcion}
                          </TableCell>
                          <TableCell className="text-right">
                            {linea.cantidad} {linea.unidadMedida}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(linea.precioUnitario, selectedInvoice.currency)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(linea.montoDescuento || 0, selectedInvoice.currency)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(linea.montoImpuesto || 0, selectedInvoice.currency)}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(linea.montoTotalLinea, selectedInvoice.currency)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <div className="flex justify-between items-center p-4 bg-muted rounded-lg font-semibold">
                <span>Subtotal:</span>
                <span>{formatCurrency(selectedInvoice.xml_data?.subTotal || 0, selectedInvoice.currency)}</span>
              </div>
              <div className="flex justify-between items-center p-4 bg-muted rounded-lg font-semibold">
                <span>Descuentos:</span>
                <span>{formatCurrency(selectedInvoice.xml_data?.totalDescuentos || 0, selectedInvoice.currency)}</span>
              </div>
              <div className="flex justify-between items-center p-4 bg-muted rounded-lg font-semibold">
                <span>Impuestos:</span>
                <span>{formatCurrency(selectedInvoice.xml_data?.totalImpuesto || 0, selectedInvoice.currency)}</span>
              </div>
              <div className="flex justify-between items-center p-4 bg-primary text-primary-foreground rounded-lg font-bold text-lg">
                <span>Total:</span>
                <span>{formatCurrency(selectedInvoice.xml_data?.totalComprobante || selectedInvoice.total_amount, selectedInvoice.currency)}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default InvoicesPendingLog;
