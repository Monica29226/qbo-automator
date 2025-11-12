import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Plus, Trash2, Upload, AlertCircle } from "lucide-react";
import * as XLSX from 'xlsx';
import { QBOAccountsDiagnostic } from "@/components/dashboard/QBOAccountsDiagnostic";

export default function VendorCategories() {
  const { activeOrganization } = useAuth();
  const queryClient = useQueryClient();
  const [newCategory, setNewCategory] = useState({
    vendor_identification: "",
    vendor_name: "",
    account_code: ""
  });

  const { data: categories, isLoading } = useQuery({
    queryKey: ["vendor-categories", activeOrganization],
    queryFn: async () => {
      if (!activeOrganization) return [];
      
      const { data, error } = await supabase
        .from("vendor_categories")
        .select("*")
        .eq("organization_id", activeOrganization)
        .eq("is_active", true)
        .order("vendor_name");

      if (error) throw error;
      return data;
    },
    enabled: !!activeOrganization
  });

  const addMutation = useMutation({
    mutationFn: async (category: typeof newCategory) => {
      const { error } = await supabase
        .from("vendor_categories")
        .insert([{ ...category, organization_id: activeOrganization }]);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendor-categories"] });
      setNewCategory({ vendor_identification: "", vendor_name: "", account_code: "" });
      toast.success("Categoría agregada exitosamente");
    },
    onError: (error: any) => {
      toast.error(error.message || "Error al agregar categoría");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("vendor_categories")
        .update({ is_active: false })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendor-categories"] });
      toast.success("Categoría eliminada");
    }
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      // Expected format: identificacion, nombre, cuentaContable
      const categoriesToInsert = jsonData.map((row: any) => ({
        organization_id: activeOrganization,
        vendor_identification: row.identificacion || row.identification || "",
        vendor_name: row.nombre || row.name || "",
        account_code: row.cuentaContable || row.account_code || ""
      }));

      const { error } = await supabase
        .from("vendor_categories")
        .insert(categoriesToInsert);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["vendor-categories"] });
      toast.success(`${categoriesToInsert.length} categorías importadas`);
      e.target.value = "";
    } catch (error: any) {
      toast.error("Error al importar: " + error.message);
    }
  };

  const handleAdd = () => {
    if (!newCategory.vendor_identification || !newCategory.vendor_name || !newCategory.account_code) {
      toast.error("Todos los campos son requeridos");
      return;
    }
    addMutation.mutate(newCategory);
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold">Categorías de Proveedores</h1>
          <div className="flex gap-2">
            <Label htmlFor="excel-upload" className="cursor-pointer">
              <Button variant="outline" asChild>
                <span>
                  <Upload className="h-4 w-4 mr-2" />
                  Importar Excel
                </span>
              </Button>
            </Label>
            <Input
              id="excel-upload"
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Antes de configurar proveedores</AlertTitle>
          <AlertDescription>
            Consulta las cuentas disponibles en QuickBooks para asignarlas correctamente a tus proveedores.
            {categories?.length === 0 && (
              <span className="block mt-2 font-semibold text-destructive">
                ⚠️ No hay proveedores configurados. Agrega proveedores con cuentas válidas de QuickBooks.
              </span>
            )}
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Cuentas de QuickBooks Disponibles</CardTitle>
            <CardDescription>
              Usa este diagnóstico para ver qué cuentas existen en QuickBooks y sus códigos
            </CardDescription>
          </CardHeader>
          <CardContent>
            <QBOAccountsDiagnostic />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Agregar Nueva Categoría</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <Label>Identificación</Label>
                <Input
                  value={newCategory.vendor_identification}
                  onChange={(e) => setNewCategory({ ...newCategory, vendor_identification: e.target.value })}
                  placeholder="3101123456"
                />
              </div>
              <div>
                <Label>Nombre del Proveedor</Label>
                <Input
                  value={newCategory.vendor_name}
                  onChange={(e) => setNewCategory({ ...newCategory, vendor_name: e.target.value })}
                  placeholder="Compañía XYZ S.A."
                />
              </div>
              <div>
                <Label>Cuenta Contable</Label>
                <Input
                  value={newCategory.account_code}
                  onChange={(e) => setNewCategory({ ...newCategory, account_code: e.target.value })}
                  placeholder="6000"
                />
              </div>
              <div className="flex items-end">
                <Button onClick={handleAdd} className="w-full">
                  <Plus className="h-4 w-4 mr-2" />
                  Agregar
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Categorías Activas ({categories?.length || 0})</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p>Cargando...</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Identificación</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Cuenta</TableHead>
                    <TableHead className="w-20">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories?.map((cat) => (
                    <TableRow key={cat.id}>
                      <TableCell className="font-mono">{cat.vendor_identification}</TableCell>
                      <TableCell>{cat.vendor_name}</TableCell>
                      <TableCell className="font-mono">{cat.account_code}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMutation.mutate(cat.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
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