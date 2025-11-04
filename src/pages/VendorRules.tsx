import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Upload, FileSpreadsheet, Loader2, CheckCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import * as XLSX from "xlsx";

interface VendorRule {
  vendor_name: string;
  account_code: string;
  account_description: string;
}

const VendorRules = () => {
  const { activeOrganization } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [rulesCount, setRulesCount] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedRules, setParsedRules] = useState<VendorRule[]>([]);

  useEffect(() => {
    if (activeOrganization) {
      loadRulesCount();
    }
  }, [activeOrganization]);

  const loadRulesCount = async () => {
    if (!activeOrganization) return;

    const { count, error } = await supabase
      .from("vendor_classification_rules")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", activeOrganization)
      .eq("is_active", true);

    if (!error && count !== null) {
      setRulesCount(count);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

      // Parsear reglas del Excel
      const rules: VendorRule[] = [];
      
      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!row || row.length < 3) continue;

        // Columna 1: nombre proveedor (puede estar en col 0 o 2)
        // Columna 3: cuenta contable
        const vendorName = (row[2] || row[0] || "").toString().trim();
        const accountFull = (row[3] || "").toString().trim();

        if (vendorName && accountFull) {
          rules.push({
            vendor_name: vendorName,
            account_code: accountFull.split(":")[0].trim(),
            account_description: accountFull,
          });
        }
      }

      // Remover duplicados
      const uniqueRules = Array.from(
        new Map(rules.map(r => [r.vendor_name, r])).values()
      );

      setParsedRules(uniqueRules);
      toast.success(`Se encontraron ${uniqueRules.length} reglas en el archivo`);
    } catch (error) {
      console.error("Error parsing Excel:", error);
      toast.error("Error al leer el archivo Excel");
    }
  };

  const handleImportRules = async () => {
    if (!activeOrganization || parsedRules.length === 0) {
      toast.error("No hay reglas para importar");
      return;
    }

    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("import-vendor-rules", {
        body: {
          organization_id: activeOrganization,
          rules: parsedRules,
        },
      });

      if (error) throw error;

      toast.success(data.message || "Reglas importadas exitosamente");
      setParsedRules([]);
      setSelectedFile(null);
      loadRulesCount();
    } catch (error) {
      console.error("Error importing rules:", error);
      toast.error("Error al importar reglas");
    } finally {
      setIsLoading(false);
    }
  };

  if (!activeOrganization) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">No hay organización activa</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/dashboard">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Volver
              </Link>
            </Button>
            <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
              <FileSpreadsheet className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Reglas de Clasificación</h1>
              <p className="text-xs text-muted-foreground">
                Importa reglas desde Excel para clasificar proveedores
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 max-w-4xl space-y-6">
        {/* Estado actual */}
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold mb-1">Estado Actual</h2>
              <p className="text-sm text-muted-foreground">
                Reglas activas en el sistema
              </p>
            </div>
            <Badge variant="default" className="text-lg px-4 py-2">
              {rulesCount} reglas
            </Badge>
          </div>
        </Card>

        {/* Importar reglas */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Importar Reglas desde Excel</h2>
          
          <div className="space-y-4">
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground mb-4">
                Selecciona el archivo Excel con las reglas de clasificación
              </p>
              <Input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileSelect}
                className="max-w-xs mx-auto"
              />
              {selectedFile && (
                <p className="text-sm text-foreground mt-3">
                  <CheckCircle className="h-4 w-4 inline mr-1 text-green-600" />
                  {selectedFile.name}
                </p>
              )}
            </div>

            {parsedRules.length > 0 && (
              <div className="bg-muted p-4 rounded-lg">
                <h3 className="font-medium mb-2">Vista Previa</h3>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {parsedRules.slice(0, 10).map((rule, idx) => (
                    <div key={idx} className="text-sm flex items-center gap-2 bg-background p-2 rounded">
                      <span className="font-medium">{rule.vendor_name}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="text-primary">{rule.account_code}</span>
                    </div>
                  ))}
                  {parsedRules.length > 10 && (
                    <p className="text-xs text-muted-foreground text-center pt-2">
                      ... y {parsedRules.length - 10} reglas más
                    </p>
                  )}
                </div>
              </div>
            )}

            <Button
              onClick={handleImportRules}
              disabled={isLoading || parsedRules.length === 0}
              className="w-full"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importando...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Importar {parsedRules.length} Reglas
                </>
              )}
            </Button>
          </div>
        </Card>

        {/* Instrucciones */}
        <Card className="p-6 bg-muted/50">
          <h3 className="font-semibold mb-3">Formato del Archivo Excel</h3>
          <ul className="text-sm space-y-2 text-muted-foreground">
            <li>• El archivo debe tener columnas con nombres de proveedores y cuentas contables</li>
            <li>• Cada proveedor se asociará con su cuenta contable correspondiente</li>
            <li>• Las reglas importadas reemplazarán las reglas existentes</li>
            <li>• Formato de cuenta: "5105 Costo de ventas:Alimentos y Bebidas"</li>
          </ul>
        </Card>
      </main>
    </div>
  );
};

export default VendorRules;
