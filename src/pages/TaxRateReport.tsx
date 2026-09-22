import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, Percent, Calendar, Filter } from "lucide-react";
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
import { useTaxRateReport } from "@/hooks/useTaxRateReport";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";

// Montos completos, separador de miles con coma, negativos entre paréntesis.
const amountFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const money = (n: number) =>
  amountFormatter.format(Number(n ?? 0)).replace(/^-(.*)$/, "($1)");

const r2 = (n: number) => Math.round(Number(n ?? 0) * 100) / 100;

const ddmmyyyy = (iso: string) => {
  const [y, m, d] = String(iso ?? "").split("-");
  return y ? `${d}/${m}/${y}` : "";
};

/** Cédula física (9 dígitos) se muestra 1-4-4; las demás se dejan como vienen. */
const formatCedula = (value: string | null) => {
  const raw = String(value ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 9) {
    return `${digits[0]}-${digits.slice(1, 5)}-${digits.slice(5)}`;
  }
  return raw;
};

const sheetNameFor = (label: string) =>
  label === "Exento" ? "Exento" : label.replace("%", "").replace(/\s+/g, " ").trim();

export default function TaxRateReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { activeOrganization, organizations } = useAuth();
  const empresaActiva = organizations.find((o) => o.id === activeOrganization);

  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;

  const [startDate, setStartDate] = useState(iso(firstDayOfMonth));
  const [endDate, setEndDate] = useState(iso(lastDayOfMonth));

  const { data: report, isLoading } = useTaxRateReport(
    activeOrganization,
    startDate,
    endDate,
  );

  const groups = report?.groups ?? [];

  const exportToExcel = () => {
    if (!report || groups.length === 0) {
      toast({
        title: "Sin datos",
        description: "No hay documentos publicados en el período seleccionado.",
        variant: "destructive",
      });
      return;
    }

    const workbook = XLSX.utils.book_new();

    // ---- Hoja: Resumen por Tasa
    const resumen: (string | number)[][] = [
      ["Tarifa", "Documentos", "Base Gravada", "IVA", "Total"],
    ];
    let sumDocs = 0;
    let sumBase = 0;
    let sumIva = 0;
    let sumTotal = 0;
    for (const g of groups) {
      sumDocs += g.count;
      sumBase += g.totalBase;
      sumIva += g.totalTax;
      sumTotal += g.totalAmount;
      resumen.push([
        g.taxRateLabel,
        g.count,
        r2(g.totalBase),
        r2(g.totalTax),
        r2(g.totalAmount),
      ]);
    }
    resumen.push(["TOTALES", sumDocs, r2(sumBase), r2(sumIva), r2(sumTotal)]);
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(resumen),
      "Resumen por Tasa",
    );

    const DETALLE_HEADERS = [
      "Tarifa",
      "Consecutivo",
      "Emisor",
      "Cédula Emisor",
      "Fecha",
      "Tipo",
      "Moneda",
      "Tipo Cambio",
      "Base Gravada",
      "IVA",
      "Total Comprobante (colones)",
      "ID QuickBooks",
    ];

    const filaDetalle = (
      etiqueta: string,
      inv: (typeof groups)[number]["invoices"][number],
    ): (string | number)[] => [
      etiqueta,
      inv.consecutivo ?? "",
      inv.nombre_emisor ?? "",
      formatCedula(inv.cedula_emisor),
      ddmmyyyy(inv.issue_date),
      inv.tipo,
      inv.moneda,
      r2(inv.tipo_cambio),
      r2(inv.base),
      r2(inv.iva),
      r2(inv.total_comprobante),
      inv.qbo_entity_id ?? "",
    ];

    // ---- Hoja: Detalle (una fila por documento y por tarifa)
    const detalle: (string | number)[][] = [DETALLE_HEADERS];
    for (const g of groups) {
      for (const inv of g.invoices) detalle.push(filaDetalle(g.taxRateLabel, inv));
    }
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(detalle),
      "Detalle",
    );

    // ---- Una hoja por tarifa con presencia
    for (const g of groups) {
      const filas: (string | number)[][] = [DETALLE_HEADERS.slice(1)];
      let hojaBase = 0;
      let hojaIva = 0;
      let hojaTotal = 0;
      for (const inv of g.invoices) {
        hojaBase += inv.base;
        hojaIva += inv.iva;
        hojaTotal += inv.total_comprobante;
        filas.push(filaDetalle(g.taxRateLabel, inv).slice(1));
      }
      filas.push([
        "TOTALES",
        "",
        "",
        "",
        "",
        "",
        "",
        r2(hojaBase),
        r2(hojaIva),
        r2(hojaTotal),
        "",
      ]);
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet(filas),
        sheetNameFor(g.taxRateLabel),
      );
    }

    // ---- Hoja: Notas
    const notas: string[][] = [
      ["Período", `${ddmmyyyy(startDate)} al ${ddmmyyyy(endDate)}`],
      ["Fecha de generación", new Date().toLocaleString("es-CR")],
      ["Empresa", empresaActiva?.name ?? ""],
      ["Montos expresados en colones", "Convertidos con el tipo de cambio del propio XML"],
      ["Criterio", "Se excluyen tiquetes electrónicos"],
      ["Criterio", "Se excluyen documentos no aceptados en Hacienda"],
      ["Criterio", "Notas de crédito registradas en negativo"],
      ["Criterio", "Solo se incluyen documentos ya publicados en QuickBooks"],
    ];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(notas), "Notas");

    const fileName = `IVA por Tarifa ${startDate} a ${endDate}.xlsx`;
    XLSX.writeFile(workbook, fileName);

    toast({
      title: "Reporte exportado",
      description: `Se descargó el archivo ${fileName}`,
    });
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-2">
                <Percent className="h-8 w-8 text-primary" />
                IVA por Tarifa (QuickBooks)
              </h1>
              <p className="text-muted-foreground">
                {empresaActiva?.name ? `${empresaActiva.name} · ` : ""}
                Montos expresados en colones. Solo documentos aceptados que ya se
                publicaron en QuickBooks.
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
                Documentos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold [font-variant-numeric:tabular-nums]">
                {report?.documentCount ?? 0}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Base gravada
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold [font-variant-numeric:tabular-nums]">
                {money(report?.totalBase ?? 0)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                IVA total
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary [font-variant-numeric:tabular-nums]">
                {money(report?.totalTax ?? 0)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-accent-foreground [font-variant-numeric:tabular-nums]">
                {money(report?.totalAmount ?? 0)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Detalle por tarifa */}
        <Card>
          <CardHeader>
            <CardTitle>Desglose por tarifa de IVA</CardTitle>
            <CardDescription>
              Un documento con líneas gravadas y exentas aparece en más de una tarifa,
              con la porción que corresponde a cada una. Montos en colones.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8">Cargando reporte…</div>
            ) : groups.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No hay documentos publicados en QuickBooks en el período seleccionado
              </div>
            ) : (
              <Accordion type="multiple" className="space-y-2">
                {groups.map((summary) => (
                  <AccordionItem
                    key={summary.taxRateLabel}
                    value={`rate-${summary.taxRate}`}
                    className="border rounded-lg px-4"
                  >
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center justify-between w-full pr-4 flex-wrap gap-3">
                        <div className="flex items-center gap-3">
                          <Badge
                            variant={summary.taxRate === 0 ? "secondary" : "default"}
                            className="text-sm"
                          >
                            {summary.taxRateLabel}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            {summary.count} documentos
                          </span>
                        </div>
                        <div className="flex items-center gap-6 text-sm [font-variant-numeric:tabular-nums]">
                          <div>
                            <span className="text-muted-foreground">Base gravada:</span>{" "}
                            <span className="font-medium">{money(summary.totalBase)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">IVA:</span>{" "}
                            <span className="font-medium text-primary">
                              {money(summary.totalTax)}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Total:</span>{" "}
                            <span className="font-bold text-accent-foreground">
                              {money(summary.totalAmount)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Consecutivo</TableHead>
                            <TableHead>Emisor</TableHead>
                            <TableHead>Cédula</TableHead>
                            <TableHead>Fecha</TableHead>
                            <TableHead>Tipo</TableHead>
                            <TableHead>Moneda</TableHead>
                            <TableHead className="text-right">Tipo cambio</TableHead>
                            <TableHead className="text-right">Base gravada</TableHead>
                            <TableHead className="text-right">IVA</TableHead>
                            <TableHead className="text-right">Total comprobante</TableHead>
                            <TableHead>ID QuickBooks</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {summary.invoices.map((inv) => (
                            <TableRow
                              key={`${inv.doc_key}-${summary.taxRateLabel}`}
                              className={inv.tipo === "NC" ? "bg-muted/40" : undefined}
                            >
                              <TableCell className="font-medium">
                                {inv.consecutivo ?? "—"}
                              </TableCell>
                              <TableCell>{inv.nombre_emisor ?? "—"}</TableCell>
                              <TableCell className="[font-variant-numeric:tabular-nums]">
                                {formatCedula(inv.cedula_emisor) || "—"}
                              </TableCell>
                              <TableCell>{ddmmyyyy(inv.issue_date)}</TableCell>
                              <TableCell>
                                {inv.tipo === "NC" ? (
                                  <Badge variant="outline">Nota de crédito</Badge>
                                ) : (
                                  inv.tipo
                                )}
                              </TableCell>
                              <TableCell>{inv.moneda}</TableCell>
                              <TableCell className="text-right [font-variant-numeric:tabular-nums]">
                                {inv.tipo_cambio}
                              </TableCell>
                              <TableCell className="text-right [font-variant-numeric:tabular-nums]">
                                {money(inv.base)}
                              </TableCell>
                              <TableCell className="text-right text-primary [font-variant-numeric:tabular-nums]">
                                {money(inv.iva)}
                              </TableCell>
                              <TableCell className="text-right font-medium [font-variant-numeric:tabular-nums]">
                                {money(inv.total_comprobante)}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {inv.qbo_entity_id || "—"}
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
