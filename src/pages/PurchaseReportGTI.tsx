import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import * as XLSX from "xlsx";
import { useAuth } from "@/hooks/useAuth";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  useTaxRateReport,
  type ComprasRow,
  type TaxRateSummary,
} from "@/hooks/useTaxRateReport";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
interface GtiRow {
  consecutivo: string;
  emisor: string;
  iva13: number;
}

interface GtiFileData {
  cedula: string;
  rows: GtiRow[];
}

interface EmpresaResultado {
  organization_id: string;
  empresa: string;
  cedula: string;
  documentos: number;
  ivaTotal: number;
  totalGasto: number;
  revisar: boolean;
  conciliacion?: { diferencia: number; soloGti: number; soloFF: number };
  sinDocumentos?: boolean;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre",
];

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(n)
    .replace(/^-(.*)$/, "($1)");

const soloDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** Cédula de persona física (9 dígitos) en formato 1-4-4; las demás, tal cual. */
const formatCedula = (v: unknown) => {
  const d = soloDigitos(v);
  if (d.length === 9) return `${d.slice(0, 1)}-${d.slice(1, 5)}-${d.slice(5)}`;
  return d;
};

const ddmmyyyy = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

const sanitizeName = (s: string) => s.replace(/[\\/:*?"<>|]/g, "-").trim();

const HEADERS = [
  "Id Empresa",
  "Tipo Doc Recibido",
  "Consecutivo Aceptación",
  "Fecha Emisión Aceptación",
  "Consecutivo Documento",
  "Actividad Económica Receptor",
  "Nombre Actividad Económica Receptor",
  "Identificación Emisor",
  "Nombre Emisor",
  "Actividad Económica Emisor",
  "Fecha Emisión Documento",
  "Estado Hacienda",
  "Mensaje Hacienda",
  "Total de Gasto Aplicable",
  "Total Impuesto Acreditar",
  "Total Gravado",
  "Total Exento",
  "Total Exonerado",
  "Total Descuento",
  "Total Neto",
  "Otros Impuestos",
  "Total B.Usados/IVAEspecial",
  "Total IVA",
  "Tarifa 1%",
  "Tarifa 2%",
  "Tarifa 4%",
  "Tarifa 8%",
  "Tarifa 13%",
  "Total IVA Devuelto",
  "Otros Cargos",
  "Total Comprobante",
  "Código Moneda",
  "Tipo Cambio",
  "Total Colones",
  "Clave",
];

// Lectura tolerante de encabezados del reporte de GTI
const normKey = (k: string) =>
  k
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

function pick(row: Record<string, unknown>, candidates: string[]): unknown {
  const map = new Map<string, unknown>();
  for (const k of Object.keys(row)) map.set(normKey(k), row[k]);
  for (const c of candidates) {
    const v = map.get(normKey(c));
    if (v !== undefined) return v;
  }
  return undefined;
}

async function parseGtiFile(file: File): Promise<GtiFileData | null> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  const detalleName = wb.SheetNames.find((n) => normKey(n).includes("listadocaceptacion"));
  const filtrosName = wb.SheetNames.find((n) => normKey(n).includes("filtros"));
  if (!detalleName || !filtrosName) return null;

  // Cédula de la empresa: se toma SIEMPRE de la hoja "Filtros", nunca del nombre del archivo.
  const filtros = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[filtrosName], { header: 1 });
  let cedula = "";
  for (const fila of filtros) {
    for (const celda of fila || []) {
      const d = soloDigitos(celda);
      if (d.length >= 9 && d.length <= 12) {
        cedula = d;
        break;
      }
    }
    if (cedula) break;
  }
  if (!cedula) return null;

  const detalle = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[detalleName]);
  const rows: GtiRow[] = detalle
    .map((row) => ({
      consecutivo: String(pick(row, ["Consecutivo Documento"]) ?? "").trim(),
      emisor: String(pick(row, ["Nombre Emisor"]) ?? "").trim(),
      iva13: num(pick(row, ["Tarifa 13%"])),
    }))
    .filter((r) => r.consecutivo);

  return { cedula, rows };
}

// ---------------------------------------------------------------------------
// Construcción del libro por empresa
// ---------------------------------------------------------------------------
function buildWorkbook(
  docs: ComprasRow[],
  periodoLabel: string,
  gti: GtiFileData | undefined,
  groups: TaxRateSummary[],
  soloPublicados: boolean,
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const cedulaEmpresa = soloDigitos(docs[0].cedula_empresa) || "";

  // ---- Hoja 1: ListaDocAceptacionConTasas1
  const detalle = docs.map((d) => {
    const totalNeto = r2(d.total_comprobante - d.iva_total);
    return [
      cedulaEmpresa,
      d.tipo === "NC" ? "Nota de Crédito Electrónica" : "Factura Electrónica",
      "",
      "",
      d.consecutivo ?? "",
      "",
      "",
      soloDigitos(d.cedula_emisor),
      d.nombre_emisor ?? "",
      "",
      ddmmyyyy(d.issue_date),
      "aceptado",
      "",
      d.total_comprobante,
      d.iva_total,
      d.base_gravada,
      d.exento,
      0,
      d.descuento,
      totalNeto,
      0,
      0,
      d.iva_total,
      d.t1,
      d.t2,
      d.t4,
      d.t8,
      d.t13,
      0,
      d.otros_cargos,
      d.total_comprobante,
      d.moneda,
      d.tipo_cambio,
      d.total_comprobante,
      d.doc_key,
    ];
  });
  const ws1 = XLSX.utils.aoa_to_sheet([HEADERS, ...detalle]);
  XLSX.utils.book_append_sheet(wb, ws1, "ListaDocAceptacionConTasas1");

  // ---- Hoja 2: Resumen Compras
  const tarifas: Array<{ label: string; pct: number; iva: number; docs: number }> = [
    {
      label: "13%",
      pct: 13,
      iva: r2(docs.reduce((a, d) => a + d.t13, 0)),
      docs: docs.filter((d) => d.t13 !== 0).length,
    },
    {
      label: "8%",
      pct: 8,
      iva: r2(docs.reduce((a, d) => a + d.t8, 0)),
      docs: docs.filter((d) => d.t8 !== 0).length,
    },
    {
      label: "4%",
      pct: 4,
      iva: r2(docs.reduce((a, d) => a + d.t4, 0)),
      docs: docs.filter((d) => d.t4 !== 0).length,
    },
    {
      label: "2%",
      pct: 2,
      iva: r2(docs.reduce((a, d) => a + d.t2, 0)),
      docs: docs.filter((d) => d.t2 !== 0).length,
    },
    {
      label: "1%",
      pct: 1,
      iva: r2(docs.reduce((a, d) => a + d.t1, 0)),
      docs: docs.filter((d) => d.t1 !== 0).length,
    },
    { label: "0.5%", pct: 0.5, iva: 0, docs: 0 },
  ];
  const exento = r2(docs.reduce((a, d) => a + d.exento, 0));
  const exentoDocs = docs.filter((d) => d.exento !== 0).length;
  const resumen: (string | number)[][] = [
    ["Tarifa IVA", "Documentos", "SubTotal", "Impuesto", "IVADevuelto", "TotalColones"],
  ];
  let sumBase = 0;
  let sumIva = 0;
  for (const t of tarifas) {
    const base = t.iva ? r2(t.iva / (t.pct / 100)) : 0;
    sumBase += base;
    sumIva += t.iva;
    resumen.push([t.label, t.docs, base, t.iva, 0, r2(base + t.iva)]);
  }
  resumen.push(["Exento", exentoDocs, exento, 0, 0, exento]);
  resumen.push(["Exonerado", 0, 0, 0, 0, 0]);
  resumen.push(["No sujeto", 0, 0, 0, 0, 0]);
  resumen.push([
    "Totales",
    docs.length,
    r2(sumBase + exento),
    r2(sumIva),
    0,
    r2(sumBase + exento + sumIva),
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), "Resumen Compras");

  // ---- Hoja 3: Detalle por Tarifa (una fila por documento y por tarifa)
  const detalleTarifa: (string | number)[][] = [
    [
      "Tarifa",
      "Consecutivo",
      "Emisor",
      "Cédula",
      "Fecha",
      "Tipo",
      "Moneda",
      "Tipo de cambio",
      "Base gravada",
      "IVA",
      "Total comprobante (colones)",
      "ID QuickBooks",
    ],
  ];
  for (const g of groups) {
    for (const inv of g.invoices) {
      detalleTarifa.push([
        g.taxRateLabel,
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
      ]);
    }
  }
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(detalleTarifa),
    "Detalle por Tarifa",
  );

  // ---- Hoja 4: Conciliación vs GTI (solo si se subió el reporte de esa empresa)
  if (gti) {
    const porConsecutivoFF = new Map<string, ComprasRow>();
    for (const d of docs) if (d.consecutivo) porConsecutivoFF.set(d.consecutivo.trim(), d);
    const porConsecutivoGti = new Map<string, GtiRow>();
    for (const g of gti.rows) porConsecutivoGti.set(g.consecutivo.trim(), g);

    const filas: (string | number)[][] = [
      [
        "Consecutivo",
        "Emisor",
        "Estado",
        "IVA 13% FacturaFlow",
        "IVA 13% GTI",
        "Diferencia",
        "Total FacturaFlow",
      ],
    ];
    let sumFF = 0;
    let sumGti = 0;
    let sumTotal = 0;

    for (const [cons, d] of porConsecutivoFF) {
      const g = porConsecutivoGti.get(cons);
      const ivaFF = r2(d.t13);
      const ivaGti = g ? r2(g.iva13) : 0;
      sumFF += ivaFF;
      sumGti += ivaGti;
      sumTotal += d.total_comprobante;
      filas.push([
        cons,
        d.nombre_emisor ?? "",
        g ? "En ambos" : "Solo en FacturaFlow",
        ivaFF,
        ivaGti,
        r2(ivaFF - ivaGti),
        d.total_comprobante,
      ]);
    }
    for (const [cons, g] of porConsecutivoGti) {
      if (porConsecutivoFF.has(cons)) continue;
      const ivaGti = r2(g.iva13);
      sumGti += ivaGti;
      filas.push([
        cons,
        g.emisor,
        "Solo en GTI (falta en el correo)",
        0,
        ivaGti,
        r2(-ivaGti),
        0,
      ]);
    }
    filas.push([
      "Totales",
      "",
      "",
      r2(sumFF),
      r2(sumGti),
      r2(sumFF - sumGti),
      r2(sumTotal),
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), "Conciliación vs GTI");
  }

  // ---- Hoja 5: Notas
  const notas: string[][] = [
    ["Período", periodoLabel],
    ["Fecha de generación", new Date().toLocaleString("es-CR")],
    ["Empresa", docs[0].empresa],
    ["Cédula", cedulaEmpresa],
    ["Documentos incluidos", String(docs.length)],
    [
      "Filtro «solo lo publicado en QuickBooks»",
      soloPublicados
        ? "Encendido: únicamente documentos con Id de QuickBooks"
        : "Apagado: todos los documentos aceptados",
    ],
    ["Montos expresados en colones", "Convertidos con el tipo de cambio del propio XML"],
    ["Criterio", "Se excluyen tiquetes electrónicos"],
    ["Criterio", "Se excluyen documentos no aceptados en Hacienda"],
    ["Criterio", "Notas de crédito registradas en negativo"],
    ["Criterio", "El monto exento se obtiene por cuadre, no de un campo del XML"],
    [""],
    ["Advertencia", "\"Total IVA Devuelto\" va en cero: ese dato solo lo tiene Hacienda."],
    ["Advertencia", "El consecutivo y la fecha de aceptación no están disponibles."],
    [
      "Advertencia",
      "El reporte solo incluye facturas que llegaron al correo; la hoja de conciliación es la que mide el faltante real contra ATV.",
    ],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(notas), "Notas");

  return wb;
}

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------
export default function PurchaseReportGTI() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { activeOrganization, organizations } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const empresaActiva = organizations.find((o) => o.id === activeOrganization);

  const prev = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return { month: d.getMonth() + 1, year: d.getFullYear() };
  }, []);

  const [mes, setMes] = useState(String(prev.month));
  const [anio, setAnio] = useState(String(prev.year));
  const [usarRango, setUsarRango] = useState(false);
  const [soloPublicados, setSoloPublicados] = useState(false);
  const [archivos, setArchivos] = useState<File[]>([]);
  const [generando, setGenerando] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [progresoTexto, setProgresoTexto] = useState("");
  const [resultados, setResultados] = useState<EmpresaResultado[]>([]);

  const anios = useMemo(() => {
    const y = new Date().getFullYear();
    return [y + 1, y, y - 1, y - 2, y - 3];
  }, []);

  // Período: mes calendario (D-104) o rango libre de fechas
  const mesDesde = `${anio}-${String(Number(mes)).padStart(2, "0")}-01`;
  const mesHasta = useMemo(() => {
    const d = new Date(Number(anio), Number(mes), 0); // último día del mes
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  }, [anio, mes]);

  const [rangoDesde, setRangoDesde] = useState(mesDesde);
  const [rangoHasta, setRangoHasta] = useState(mesHasta);

  const desde = usarRango ? rangoDesde : mesDesde;
  const hasta = usarRango ? rangoHasta : mesHasta;

  const periodoLabel = usarRango
    ? `${ddmmyyyy(desde)} al ${ddmmyyyy(hasta)}`
    : `${MESES[Number(mes) - 1]} ${anio}`;

  const { data: report, isLoading } = useTaxRateReport(
    activeOrganization,
    desde,
    hasta,
    soloPublicados,
  );

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setArchivos((prevFiles) => [...prevFiles, ...Array.from(list)]);
  };

  const descargar = async () => {
    if (!activeOrganization) {
      toast({
        title: "Seleccione una empresa",
        description: "El reporte se genera para la empresa activa.",
        variant: "destructive",
      });
      return;
    }

    setGenerando(true);
    setResultados([]);
    setProgreso(20);
    setProgresoTexto("Preparando documentos…");

    try {
      const docs = report?.rows ?? [];
      const groups = report?.groups ?? [];

      if (docs.length === 0) {
        setResultados([
          {
            organization_id: activeOrganization,
            empresa: empresaActiva?.name ?? "Empresa activa",
            cedula: "",
            documentos: 0,
            ivaTotal: 0,
            totalGasto: 0,
            revisar: false,
            sinDocumentos: true,
          },
        ]);
        toast({
          title: "Sin documentos",
          description: `No hay compras registradas en ${periodoLabel} para esta empresa.`,
        });
        return;
      }

      const cedula = soloDigitos(docs[0].cedula_empresa);
      if (!cedula) {
        toast({
          title: "Empresa sin cédula",
          description: `${docs[0].empresa} no tiene cédula registrada; "Id Empresa" quedaría vacío. Complete la cédula en Mi Empresa.`,
          variant: "destructive",
        });
      }

      // Reporte de GTI opcional: se usa el que corresponda a la cédula de esta empresa
      setProgresoTexto("Leyendo reportes de GTI…");
      let gti: GtiFileData | undefined;
      for (const f of archivos) {
        try {
          const parsed = await parseGtiFile(f);
          if (parsed && (!cedula || parsed.cedula === cedula)) {
            gti = parsed;
            break;
          }
        } catch {
          toast({
            title: "No se pudo leer el archivo",
            description: f.name,
            variant: "destructive",
          });
        }
      }
      if (archivos.length > 0 && !gti) {
        toast({
          title: "Reporte de GTI no aplicado",
          description: "Ningún archivo corresponde a la cédula de esta empresa.",
          variant: "destructive",
        });
      }

      setProgreso(60);
      setProgresoTexto(`Generando ${docs[0].empresa}…`);

      const wb = buildWorkbook(docs, periodoLabel, gti, groups, soloPublicados);
      const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const sufijo = usarRango
        ? `${desde} a ${hasta}`
        : `${String(Number(mes)).padStart(2, "0")}-${anio}`;
      const nombre = sanitizeName(
        `FUENTE - Compras FacturaFlow ${sufijo} ${docs[0].empresa}.xlsx`,
      );
      const blob = new Blob([out], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      let conciliacion: EmpresaResultado["conciliacion"];
      if (gti) {
        const ffPorCons = new Map(
          docs.filter((d) => d.consecutivo).map((d) => [d.consecutivo!.trim(), d]),
        );
        const gtiPorCons = new Map(gti.rows.map((g) => [g.consecutivo.trim(), g]));
        const ff13 = r2(docs.reduce((acc, d) => acc + d.t13, 0));
        const g13 = r2(gti.rows.reduce((acc, g) => acc + num(g.iva13), 0));
        let soloGti = 0;
        let soloFF = 0;
        for (const k of gtiPorCons.keys()) if (!ffPorCons.has(k)) soloGti += 1;
        for (const k of ffPorCons.keys()) if (!gtiPorCons.has(k)) soloFF += 1;
        conciliacion = { diferencia: r2(ff13 - g13), soloGti, soloFF };
      }

      setResultados([
        {
          organization_id: activeOrganization,
          empresa: docs[0].empresa,
          cedula,
          documentos: docs.length,
          ivaTotal: r2(docs.reduce((acc, d) => acc + d.iva_total, 0)),
          totalGasto: r2(docs.reduce((acc, d) => acc + d.total_comprobante, 0)),
          revisar: docs.some((d) => d.revisar),
          conciliacion,
        },
      ]);
      setProgreso(100);
      setProgresoTexto("Listo");
      toast({ title: "Reporte generado", description: nombre });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Error desconocido";
      toast({ title: "No se pudo generar el reporte", description: msg, variant: "destructive" });
    } finally {
      setGenerando(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <FileSpreadsheet className="h-6 w-6 text-primary" />
              Reporte de Compras e IVA
            </h1>
            <p className="text-sm text-muted-foreground">
              Desglose por tarifa de IVA y archivo en formato GTI para la declaración del D-104.
              Montos expresados en colones. Se excluyen tiquetes electrónicos y documentos no
              aceptados en Hacienda.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Período</CardTitle>
            <CardDescription>
              El reporte se genera únicamente para la empresa activa:{" "}
              <span className="font-medium text-foreground">
                {empresaActiva?.name ?? "ninguna seleccionada"}
              </span>
              . Para otra empresa, cámbiela en el selector de empresa.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-3">
                <Switch
                  id="usar-rango"
                  checked={usarRango}
                  onCheckedChange={setUsarRango}
                />
                <Label htmlFor="usar-rango">Rango de fechas</Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="solo-publicados"
                  checked={soloPublicados}
                  onCheckedChange={setSoloPublicados}
                />
                <Label htmlFor="solo-publicados">Solo lo publicado en QuickBooks</Label>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 items-end">
              {usarRango ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="rango-desde">Desde</Label>
                    <Input
                      id="rango-desde"
                      type="date"
                      className="w-[180px]"
                      value={rangoDesde}
                      onChange={(e) => setRangoDesde(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rango-hasta">Hasta</Label>
                    <Input
                      id="rango-hasta"
                      type="date"
                      className="w-[180px]"
                      value={rangoHasta}
                      onChange={(e) => setRangoHasta(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>Mes</Label>
                    <Select value={mes} onValueChange={setMes}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MESES.map((nombre, idx) => (
                          <SelectItem key={nombre} value={String(idx + 1)}>
                            {nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Año</Label>
                    <Select value={anio} onValueChange={setAnio}>
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {anios.map((y) => (
                          <SelectItem key={y} value={String(y)}>
                            {y}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
              <Button
                onClick={descargar}
                disabled={generando || isLoading}
                className="gap-2"
              >
                {generando || isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Descargar Excel
              </Button>
            </div>

            {/* Reportes de GTI opcionales */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
              className="border border-dashed rounded p-6 text-center space-y-3"
            >
              <Upload className="h-5 w-5 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Opcional: suelte aquí los reportes de GTI del mismo mes para agregar la hoja de
                conciliación. La empresa se identifica por la cédula de la hoja «Filtros».
              </p>
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                Seleccionar archivos
              </Button>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => addFiles(e.target.files)}
              />
              {archivos.length > 0 && (
                <ul className="text-sm text-left space-y-1 max-w-xl mx-auto">
                  {archivos.map((f, idx) => (
                    <li key={`${f.name}-${idx}`} className="flex items-center justify-between gap-2">
                      <span className="truncate">{f.name}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          setArchivos((prevFiles) => prevFiles.filter((_, i) => i !== idx))
                        }
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {generando && (
              <div className="space-y-2">
                <Progress value={progreso} />
                <p className="text-sm text-muted-foreground">{progresoTexto}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tarjetas de totales */}
        <div className="grid gap-4 md:grid-cols-4">
          {[
            { label: "Documentos", valor: (report?.documentCount ?? 0).toLocaleString("en-US") },
            { label: "Base gravada", valor: money(report?.totalBase ?? 0) },
            { label: "IVA total", valor: money(report?.totalTax ?? 0) },
            { label: "Total", valor: money(report?.totalAmount ?? 0) },
          ].map((k) => (
            <Card key={k.label}>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs uppercase tracking-[0.14em] font-semibold">
                  {k.label}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums">
                  {isLoading ? "—" : k.valor}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Desglose por tarifa */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Desglose por tarifa · {periodoLabel}</CardTitle>
            <CardDescription>
              Montos expresados en colones.{" "}
              {soloPublicados
                ? "Solo documentos ya publicados en QuickBooks."
                : "Todos los documentos aceptados."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Consultando documentos…</p>
            ) : (report?.groups.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay compras registradas en este período para esta empresa.
              </p>
            ) : (
              <Accordion type="multiple" className="w-full">
                {report!.groups.map((g) => (
                  <AccordionItem key={g.taxRateLabel} value={g.taxRateLabel}>
                    <AccordionTrigger>
                      <div className="flex flex-1 items-center justify-between gap-4 pr-4 text-sm">
                        <span className="font-medium">
                          {g.taxRateLabel}
                          <span className="ml-2 text-muted-foreground">
                            {g.count} {g.count === 1 ? "documento" : "documentos"}
                          </span>
                        </span>
                        <span className="flex gap-6 tabular-nums">
                          <span>Base {money(g.totalBase)}</span>
                          <span>IVA {money(g.totalTax)}</span>
                          <span className="font-medium">Total {money(g.totalAmount)}</span>
                        </span>
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
                            <TableHead className="text-right">Tipo de cambio</TableHead>
                            <TableHead className="text-right">Base gravada</TableHead>
                            <TableHead className="text-right">IVA</TableHead>
                            <TableHead className="text-right">Total comprobante</TableHead>
                            <TableHead>ID QuickBooks</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {g.invoices.map((inv) => (
                            <TableRow key={`${g.taxRateLabel}-${inv.doc_key}`}>
                              <TableCell className="tabular-nums">
                                {inv.consecutivo ?? "—"}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <span>{inv.nombre_emisor ?? "—"}</span>
                                  {inv.tipo === "NC" && (
                                    <Badge variant="outline">Nota de crédito</Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="tabular-nums">
                                {formatCedula(inv.cedula_emisor) || "—"}
                              </TableCell>
                              <TableCell className="tabular-nums">
                                {ddmmyyyy(inv.issue_date)}
                              </TableCell>
                              <TableCell>{inv.tipo}</TableCell>
                              <TableCell>{inv.moneda}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {money(inv.tipo_cambio)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {money(inv.base)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {money(inv.iva)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {money(inv.total_comprobante)}
                              </TableCell>
                              <TableCell className="tabular-nums">
                                {inv.qbo_entity_id ?? "—"}
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

        {resultados.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Resumen · {periodoLabel}</CardTitle>
              <CardDescription>Montos expresados en colones.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empresa</TableHead>
                    <TableHead className="text-right">Documentos</TableHead>
                    <TableHead className="text-right">IVA total</TableHead>
                    <TableHead className="text-right">Total de gasto</TableHead>
                    <TableHead className="text-right">Diferencia vs GTI</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resultados.map((r) => (
                    <TableRow
                      key={r.organization_id}
                      className={r.revisar ? "bg-warning/10" : undefined}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {r.empresa}
                          {r.revisar && (
                            <Badge variant="outline" className="text-warning border-warning">
                              revisar
                            </Badge>
                          )}
                          {r.sinDocumentos && (
                            <Badge variant="secondary">sin documentos</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.documentos}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(r.ivaTotal)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(r.totalGasto)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.conciliacion ? (
                          <span>
                            {money(r.conciliacion.diferencia)}
                            {r.conciliacion.soloGti > 0 && (
                              <span className="text-muted-foreground">
                                {" "}
                                · {r.conciliacion.soloGti} solo en GTI
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">sin conciliación</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
