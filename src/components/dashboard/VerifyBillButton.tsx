import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Search, Loader2 } from "lucide-react";
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

export const VerifyBillButton = () => {
  const { activeOrganization } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [billId, setBillId] = useState("12590");
  const [isVerifying, setIsVerifying] = useState(false);
  const [billDetails, setBillDetails] = useState<any>(null);

  const handleVerify = async () => {
    if (!activeOrganization || !billId) {
      toast.error("Ingresa un ID de factura válido");
      return;
    }

    setIsVerifying(true);
    toast.info("Verificando detalles del bill en QuickBooks...");

    try {
      const { data, error } = await supabase.functions.invoke("verify-bill-details", {
        body: {
          organization_id: activeOrganization,
          bill_id: billId,
        },
      });

      if (error) throw error;

      setBillDetails(data);
      toast.success("Detalles del bill obtenidos exitosamente");
    } catch (error: any) {
      console.error("Error verifying bill:", error);
      toast.error(`Error: ${error.message}`);
    } finally {
      setIsVerifying(false);
    }
  };

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
              <Label htmlFor="billId">ID del Bill en QuickBooks</Label>
              <Input
                id="billId"
                value={billId}
                onChange={(e) => setBillId(e.target.value)}
                placeholder="Ej: 12590"
              />
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

          {billDetails && (
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
