import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, ExternalLink, Loader2, AlertCircle, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { AccountCombobox } from "@/components/AccountCombobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface Document {
  id: string;
  doc_number: string;
  supplier_name: string;
  issue_date: string;
  total_amount: number;
  currency: string;
  status: string;
  qbo_entity_id: string | null;
  doc_type: string;
  error_message: string | null;
  vendor_id: string | null;
  default_account_ref?: string;
  has_vendor_default?: boolean;
}

interface QBOAccount {
  id: string;
  name: string;
  accountNumber: string;
}

interface VendorDefault {
  id: string;
  vendor_name: string;
  default_account_ref: string | null;
  default_uses_tax: boolean;
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline"; color: string }> = {
  processed: { label: "Procesada", variant: "default", color: "text-success" },
  review: { label: "En Revisión", variant: "secondary", color: "text-warning" },
  pending: { label: "Pendiente", variant: "outline", color: "text-muted-foreground" },
  error: { label: "Error", variant: "outline", color: "text-destructive" },
  duplicate: { label: "Duplicado", variant: "outline", color: "text-muted-foreground" },
};

export const RecentDocuments = () => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { activeOrganization } = useAuth();
  const [qboAccounts, setQboAccounts] = useState<QBOAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [vendorDefaults, setVendorDefaults] = useState<Map<string, VendorDefault>>(new Map());

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
    
    // Check if QuickBooks is connected first
    const { data: qbIntegration } = await supabase
      .from("integration_accounts")
      .select("id")
      .eq("organization_id", activeOrganization)
      .eq("service_type", "quickbooks")
      .eq("is_active", true)
      .maybeSingle();

    if (!qbIntegration) {
      console.log("QuickBooks not connected, skipping account fetch");
      return;
    }
    
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
    } finally {
      setLoadingAccounts(false);
    }
  };

  useEffect(() => {
    if (!activeOrganization) return;
    fetchVendorDefaults();
    fetchQBOAccounts();
    fetchDocuments();

    // Subscribe to real-time updates
    const channel = supabase
      .channel('processed_documents_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'processed_documents'
        },
        () => {
          console.log('Document updated, refetching...');
          fetchDocuments();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeOrganization]);

  const fetchDocuments = async () => {
    if (!activeOrganization) {
      setIsLoading(false);
      return;
    }

    // FILTRO CRÍTICO: Solo mostrar documentos pendientes SIN cuenta contable asignada
    const { data, error } = await supabase
      .from("processed_documents")
      .select("*")
      .eq("organization_id", activeOrganization)
      .eq("status", "pending")
      .is("qbo_entity_id", null) // No publicados a QuickBooks
      .order("created_at", { ascending: false })
      .limit(10); // Traer más para filtrar después

    if (!error && data) {
      // Verificar cuáles tienen cuenta en vendors
      const docsWithVendorCheck = await Promise.all(
        data.map(async (doc) => {
          let hasVendorAccount = false;
          
          if (doc.vendor_id) {
            const { data: vendorData } = await supabase
              .from("vendors")
              .select("default_account_ref")
              .eq("id", doc.vendor_id)
              .maybeSingle();
            
            hasVendorAccount = !!vendorData?.default_account_ref;
          }
          
          return {
            ...doc,
            hasVendorAccount
          };
        })
      );

      // Filtrar: solo documentos SIN cuenta asignada (ni en vendor ni en documento)
      const docsWithoutAccount = docsWithVendorCheck.filter((doc: any) => {
        const hasDocAccount = !!doc.default_account_ref;
        return !doc.hasVendorAccount && !hasDocAccount;
      }).slice(0, 5); // Tomar solo 5 después de filtrar

      // Apply vendor defaults if available
      const docsWithDefaults = docsWithoutAccount.map((doc: any) => {
        let docData: Document = { 
          ...doc,
          default_account_ref: undefined,
          has_vendor_default: false
        };

        // Apply vendor defaults if available
        const vendorDefault = vendorDefaults.get(doc.supplier_name);
        if (vendorDefault && vendorDefault.default_account_ref) {
          docData.default_account_ref = vendorDefault.default_account_ref;
          docData.has_vendor_default = true;
        }
        
        return docData;
      });
      
      setDocuments(docsWithDefaults);
    }
    setIsLoading(false);
  };

  const saveVendorDefault = async (
    vendorName: string,
    accountRef: string | null
  ) => {
    if (!activeOrganization) return;

    try {
      const { data, error } = await supabase
        .from("vendor_defaults")
        .upsert(
          {
            organization_id: activeOrganization,
            vendor_name: vendorName,
            default_account_ref: accountRef,
            default_uses_tax: true,
          },
          { onConflict: "organization_id,vendor_name" }
        )
        .select()
        .single();

      if (error) throw error;

      // Update local cache
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

  const handleUpdateAccount = async (
    id: string,
    accountRef: string
  ) => {
    try {
      const document = documents.find((doc) => doc.id === id);
      if (!document) return;

      console.log("🔄 Asignando cuenta y publicando facturas del proveedor:", document.supplier_name);

      // OPTIMISTIC UPDATE: Remover inmediatamente de la lista
      setDocuments(prev => prev.filter(doc => doc.supplier_name !== document.supplier_name));
      toast.loading(`Procesando ${document.supplier_name}...`, { id: `processing-${id}` });

      // Update vendor record if exists
      if (document.vendor_id) {
        await supabase
          .from("vendors")
          .update({ default_account_ref: accountRef })
          .eq("id", document.vendor_id);
      }

      // Save as vendor default
      await saveVendorDefault(document.supplier_name, accountRef);

      // Update all pending documents from this vendor with the account
      await supabase
        .from("processed_documents")
        .update({ default_account_ref: accountRef })
        .eq("organization_id", activeOrganization)
        .eq("supplier_name", document.supplier_name)
        .eq("status", "pending")
        .is("qbo_entity_id", null);

      // Get all pending invoices from this vendor
      const { data: vendorInvoices } = await supabase
        .from("processed_documents")
        .select("id, doc_number")
        .eq("organization_id", activeOrganization)
        .eq("supplier_name", document.supplier_name)
        .eq("status", "pending")
        .is("qbo_entity_id", null);

      if (vendorInvoices && vendorInvoices.length > 0) {
        const invoiceIds = vendorInvoices.map(inv => inv.id);
        
        const { data: publishResult, error: publishError } = await supabase.functions.invoke(
          "publish-to-quickbooks",
          {
            body: { 
              organization_id: activeOrganization,
              document_ids: invoiceIds
            }
          }
        );

        toast.dismiss(`processing-${id}`);
        
        if (publishError || publishResult?.error) {
          toast.error(`Error al publicar: ${publishError?.message || publishResult?.error}`);
          fetchDocuments(); // Refetch on error to restore state
        } else {
          toast.success(`✅ ${invoiceIds.length} factura${invoiceIds.length > 1 ? 's' : ''} de ${document.supplier_name} publicada${invoiceIds.length > 1 ? 's' : ''}`);
        }
      } else {
        toast.dismiss(`processing-${id}`);
        toast.success(`✅ Cuenta asignada para ${document.supplier_name}`);
      }
    } catch (error: any) {
      console.error("Error updating account:", error);
      toast.dismiss(`processing-${id}`);
      toast.error("Error al actualizar cuenta");
      fetchDocuments(); // Refetch on error to restore state
    }
  };

  const formatCurrency = (amount: number, currency: string) => {
    const symbol = currency === "USD" ? "$" : "₡";
    const formatted = amount.toLocaleString("es-CR", { minimumFractionDigits: 2 });
    return `${symbol}${formatted}`;
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
        <p>No hay documentos procesados aún</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {documents.map((doc) => (
        <div
          key={doc.id}
          className="flex flex-col gap-3 p-4 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 flex-1">
              <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                doc.error_message ? "bg-destructive/10" : "bg-primary/10"
              }`}>
                {doc.error_message ? (
                  <AlertCircle className="h-5 w-5 text-destructive" />
                ) : (
                  <FileText className="h-5 w-5 text-primary" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-semibold text-sm text-foreground">{doc.doc_number}</p>
                  {doc.qbo_entity_id && (
                    <Badge variant="outline" className="text-xs">
                      QBO: {doc.qbo_entity_id}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground truncate">{doc.supplier_name}</p>
                {doc.error_message && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <p className="text-xs text-destructive mt-1 cursor-help flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />
                          Error: {doc.error_message.substring(0, 50)}...
                        </p>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-md">
                        <p className="text-xs">{doc.error_message}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="font-semibold text-sm text-foreground">
                  {formatCurrency(doc.total_amount, doc.currency)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(doc.issue_date).toLocaleDateString("es-CR")}
                </p>
              </div>
              <Badge variant={statusConfig[doc.status]?.variant || "outline"} className="min-w-[100px] justify-center">
                {statusConfig[doc.status]?.label || doc.status}
              </Badge>
              {doc.qbo_entity_id && (
                <Button variant="ghost" size="sm">
                  <ExternalLink className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Cuenta Contable - Solo para documentos pendientes */}
          {doc.status === "pending" && (
            <div className="flex items-center gap-2 pl-14">
              <span className="text-sm text-muted-foreground min-w-[120px]">
                Cuenta Contable:
              </span>
              <div className="flex items-center gap-2 flex-1">
                <AccountCombobox
                  accounts={qboAccounts}
                  value={doc.default_account_ref || ""}
                  onValueChange={(value) => handleUpdateAccount(doc.id, value)}
                  disabled={loadingAccounts}
                  className="w-[280px]"
                  placeholder="Seleccionar cuenta"
                />
                {doc.has_vendor_default && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">Usando configuración predeterminada del proveedor</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
