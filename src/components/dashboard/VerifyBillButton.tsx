import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Search, Loader2, AlertCircle, CheckCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface BillVerificationResult {
  bill_id: string;
  exists: boolean;
  doc_number?: string;
  txn_date?: string;
  total_amount?: number;
  currency?: string;
  vendor_name?: string;
  vendor_id?: string;
  accounts?: Array<{
    account_id: string;
    account_name: string;
    amount: number;
    description?: string;
  }>;
  global_tax_calculation?: string;
  total_tax?: number;
  private_note?: string;
  error?: string;
}

export const VerifyBillButton = () => {
  const { activeOrganization } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [billId, setBillId] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [billDetails, setBillDetails] = useState<any>(null);
  const [multipleResults, setMultipleResults] = useState<BillVerificationResult[]>([]);
  const [verifyMode, setVerifyMode] = useState<'single' | 'multiple'>('single');

  const handleVerify = async () => {
    const trimmed = billId.trim();

    if (!activeOrganization) {
      toast.error("No hay organización activa");
      return;
    }

    if (!trimmed) {
      toast.error("Ingresa el ID numérico del Bill (ej: 38876)");
      return;
    }

    if (!/^\d+$/.test(trimmed)) {
      toast.error(
        trimmed.length === 50
          ? "Ese parece ser la Clave (50 dígitos). Aquí debes usar el ID numérico del Bill en QuickBooks (ej: 38876)."
          : "El ID del Bill debe ser numérico (solo números)."
      );
      return;
    }

    setIsVerifying(true);
    setMultipleResults([]);
    toast.info("Verificando detalles del bill en QuickBooks...");

    try {
      const { data, error } = await supabase.functions.invoke("verify-bill-details", {
        body: {
          organization_id: activeOrganization,
          bill_id: trimmed,
        },
      });

      if (error) throw error;

      setBillDetails(data);
      setVerifyMode('single');
      toast.success("Detalles del bill obtenidos exitosamente");
    } catch (error: any) {
      console.error("Error verifying bill:", error);
      toast.error(`Error: ${error.message}`);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleVerifyMultiple = async (billIds: string[]) => {
    if (!activeOrganization || billIds.length === 0) {
      toast.error("No hay Bills para verificar");
      return;
    }

    setIsVerifying(true);
    setBillDetails(null);
    toast.info(`Verificando ${billIds.length} Bills en QuickBooks...`);

    try {
      const { data, error } = await supabase.functions.invoke("verify-qbo-bill-exists", {
        body: {
          organization_id: activeOrganization,
          bill_ids: billIds,
        },
      });

      if (error) throw error;

      setMultipleResults(data.results || []);
      setVerifyMode('multiple');
      
      const found = (data.results || []).filter((r: BillVerificationResult) => r.exists).length;
      toast.success(`${found}/${billIds.length} Bills encontrados en QuickBooks`);
    } catch (error: any) {
      console.error("Error verifying multiple bills:", error);
      toast.error(`Error: ${error.message}`);
    } finally {
      setIsVerifying(false);
    }
  };

  // Bills de Big Brown para verificar
  const bigBrownBillIds = ["40236", "40209", "38876"];

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Search className="h-4 w-4 mr-2" />
          Verificar Bill QBO
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Verificar Detalles de Bill en QuickBooks</DialogTitle>
          <DialogDescription>
            Verifica los detalles exactos de cómo se registró el bill en QuickBooks
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="billId">ID numérico del Bill en QuickBooks</Label>
              <Input
                id="billId"
                value={billId}
                onChange={(e) => setBillId(e.target.value)}
                placeholder="Ej: 38876"
                inputMode="numeric"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Solo números. Si tienes la Clave (50 dígitos) de Hacienda, ese no es el ID de QBO.
              </p>
            </div>
            <div className="self-end">
              <Button onClick={handleVerify} disabled={isVerifying}>
                {isVerifying ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Verificando...
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    Verificar
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Quick verify Big Brown bills */}
          <div className="border rounded-lg p-4 bg-muted/50">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium">Verificación Rápida - Big Brown Brindle</h4>
              <Button 
                variant="secondary" 
                size="sm"
                onClick={() => handleVerifyMultiple(bigBrownBillIds)}
                disabled={isVerifying}
              >
                {isVerifying ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Search className="h-4 w-4 mr-2" />
                )}
                Verificar Bills: {bigBrownBillIds.join(', ')}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Verifica si los Bills 40236 (Oct), 38876 (Nov), 40209 (Dic) existen en QuickBooks
            </p>
          </div>

          {/* Multiple results */}
          {verifyMode === 'multiple' && multipleResults.length > 0 && (
            <ScrollArea className="h-[400px]">
              <div className="space-y-3">
                {multipleResults.map((result, index) => (
                  <div 
                    key={index} 
                    className={`border rounded-lg p-4 ${result.exists ? 'bg-green-50 dark:bg-green-900/20 border-green-200' : 'bg-red-50 dark:bg-red-900/20 border-red-200'}`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {result.exists ? (
                        <CheckCircle className="h-5 w-5 text-green-600" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-red-600" />
                      )}
                      <span className="font-semibold">Bill ID: {result.bill_id}</span>
                      <Badge variant={result.exists ? "default" : "destructive"}>
                        {result.exists ? "EXISTE" : "NO ENCONTRADO"}
                      </Badge>
                    </div>

                    {result.exists && (
                      <div className="grid grid-cols-2 gap-2 text-sm mt-3">
                        <div>
                          <span className="text-muted-foreground">Doc Number:</span>{" "}
                          <span className="font-mono">{result.doc_number}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Fecha:</span>{" "}
                          {result.txn_date}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Total:</span>{" "}
                          {result.currency === 'USD' ? '$' : '₡'}
                          {result.total_amount?.toLocaleString()}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Proveedor:</span>{" "}
                          {result.vendor_name}
                        </div>
                        <div className="col-span-2">
                          <span className="text-muted-foreground">IVA:</span>{" "}
                          {result.global_tax_calculation} 
                          {result.total_tax ? ` (₡${result.total_tax.toLocaleString()})` : ''}
                        </div>
                        
                        {result.accounts && result.accounts.length > 0 && (
                          <div className="col-span-2 mt-2">
                            <span className="text-muted-foreground font-medium">Cuentas usadas:</span>
                            <div className="mt-1 space-y-1">
                              {result.accounts.map((acc, accIndex) => (
                                <div key={accIndex} className="bg-background rounded p-2 text-xs">
                                  <span className="font-mono text-blue-600">
                                    {acc.account_name} (ID: {acc.account_id})
                                  </span>
                                  <span className="ml-2">
                                    - ₡{acc.amount?.toLocaleString()}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {!result.exists && result.error && (
                      <p className="text-sm text-red-600 mt-2">{result.error}</p>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          {/* Single bill details */}
          {verifyMode === 'single' && billDetails && (
            <div className="space-y-4 bg-muted p-4 rounded-lg">
              <div>
                <h3 className="font-semibold text-lg mb-2">Información del Bill</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">ID:</span>{" "}
                    <span className="font-mono">{billDetails.bill.id}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Número Doc:</span>{" "}
                    <span className="font-mono">{billDetails.bill.docNumber}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Fecha:</span>{" "}
                    {billDetails.bill.txnDate}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Total:</span>{" "}
                    ₡{billDetails.bill.totalAmt?.toLocaleString()}
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Proveedor:</span>{" "}
                    {billDetails.bill.vendorRef?.name || billDetails.bill.vendorRef?.value}
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-lg mb-2">
                  Líneas del Bill ({billDetails.bill.lineCount})
                </h3>
                <div className="space-y-2">
                  {billDetails.lines?.map((line: any, index: number) => (
                    <div key={index} className="bg-background p-3 rounded border">
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-medium">Línea {index + 1}</span>
                        <span className="font-mono text-sm">
                          ₡{line.amount?.toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">
                        {line.description}
                      </p>
                      <div className="text-xs space-y-1">
                        <div>
                          <span className="text-muted-foreground">Cuenta ID:</span>{" "}
                          <span className="font-mono">{line.accountRef}</span>
                        </div>
                        {line.taxCodeRef && (
                          <div>
                            <span className="text-muted-foreground">Tax Code:</span>{" "}
                            <span className="font-mono">{line.taxCodeRef}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-lg mb-2">Detalles de Cuentas</h3>
                <div className="space-y-2">
                  {billDetails.accounts?.map((account: any, index: number) => (
                    <div key={index} className="bg-background p-3 rounded border">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">ID:</span>{" "}
                          <span className="font-mono">{account.id}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Código:</span>{" "}
                          <span className="font-mono">
                            {account.acctNum || "N/A"}
                          </span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-muted-foreground">Nombre:</span>{" "}
                          <span className="font-medium">{account.name}</span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-muted-foreground">Tipo:</span>{" "}
                          {account.accountType}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
