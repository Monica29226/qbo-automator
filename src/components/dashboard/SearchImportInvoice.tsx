import { useState } from "react";
import { Search, FileCheck, Loader2, AlertCircle, CheckCircle2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface ValidationResult {
  xmlSubtotal: number;
  xmlTax: number;
  xmlOtrosCargos: number;
  xmlTotal: number;
  extractedTotal: number;
  extractedTax: number;
  matches: boolean;
}

interface ImportResult {
  success: boolean;
  message: string;
  document?: any;
  validation?: ValidationResult;
  publishResult?: any;
  pdfSaved?: boolean;
  existing?: any;
}

export function SearchImportInvoice() {
  const [open, setOpen] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [autoPublish, setAutoPublish] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const { toast } = useToast();
  const { activeOrganization } = useAuth();

  const handleSearch = async () => {
    if (!invoiceNumber.trim()) {
      toast({
        title: "Error",
        description: "Ingrese un número de factura",
        variant: "destructive",
      });
      return;
    }

    if (!activeOrganization) {
      toast({
        title: "Error",
        description: "No hay organización activa",
        variant: "destructive",
      });
      return;
    }

    setIsSearching(true);
    setResult(null);

    try {
      const trimmedNumber = invoiceNumber.trim();
      console.log("[SearchImportInvoice] Iniciando búsqueda:", trimmedNumber, "org:", activeOrganization);
      
      // Create a timeout promise - reduced to 20s for faster feedback
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("TIMEOUT")), 20000);
      });
      
      // Create the search promise
      const searchPromise = supabase.functions.invoke("search-import-invoice", {
        body: {
          organization_id: activeOrganization,
          invoice_number: trimmedNumber,
          auto_publish: autoPublish,
        },
      });
      
      // Race between search and timeout
      const { data, error } = await Promise.race([searchPromise, timeoutPromise]) as any;
      
      console.log("[SearchImportInvoice] Respuesta recibida:", data, error);

      if (error) {
        throw error;
      }

      setResult(data);
      setIsSearching(false);

      if (data?.success) {
        toast({
          title: "Factura importada",
          description: data.message,
        });
      } else {
        toast({
          title: "Atención",
          description: data?.message || "No se encontró la factura",
          variant: data?.existing ? "default" : "destructive",
        });
      }
    } catch (error: any) {
      console.error("[SearchImportInvoice] Error:", error);
      setIsSearching(false);
      
      const errorMessage = error.message === 'TIMEOUT'
        ? "Tiempo de espera agotado (20s). La factura puede no existir en Gmail."
        : error.message || "Error buscando factura";
        
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
      setResult({
        success: false,
        message: errorMessage,
      });
    }
  };

  const handleClose = () => {
    setOpen(false);
    setInvoiceNumber("");
    setResult(null);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("es-CR", {
      style: "currency",
      currency: "CRC",
      minimumFractionDigits: 2,
    }).format(amount);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Search className="h-4 w-4" />
          Buscar Factura
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCheck className="h-5 w-5" />
            Buscar e Importar Factura
          </DialogTitle>
          <DialogDescription>
            Ingrese el número de factura para buscarla en Gmail, validar los totales e importarla a QuickBooks.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="invoice-number">Número de Factura (Consecutivo)</Label>
            <Input
              id="invoice-number"
              placeholder="Ej: 50628062400010124253501181000010"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              disabled={isSearching}
            />
            <p className="text-xs text-muted-foreground">
              Puede ingresar el número completo o parcial. El sistema buscará en Gmail.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="auto-publish"
              checked={autoPublish}
              onCheckedChange={(checked) => setAutoPublish(checked as boolean)}
            />
            <Label htmlFor="auto-publish" className="text-sm">
              Publicar automáticamente a QuickBooks después de importar
            </Label>
          </div>

          {result && (
            <div className="mt-4 space-y-3">
              {result.success ? (
                <>
                  <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <AlertDescription className="text-green-800 dark:text-green-200">
                      {result.message}
                    </AlertDescription>
                  </Alert>

                  {result.validation && (
                    <Card>
                      <CardHeader className="py-3">
                        <CardTitle className="text-sm">Validación de Totales</CardTitle>
                      </CardHeader>
                      <CardContent className="py-2">
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div className="text-muted-foreground">Subtotal XML:</div>
                          <div className="font-mono">{formatCurrency(result.validation.xmlSubtotal)}</div>
                          
                          <div className="text-muted-foreground">Impuesto XML:</div>
                          <div className="font-mono">{formatCurrency(result.validation.xmlTax)}</div>
                          
                          {result.validation.xmlOtrosCargos > 0 && (
                            <>
                              <div className="text-muted-foreground">Otros Cargos:</div>
                              <div className="font-mono">{formatCurrency(result.validation.xmlOtrosCargos)}</div>
                            </>
                          )}
                          
                          <div className="text-muted-foreground font-semibold">Total XML:</div>
                          <div className="font-mono font-semibold">{formatCurrency(result.validation.xmlTotal)}</div>
                          
                          <div className="col-span-2 border-t my-2" />
                          
                          <div className="text-muted-foreground">Total Extraído:</div>
                          <div className="font-mono">{formatCurrency(result.validation.extractedTotal)}</div>
                          
                          <div className="text-muted-foreground">Validación:</div>
                          <div className={result.validation.matches ? "text-green-600" : "text-red-600"}>
                            {result.validation.matches ? "✓ Totales coinciden" : "⚠ Diferencia detectada"}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {result.document && (
                    <Card>
                      <CardHeader className="py-3">
                        <CardTitle className="text-sm">Documento Importado</CardTitle>
                      </CardHeader>
                      <CardContent className="py-2 text-sm">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="text-muted-foreground">Proveedor:</div>
                          <div>{result.document.supplier_name}</div>
                          
                          <div className="text-muted-foreground">Monto:</div>
                          <div className="font-mono">{formatCurrency(result.document.total_amount)}</div>
                          
                          <div className="text-muted-foreground">Estado:</div>
                          <div className={result.document.status === "published" ? "text-green-600" : "text-yellow-600"}>
                            {result.document.status}
                          </div>
                          
                          {result.pdfSaved && (
                            <>
                              <div className="text-muted-foreground">PDF:</div>
                              <div className="flex items-center gap-1 text-green-600">
                                <Download className="h-3 w-3" /> Guardado
                              </div>
                            </>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {result.publishResult && (
                    <Alert className={result.publishResult.error ? "border-red-500" : "border-blue-500"}>
                      <AlertDescription>
                        {result.publishResult.error 
                          ? `Error publicando: ${result.publishResult.error}`
                          : `Publicado a QuickBooks: ${result.publishResult.published || 0} documentos`
                        }
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              ) : (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{result.message}</AlertDescription>
                </Alert>
              )}

              {result.existing && (
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm">Documento Existente</CardTitle>
                  </CardHeader>
                  <CardContent className="py-2 text-sm">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-muted-foreground">Número:</div>
                      <div>{result.existing.doc_number}</div>
                      
                      <div className="text-muted-foreground">Estado:</div>
                      <div>{result.existing.status}</div>
                      
                      {result.existing.qbo_entity_id && (
                        <>
                          <div className="text-muted-foreground">QB ID:</div>
                          <div>{result.existing.qbo_entity_id}</div>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cerrar
          </Button>
          <Button onClick={handleSearch} disabled={isSearching || !invoiceNumber.trim()}>
            {isSearching ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Buscando...
              </>
            ) : (
              <>
                <Search className="mr-2 h-4 w-4" />
                Buscar e Importar
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
