import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Search, Loader2, FileText, Mail } from "lucide-react";

interface SearchResult {
  id: string;
  doc_number: string;
  doc_key: string;
  supplier_name: string;
  issue_date: string;
  total_amount: number;
  currency: string;
  status: string;
  pdf_attachment_url: string | null;
  doc_type: string;
}

const SERVICE_TO_FUNCTION: Record<string, string> = {
  gmail: "gmail-fetch-invoices",
  hostinger: "hostinger-fetch-invoices",
  bluehost: "bluehost-fetch-invoices",
  outlook: "outlook-fetch-invoices",
  outlook_imap: "outlook-imap-fetch-invoices",
};

export function SearchInvoiceDialog() {
  const { activeOrganization } = useAuth();
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchingEmail, setIsSearchingEmail] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [emailSearched, setEmailSearched] = useState(false);

  const runLocalSearch = async (): Promise<SearchResult[]> => {
    let query = supabase
      .from("processed_documents")
      .select("id, doc_number, doc_key, supplier_name, issue_date, total_amount, currency, status, pdf_attachment_url, doc_type")
      .eq("organization_id", activeOrganization!)
      .order("issue_date", { ascending: false })
      .limit(50);

    if (searchTerm.trim()) {
      const term = `%${searchTerm.trim()}%`;
      query = query.or(`doc_key.ilike.${term},doc_number.ilike.${term},supplier_name.ilike.${term}`);
    }
    if (dateFrom) query = query.gte("issue_date", dateFrom);
    if (dateTo) query = query.lte("issue_date", dateTo);

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as SearchResult[];
  };

  const searchInEmail = async () => {
    if (!activeOrganization || !searchTerm.trim()) return;
    setIsSearchingEmail(true);
    try {
      // Find active email integration
      const { data: integrations } = await supabase
        .from("integration_accounts")
        .select("service_type")
        .eq("organization_id", activeOrganization)
        .eq("is_active", true)
        .in("service_type", ["gmail", "hostinger", "bluehost", "outlook", "outlook_imap"]);

      if (!integrations || integrations.length === 0) {
        toast.error("No tenés correo conectado. Conectalo en Integraciones.");
        return;
      }

      const service = integrations[0].service_type;
      const fnName = SERVICE_TO_FUNCTION[service];
      if (!fnName) {
        toast.error(`Servicio no soportado: ${service}`);
        return;
      }

      toast.info(`Buscando "${searchTerm}" en ${service}...`);

      const { data, error } = await supabase.functions.invoke(fnName, {
        body: {
          organization_id: activeOrganization,
          search_term: searchTerm.trim(),
          search_days: 90,
        },
      });

      if (error) throw error;

      const found = data?.invoices_processed ?? data?.processed ?? 0;
      if (found > 0) {
        toast.success(`Se encontraron ${found} factura(s) nueva(s)`);
        // Re-run local search to surface newly-imported invoices
        const refreshed = await runLocalSearch();
        setResults(refreshed);
      } else {
        toast.info("No se encontraron facturas con ese criterio en el correo");
      }
      setEmailSearched(true);
    } catch (err: unknown) {
      console.error("Email search error:", err);
      const msg = err instanceof Error ? err.message : "Error al buscar en correo";
      toast.error(msg);
    } finally {
      setIsSearchingEmail(false);
    }
  };

  const handleSearch = async () => {
    if (!activeOrganization) return;
    if (!searchTerm.trim() && !dateFrom && !dateTo) {
      toast.error("Ingresa un término de búsqueda o rango de fechas");
      return;
    }

    setIsSearching(true);
    setResults(null);
    setEmailSearched(false);

    try {
      const data = await runLocalSearch();
      setResults(data);
    } catch (error: unknown) {
      console.error("Search error:", error);
      toast.error("Error al buscar facturas");
    } finally {
      setIsSearching(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "published":
        return <Badge className="bg-green-600 text-white text-xs">Publicada</Badge>;
      case "error":
        return <Badge variant="destructive" className="text-xs">Error</Badge>;
      case "pending":
      case "processed":
        return <Badge variant="secondary" className="text-xs">Pendiente</Badge>;
      case "review":
        return <Badge className="bg-yellow-500 text-white text-xs">Revisión</Badge>;
      default:
        return <Badge variant="outline" className="text-xs">{status}</Badge>;
    }
  };

  const formatAmount = (amount: number, currency: string) => {
    const symbol = currency === "USD" ? "$" : "₡";
    return `${symbol}${amount.toLocaleString("es-CR", { minimumFractionDigits: 2 })}`;
  };

  const handleClose = () => {
    setOpen(false);
    setResults(null);
    setSearchTerm("");
    setDateFrom("");
    setDateTo("");
    setEmailSearched(false);
  };

  return (
    <Dialog open={open} onOpenChange={(val) => val ? setOpen(true) : handleClose()}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full h-14 text-base font-semibold border-2">
          <Search className="h-5 w-5 mr-2" />
          Buscar Factura
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Buscar Factura
          </DialogTitle>
          <DialogDescription>
            Busca por clave, consecutivo o proveedor. Si no aparece, buscamos en tu correo conectado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Buscar</Label>
            <Input
              placeholder="Clave, consecutivo o nombre del proveedor..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              disabled={isSearching || isSearchingEmail}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Fecha desde</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                disabled={isSearching || isSearchingEmail}
              />
            </div>
            <div className="space-y-2">
              <Label>Fecha hasta</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                disabled={isSearching || isSearchingEmail}
              />
            </div>
          </div>

          <Button onClick={handleSearch} disabled={isSearching || isSearchingEmail} className="w-full">
            {isSearching ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Buscando...
              </>
            ) : (
              <>
                <Search className="h-4 w-4 mr-2" />
                Buscar
              </>
            )}
          </Button>

          {results !== null && results.length === 0 && (
            <div className="text-center py-8 space-y-3">
              <Search className="h-12 w-12 text-muted-foreground mx-auto" />
              <h3 className="text-muted-foreground font-medium">
                {emailSearched
                  ? "Sin resultados"
                  : "Sin resultados locales — podemos buscar en tu correo"}
              </h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                {emailSearched
                  ? "No encontramos esta factura en el correo de los últimos 90 días."
                  : "No tenemos esta factura importada. Podemos buscarla en tu correo conectado por remitente o asunto."}
              </p>
              {!emailSearched && searchTerm.trim() && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={searchInEmail}
                  disabled={isSearchingEmail}
                >
                  {isSearchingEmail ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Buscando en correo...
                    </>
                  ) : (
                    <>
                      <Mail className="h-4 w-4 mr-2" />
                      Buscar en correo (últimos 90 días)
                    </>
                  )}
                </Button>
              )}
            </div>
          )}

          {results && results.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {results.length} resultado{results.length !== 1 ? "s" : ""} encontrado{results.length !== 1 ? "s" : ""}
              </p>
              <ScrollArea className="h-[350px] rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Proveedor</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>PDF</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((doc) => (
                      <TableRow key={doc.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium text-sm truncate max-w-[200px]">{doc.supplier_name}</p>
                            <p className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
                              {doc.doc_number}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {new Date(doc.issue_date).toLocaleDateString("es-CR")}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatAmount(doc.total_amount, doc.currency)}
                        </TableCell>
                        <TableCell>{getStatusBadge(doc.status)}</TableCell>
                        <TableCell>
                          {doc.pdf_attachment_url ? (
                            <FileText className="h-4 w-4 text-green-600" />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
