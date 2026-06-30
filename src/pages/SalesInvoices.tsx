import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, TrendingUp, DollarSign, CheckCircle2, Clock, AlertCircle, Mail, Loader2, RefreshCw } from "lucide-react";
import { SikuImportDialog } from "@/components/siku/SikuImportDialog";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useSalesInvoices } from "@/hooks/useSalesInvoices";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export default function SalesInvoices() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { activeOrganization } = useAuth();
  const { data: invoices, isLoading, refetch } = useSalesInvoices();
  const [searchTerm, setSearchTerm] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null);

  const handleSendEmail = async (invoice: any) => {
    const email = invoice.customer_email || prompt("Ingrese el correo del cliente:");
    if (!email) return;

    setSendingEmailId(invoice.id);
    try {
      const { data, error } = await supabase.functions.invoke("send-invoice-email", {
        body: {
          invoice_id: invoice.id,
          organization_id: activeOrganization,
          to_email: email,
          include_pdf: true,
          invoice_type: "sales",
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Error al enviar");
      toast({ title: "✅ Factura enviada", description: `Enviada a ${email}` });
    } catch (err: any) {
      toast({ title: "Error al enviar", description: err.message, variant: "destructive" });
    } finally {
      setSendingEmailId(null);
    }
  };

  const filteredInvoices = invoices?.filter(inv =>
    inv.doc_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    inv.customer_name.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const pendingConfigCount = invoices?.filter(inv => inv.status === "pending_config").length || 0;
  const readyCount = invoices?.filter(inv => inv.status === "pending").length || 0;
  const publishedCount = invoices?.filter(inv => inv.status === "published").length || 0;
  const totalAmount = invoices?.reduce((sum, inv) => sum + (inv.total_amount || 0), 0) || 0;

  const handlePublishAll = async () => {
    if (!activeOrganization) return;

    const readyInvoices = invoices?.filter(inv => 
      inv.status === "pending" && 
      inv.default_income_account_ref
    );

    if (!readyInvoices || readyInvoices.length === 0) {
      toast({
        title: "No hay facturas listas",
        description: "Todas las facturas ya fueron publicadas o necesitan configuración.",
        variant: "destructive",
      });
      return;
    }

    setIsPublishing(true);
    try {
      const { error } = await supabase.functions.invoke("publish-sales-to-quickbooks", {
        body: {
          organization_id: activeOrganization,
          invoice_ids: readyInvoices.map(inv => inv.id)
        }
      });

      if (error) throw error;

      toast({
        title: "✅ Facturas publicadas",
        description: `${readyInvoices.length} facturas de venta publicadas en QuickBooks`,
      });

      refetch();
    } catch (error: any) {
      console.error("Error publishing invoices:", error);
      toast({
        title: "Error al publicar",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsPublishing(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "published":
        return <Badge variant="default" className="bg-green-500"><CheckCircle2 className="w-3 h-3 mr-1" />Publicado</Badge>;
      case "pending":
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Listo</Badge>;
      case "pending_config":
        return <Badge variant="outline"><AlertCircle className="w-3 h-3 mr-1" />Configurar</Badge>;
      case "error":
        return <Badge variant="destructive">Error</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/dashboard")}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-2">
                <TrendingUp className="h-8 w-8 text-primary" />
                Facturas de Venta (Ingresos)
              </h1>
              <p className="text-muted-foreground">
                Gestiona las facturas emitidas desde GTI
              </p>
            </div>
          </div>
          <Button
            onClick={handlePublishAll}
            disabled={isPublishing || readyCount === 0}
            size="lg"
          >
            <DollarSign className="mr-2 h-5 w-5" />
            {isPublishing ? "Publicando..." : `Publicar ${readyCount} Listas`}
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Configurar
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{pendingConfigCount}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Listas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{readyCount}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Publicadas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{publishedCount}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Ingresos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {new Intl.NumberFormat('es-CR', {
                  style: 'currency',
                  currency: 'CRC',
                  minimumFractionDigits: 0,
                }).format(totalAmount)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search and Table */}
        <Card>
          <CardHeader>
            <CardTitle>Todas las Facturas de Venta</CardTitle>
            <CardDescription>
              <Input
                placeholder="Buscar por número o cliente..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-md"
              />
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8">Cargando facturas...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Número</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Monto</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>QB ID</TableHead>
                    <TableHead>Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInvoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-medium">{invoice.doc_number}</TableCell>
                      <TableCell>{new Date(invoice.issue_date).toLocaleDateString()}</TableCell>
                      <TableCell>{invoice.customer_name}</TableCell>
                      <TableCell>
                        {new Intl.NumberFormat('es-CR', {
                          style: 'currency',
                          currency: invoice.currency,
                          minimumFractionDigits: 0,
                        }).format(invoice.total_amount)}
                      </TableCell>
                      <TableCell>{getStatusBadge(invoice.status)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {invoice.qbo_entity_id || "-"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSendEmail(invoice)}
                          disabled={sendingEmailId === invoice.id}
                          title="Enviar por correo"
                        >
                          {sendingEmailId === invoice.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}