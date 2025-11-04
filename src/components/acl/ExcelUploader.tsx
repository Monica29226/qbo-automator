import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Upload, FileCheck, AlertTriangle } from "lucide-react";
import { useAppStore, ProviderMapping } from "@/store/appStore";
import { toast } from "sonner";
import * as XLSX from 'xlsx';

export const ExcelUploader = () => {
  const { excelMapping, providerMap, setExcelMapping, setProviderMap, addToLog } = useAppStore();

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.match(/\.(xlsx|xls|csv)$/)) {
      toast.error("Por favor suba un archivo Excel (.xlsx, .xls) o CSV");
      return;
    }

    try {
      addToLog({ level: 'INFO', message: `Cargando archivo: ${file.name}` });

      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(worksheet) as any[];

      if (json.length === 0) {
        toast.error("El archivo está vacío");
        return;
      }

      // Validar encabezados requeridos
      const requiredHeaders = ['proveedor', 'cedula', 'cuentaGasto', 'cuentaIVA', 'gravado', 'tasaIVA', 'descuentoDefault'];
      const firstRow = json[0];
      const headers = Object.keys(firstRow);
      
      const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
      if (missingHeaders.length > 0) {
        toast.error(`Faltan columnas: ${missingHeaders.join(', ')}`);
        addToLog({ level: 'ERROR', message: `Columnas faltantes: ${missingHeaders.join(', ')}` });
        return;
      }

      // Parsear y validar datos
      const validatedData: ProviderMapping[] = [];
      const errors: string[] = [];

      json.forEach((row, index) => {
        try {
          const tasaIVA = Number(row.tasaIVA);
          const descuentoDefault = Number(row.descuentoDefault);
          const gravado = String(row.gravado).toUpperCase() === 'TRUE';

          if (![0, 1, 2, 4, 13].includes(tasaIVA)) {
            errors.push(`Fila ${index + 2}: tasaIVA debe ser 0, 1, 2, 4 o 13`);
          }

          if (descuentoDefault < 0 || descuentoDefault > 100) {
            errors.push(`Fila ${index + 2}: descuentoDefault debe estar entre 0 y 100`);
          }

          if (!row.proveedor || !row.cuentaGasto) {
            errors.push(`Fila ${index + 2}: proveedor y cuentaGasto son obligatorios`);
          }

          validatedData.push({
            proveedor: String(row.proveedor).trim(),
            cedula: String(row.cedula || '').trim(),
            cuentaGasto: String(row.cuentaGasto).trim(),
            cuentaIVA: String(row.cuentaIVA || '').trim(),
            gravado,
            tasaIVA,
            descuentoDefault,
          });
        } catch (error) {
          errors.push(`Fila ${index + 2}: error al parsear datos`);
        }
      });

      if (errors.length > 0) {
        toast.error(`Se encontraron ${errors.length} errores en el archivo`);
        addToLog({ level: 'ERROR', message: `Errores de validación: ${errors.join('; ')}` });
        return;
      }

      setProviderMap(validatedData);
      setExcelMapping({
        uploaded: true,
        fileName: file.name,
        lastUpdated: new Date(),
      });

      toast.success(`Excel cargado: ${validatedData.length} proveedores`);
      addToLog({ level: 'INFO', message: `Excel cargado exitosamente: ${validatedData.length} proveedores` });
    } catch (error) {
      console.error('Error parsing Excel:', error);
      toast.error('Error al procesar el archivo Excel');
      addToLog({ level: 'ERROR', message: `Error al procesar Excel: ${error}` });
    }
  };

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold mb-4">📊 Subir Excel de Mapeo de Proveedores</h2>
      
      <div className="space-y-4">
        <div className="bg-muted/50 p-4 rounded-lg">
          <p className="text-sm font-medium mb-2">Columnas requeridas (fila de encabezado exacta):</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <Badge variant="outline">proveedor</Badge>
            <Badge variant="outline">cedula</Badge>
            <Badge variant="outline">cuentaGasto</Badge>
            <Badge variant="outline">cuentaIVA</Badge>
            <Badge variant="outline">gravado</Badge>
            <Badge variant="outline">tasaIVA</Badge>
            <Badge variant="outline">descuentoDefault</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            <strong>tasaIVA:</strong> 0, 1, 2, 4 o 13 | <strong>gravado:</strong> TRUE/FALSE | <strong>descuentoDefault:</strong> 0-100
          </p>
        </div>

        <label htmlFor="excel-upload" className="cursor-pointer">
          <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary transition-colors">
            {excelMapping.uploaded ? (
              <>
                <FileCheck className="h-12 w-12 mx-auto mb-3 text-success" />
                <p className="font-medium mb-1">✓ {excelMapping.fileName}</p>
                <p className="text-sm text-muted-foreground">
                  {providerMap.length} proveedores · Actualizado: {excelMapping.lastUpdated?.toLocaleString('es-CR')}
                </p>
                <Button variant="outline" size="sm" className="mt-3">
                  Actualizar Excel
                </Button>
              </>
            ) : (
              <>
                <Upload className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
                <p className="font-medium mb-1">Subir archivo Excel</p>
                <p className="text-sm text-muted-foreground">.xlsx, .xls o .csv</p>
              </>
            )}
          </div>
          <Input
            id="excel-upload"
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleFileUpload}
          />
        </label>

        {!excelMapping.uploaded && (
          <div className="flex items-start gap-2 p-3 bg-warning/10 border border-warning/30 rounded-lg">
            <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
            <p className="text-sm text-warning">
              <strong>Advertencia:</strong> Sin mapeo cargado, el procesamiento automático no funcionará correctamente.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
};
