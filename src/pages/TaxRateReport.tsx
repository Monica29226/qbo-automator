import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, FileSpreadsheet, Calendar, Filter } from "lucide-react";
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTaxRateReport, TaxRateSummary } from "@/hooks/useTaxRateReport";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";

const formatCurrency = (amount: number, currency: string = "CRC") => {
  return new Intl.NumberFormat("es-CR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
};

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString("es-CR");
};

export default function TaxRateReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { activeOrganization } = useAuth();
  
  // Fechas por defecto: último mes
  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  
  const [startDate, setStartDate] = useState(firstDayOfMonth.toISOString().split("T")[0]);
  const [endDate, setEndDate] = useState(lastDayOfMonth.toISOString().split("T")[0]);
  
  const { data: taxRateSummaries, isLoading } = useTaxRateReport(
    activeOrganization,
    startDate,
    endDate
  );

  const totalGeneral = taxRateSummaries?.reduce(
    (acc, summary) => ({
      subtotal: acc.subtotal + summary.totalSubtotal,
      tax: acc.tax + summary.totalTax,
      total: acc.total + summary.totalAmount,
      count: acc.count + summary.count,
    }),
    { subtotal: 0, tax: 0, total: 0, count: 0 }
  ) || { subtotal: 0, tax: 0, total: 0, count: 0 };

  const exportToExcel = () => {
    if (!taxRateSummaries || taxRateSummaries.length === 0) {
      toast({
        title: "Sin datos",
        description: "No hay facturas para exportar en el período seleccionado.",
        variant: "destructive",
      });
      return;
    }

    const workbook = XLSX.utils.book_new();

    // Hoja 1: Resumen por tasa
    const summaryData = taxRateSummaries.map((summary) => ({
      "Tasa de Impuesto": summary.taxRateLabel,
      "Cantidad Facturas": summary.count,
      "Subtotal": summary.totalSubtotal,
      "Total Impuesto": summary.totalTax,
      "Total General": summary.totalAmount,
    }));
    
    // Agregar totales
    summaryData.push({
      "Tasa de Impuesto": "TOTALES",
      "Cantidad Facturas": totalGeneral.count,
      "Subtotal": totalGeneral.subtotal,
      "Total Impuesto": totalGeneral.tax,
      "Total General": totalGeneral.total,
    });

    const summarySheet = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Resumen por Tasa");

    // Hoja 2: Detalle de todas las facturas
    const allInvoices: any[] = [];
    for (const summary of taxRateSummaries) {
      for (const inv of summary.invoices) {
        allInvoices.push({
          "Número Documento": inv.doc_number,
          "Clave Hacienda": inv.doc_key,
          "Proveedor": inv.supplier_name,
          "Cédula Proveedor": inv.supplier_tax_id || "",
          "Fecha Emisión": inv.issue_date,
          "Fecha Publicación": inv.processed_at ? formatDate(inv.processed_at) : "",
          "Tasa IVA": `${summary.taxRate}%`,
          "Subtotal": inv.total_amount - (inv.total_tax || 0) + (inv.total_discount || 0),
          "Descuento": inv.total_discount || 0,
          "Impuesto": inv.total_tax || 0,
          "Total": inv.total_amount,
          "Moneda": inv.currency,
          "Tipo Cambio": inv.exchange_rate || 1,
          "ID QuickBooks": inv.qbo_entity_id || "",
        });
      }
    }

    const detailSheet = XLSX.utils.json_to_sheet(allInvoices);
    XLSX.utils.book_append_sheet(workbook, detailSheet, "Detalle Facturas");

    // Hojas individuales por tasa
    for (const summary of taxRateSummaries) {
      const rateInvoices = summary.invoices.map((inv) => ({
        "Número Documento": inv.doc_number,
        "Proveedor": inv.supplier_name,
        "Cédula": inv.supplier_tax_id || "",
        "Fecha": inv.issue_date,
        "Subtotal": inv.total_amount - (inv.total_tax || 0) + (inv.total_discount || 0),
        "Impuesto": inv.total_tax || 0,
        "Total": inv.total_amount,
        "Moneda": inv.currency,
      }));

      // Agregar totales de la tasa
      rateInvoices.push({
        "Número Documento": "TOTALES",
        "Proveedor": "",
        "Cédula": "",
        "Fecha": "",
        "Subtotal": summary.totalSubtotal,
        "Impuesto": summary.totalTax,
        "Total": summary.totalAmount,
        "Moneda": "",
      });

      const sheetName = summary.taxRate === 0 ? "Exento" : `IVA_${summary.taxRate}`;
      const rateSheet = XLSX.utils.json_to_sheet(rateInvoices);
      XLSX.utils.book_append_sheet(workbook, rateSheet, sheetName);
    }

    // Generar archivo
    const fileName = `Reporte_Tasas_IVA_${startDate}_a_${endDate}.xlsx`;
    XLSX.writeFile(workbook, fileName);

    toast({
      title: "✅ Reporte exportado",
      description: `Se descargó el archivo ${fileName}`,
    });
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
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
                <FileSpreadsheet className="h-8 w-8 text-primary" />
                Reporte por Tasas de Impuesto
              </h1>
              <p className="text-muted-foreground">
                Facturas publicadas agrupadas por tasa de IVA
              </p>
            </div>
          </div>
          <Button onClick={exportToExcel} size="lg" className="gap-2">
            <Download className="h-5 w-5" />
            Exportar a Excel
          </Button>
        </div>

        {/* Filtros de fecha */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Período del Reporte
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-2">
                <Label htmlFor="startDate">Fecha Inicio</Label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="startDate"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="pl-10 w-[180px]"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate">Fecha Fin</Label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="endDate"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="pl-10 w-[180px]"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Totales generales */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="border-primary/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Facturas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalGeneral.count}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Subtotal
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(totalGeneral.subtotal)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Impuestos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">
                {formatCurrency(totalGeneral.tax)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total General
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-accent-foreground">
                {formatCurrency(totalGeneral.total)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Detalle por tasa */}
        <Card>
          <CardHeader>
            <CardTitle>Desglose por Tasa de Impuesto</CardTitle>
            <CardDescription>
              Haz clic en cada tasa para ver el detalle de facturas
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8">Cargando reporte...</div>
            ) : !taxRateSummaries || taxRateSummaries.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No hay facturas publicadas en el período seleccionado
              </div>
            ) : (
              <Accordion type="multiple" className="space-y-2">
                {taxRateSummaries.map((summary) => (
                  <AccordionItem
                    key={summary.taxRate}
                    value={`rate-${summary.taxRate}`}
                    className="border rounded-lg px-4"
                  >
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center justify-between w-full pr-4">
                        <div className="flex items-center gap-3">
                          <Badge
                            variant={summary.taxRate === 0 ? "secondary" : "default"}
                            className="text-sm"
                          >
                            {summary.taxRateLabel}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            {summary.count} facturas
                          </span>
                        </div>
                        <div className="flex items-center gap-6 text-sm">
                          <div>
                          <span className="text-muted-foreground">Subtotal:</span>{" "}
                            <span className="font-medium">
                              {formatCurrency(summary.totalSubtotal)}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Impuesto:</span>{" "}
                            <span className="font-medium text-primary">
                              {formatCurrency(summary.totalTax)}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Total:</span>{" "}
                            <span className="font-bold text-accent-foreground">
                              {formatCurrency(summary.totalAmount)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Documento</TableHead>
                            <TableHead>Proveedor</TableHead>
                            <TableHead>Fecha</TableHead>
                            <TableHead className="text-right">Subtotal</TableHead>
                            <TableHead className="text-right">Impuesto</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead>QB ID</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {summary.invoices.map((inv) => (
                            <TableRow key={inv.id}>
                              <TableCell className="font-medium">
                                {inv.doc_number}
                              </TableCell>
                              <TableCell>{inv.supplier_name}</TableCell>
                              <TableCell>{formatDate(inv.issue_date)}</TableCell>
                              <TableCell className="text-right">
                                {formatCurrency(
                                  inv.total_amount -
                                    (inv.total_tax || 0) +
                                    (inv.total_discount || 0),
                                  inv.currency
                                )}
                              </TableCell>
                              <TableCell className="text-right text-primary">
                                {formatCurrency(inv.total_tax || 0, inv.currency)}
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {formatCurrency(inv.total_amount, inv.currency)}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {inv.qbo_entity_id || "-"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
