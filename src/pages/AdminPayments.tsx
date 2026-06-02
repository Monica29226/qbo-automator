import { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Wallet,
  CheckCircle2,
  Clock,
  FileText,
  Search,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PayInvoiceDialog } from "@/components/admin/PayInvoiceDialog";
import { toast } from "sonner";

type PaymentTab = "pending" | "paid";

interface InvoiceRow {
  id: string;
  issue_date: string;
  supplier_name: string;
  doc_number: string;
  doc_key: string;
  total_amount: number;
  currency: string;
  status: string;
  payment_status: string;
  paid_at: string | null;
  payment_reference: string | null;
  payment_method: string | null;
  payment_proof_url: string | null;
  payment_proof_drive_id: string | null;
  qbo_entity_id: string | null;
}

export default function AdminPayments() {
  const navigate = useNavigate();
  const params = useParams<{ tab?: string }>();
  const { activeOrganization } = useAuth();
  const tab: PaymentTab = params.tab === "paid" ? "paid" : "pending";

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [docNumberFilter, setDocNumberFilter] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<InvoiceRow | null>(null);
  const [loadingProofId, setLoadingProofId] = useState<string | null>(null);

  const fetchInvoices = async () => {
    if (!activeOrganization) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("processed_documents")
      .select(
        "id, issue_date, supplier_name, doc_number, doc_key, total_amount, currency, status, payment_status, paid_at, payment_reference, payment_method, payment_proof_url, payment_proof_drive_id, qbo_entity_id"
      )
      .eq("organization_id", activeOrganization)
      .eq("payment_status", tab === "paid" ? "paid" : "pending_payment")
      .order(tab === "paid" ? "paid_at" : "issue_date", { ascending: false })
      .limit(500);

    if (error) {
      toast.error(`Error: ${error.message}`);
      setInvoices([]);
    } else {
      setInvoices((data || []) as InvoiceRow[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchInvoices();
    // realtime
    if (!activeOrganization) return;
    const channel = supabase
      .channel(`admin-payments-${tab}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "processed_documents",
          filter: `organization_id=eq.${activeOrganization}`,
        },
        () => fetchInvoices()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrganization, tab]);

  const suppliers = useMemo(() => {
    const set = new Set<string>();
    for (const i of invoices) if (i.supplier_name) set.add(i.supplier_name);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [invoices]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const doc = docNumberFilter.toLowerCase().trim();
    const fromTs = dateFrom ? new Date(dateFrom + "T00:00:00").getTime() : null;
    const toTs = dateTo ? new Date(dateTo + "T23:59:59").getTime() : null;
    return invoices.filter((i) => {
      if (supplierFilter && i.supplier_name !== supplierFilter) return false;
      if (doc && !i.doc_number?.toLowerCase().includes(doc)) return false;
      if (fromTs || toTs) {
        const t = i.issue_date ? new Date(i.issue_date).getTime() : 0;
        if (fromTs && t < fromTs) return false;
        if (toTs && t > toTs) return false;
      }
      if (q) {
        return (
          i.supplier_name?.toLowerCase().includes(q) ||
          i.doc_number?.toLowerCase().includes(q) ||
          i.doc_key?.toLowerCase().includes(q) ||
          i.payment_reference?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [invoices, search, supplierFilter, docNumberFilter, dateFrom, dateTo]);

  const clearFilters = () => {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setSupplierFilter("");
    setDocNumberFilter("");
  };

  const hasFilters = !!(search || dateFrom || dateTo || supplierFilter || docNumberFilter);

  const totals = useMemo(() => {
    const crc = filtered
      .filter((i) => i.currency === "CRC")
      .reduce((s, i) => s + Number(i.total_amount || 0), 0);
    const usd = filtered
      .filter((i) => i.currency === "USD")
      .reduce((s, i) => s + Number(i.total_amount || 0), 0);
    const overdue = filtered.filter((i) => {
      if (tab !== "pending") return false;
      const days = (Date.now() - new Date(i.issue_date).getTime()) / 86400000;
      return days > 30;
    }).length;
    return { crc, usd, overdue, count: filtered.length };
  }, [filtered, tab]);

  const fmt = (amount: number, currency: string) =>
    new Intl.NumberFormat("es-CR", {
      style: "currency",
      currency: currency || "CRC",
      minimumFractionDigits: currency === "CRC" ? 0 : 2,
    }).format(amount);

  const openPay = (inv: InvoiceRow) => {
    setSelected(inv);
    setDialogOpen(true);
  };

  const viewProof = async (inv: InvoiceRow) => {
    if (!inv.payment_proof_url) return;
    setLoadingProofId(inv.id);
    try {
      const { data, error } = await supabase.storage
        .from("payment-proofs")
        .createSignedUrl(inv.payment_proof_url, 60 * 10);
      if (error) throw error;
      window.open(data.signedUrl, "_blank");
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
    } finally {
      setLoadingProofId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Wallet className="h-8 w-8 text-primary" />
              Administrativo · Cuentas por Pagar
            </h1>
            <p className="text-muted-foreground">
              Control de pagos: marca facturas como pagadas adjuntando el comprobante
            </p>
          </div>
        </div>

        <Tabs
          value={tab}
          onValueChange={(v) => navigate(`/admin-payments/${v}`)}
        >
          <TabsList>
            <TabsTrigger value="pending">
              <Clock className="h-4 w-4 mr-2" /> Pendientes
            </TabsTrigger>
            <TabsTrigger value="paid">
              <CheckCircle2 className="h-4 w-4 mr-2" /> Pagadas
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {tab === "pending" ? "Total pendiente (CRC)" : "Total pagado (CRC)"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{fmt(totals.crc, "CRC")}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {tab === "pending" ? "Total pendiente (USD)" : "Total pagado (USD)"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{fmt(totals.usd, "USD")}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Facturas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totals.count}</div>
            </CardContent>
          </Card>
          {tab === "pending" && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Vencidas (+30 días)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-destructive">{totals.overdue}</div>
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 max-w-md">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar proveedor, # factura, clave o referencia..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-12 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                Cargando...
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-2 opacity-30" />
                <p>No hay facturas {tab === "pending" ? "pendientes" : "pagadas"}.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Proveedor</TableHead>
                    <TableHead># Factura</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>QBO</TableHead>
                    {tab === "paid" && <TableHead>Pagada</TableHead>}
                    {tab === "paid" && <TableHead>Referencia</TableHead>}
                    <TableHead className="text-right">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((inv) => {
                    const overdue =
                      tab === "pending" &&
                      (Date.now() - new Date(inv.issue_date).getTime()) / 86400000 > 30;
                    return (
                      <TableRow key={inv.id} className={overdue ? "bg-destructive/5" : ""}>
                        <TableCell className="whitespace-nowrap">
                          {new Date(inv.issue_date).toLocaleDateString("es-CR")}
                        </TableCell>
                        <TableCell className="font-medium">{inv.supplier_name}</TableCell>
                        <TableCell className="font-mono text-xs">{inv.doc_number}</TableCell>
                        <TableCell className="text-right font-medium">
                          {fmt(Number(inv.total_amount), inv.currency)}
                        </TableCell>
                        <TableCell>
                          {inv.qbo_entity_id ? (
                            <Badge variant="default" className="bg-green-600">
                              Publicada
                            </Badge>
                          ) : (
                            <Badge variant="outline">{inv.status}</Badge>
                          )}
                        </TableCell>
                        {tab === "paid" && (
                          <TableCell className="text-xs text-muted-foreground">
                            {inv.paid_at
                              ? new Date(inv.paid_at).toLocaleDateString("es-CR")
                              : "-"}
                          </TableCell>
                        )}
                        {tab === "paid" && (
                          <TableCell className="text-xs">
                            {inv.payment_reference || "-"}
                          </TableCell>
                        )}
                        <TableCell className="text-right">
                          {tab === "pending" ? (
                            <Button size="sm" onClick={() => openPay(inv)}>
                              <CheckCircle2 className="h-4 w-4 mr-1" />
                              Marcar pagada
                            </Button>
                          ) : (
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => viewProof(inv)}
                                disabled={!inv.payment_proof_url || loadingProofId === inv.id}
                              >
                                {loadingProofId === inv.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <>
                                    <FileText className="h-4 w-4 mr-1" />
                                    Comprobante
                                  </>
                                )}
                              </Button>
                              {inv.payment_proof_drive_id && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  asChild
                                  title="Ver en Drive"
                                >
                                  <a
                                    href={`https://drive.google.com/file/d/${inv.payment_proof_drive_id}/view`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                  </a>
                                </Button>
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <PayInvoiceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        invoice={selected}
        onSuccess={fetchInvoices}
      />
    </div>
  );
}
