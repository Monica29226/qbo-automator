import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";

interface Document {
  id: string;
  doc_number: string;
  supplier_name: string;
  total_amount: number;
  qbo_entity_id: string;
  xml_data?: any;
}

interface DeleteBillsButtonProps {
  organizationId: string;
}

export function DeleteBillsButton({ organizationId }: DeleteBillsButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingDocs, setIsFetchingDocs] = useState(false);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());

  const fetchDocuments = async () => {
    setIsFetchingDocs(true);
    try {
      // Obtener documentos que están publicados en QuickBooks
      const { data, error } = await supabase
        .from("processed_documents")
        .select("id, doc_number, supplier_name, total_amount, qbo_entity_id, xml_data")
        .eq("organization_id", organizationId)
        .not("qbo_entity_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      setDocuments(data || []);
      
      if (data && data.length === 0) {
        toast.info("No hay facturas publicadas en QuickBooks");
      }
    } catch (error) {
      console.error("Error fetching documents:", error);
      toast.error("Error al cargar las facturas");
    } finally {
      setIsFetchingDocs(false);
    }
  };

  const handleOpen = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      fetchDocuments();
      setSelectedDocs(new Set());
    }
  };

  const toggleDocument = (docId: string) => {
    const newSelected = new Set(selectedDocs);
    if (newSelected.has(docId)) {
      newSelected.delete(docId);
    } else {
      newSelected.add(docId);
    }
    setSelectedDocs(newSelected);
  };

  const toggleAll = () => {
    if (selectedDocs.size === documents.length) {
      setSelectedDocs(new Set());
    } else {
      setSelectedDocs(new Set(documents.map(d => d.id)));
    }
  };

  const handleDelete = async () => {
    if (selectedDocs.size === 0) {
      toast.error("Selecciona al menos una factura");
      return;
    }

    const confirmed = confirm(
      `¿Estás seguro de borrar ${selectedDocs.size} factura(s) de QuickBooks?\n\nEsto:\n- Borrará las facturas de QuickBooks\n- Limpiará los registros en la base de datos\n- Permitirá que se vuelvan a publicar correctamente`
    );

    if (!confirmed) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "delete-bills-from-quickbooks",
        {
          body: {
            organization_id: organizationId,
            document_ids: Array.from(selectedDocs),
          },
        }
      );

      if (error) throw error;

      toast.success(
        `✅ ${data.deleted} factura(s) borradas exitosamente`,
        {
          description: data.failed > 0 
            ? `${data.failed} fallaron. Revisa los logs.`
            : "Ahora puedes republicarlas con la configuración correcta.",
        }
      );

      // Refrescar la lista
      fetchDocuments();
      setSelectedDocs(new Set());
    } catch (error) {
      console.error("Error deleting bills:", error);
      toast.error("Error al borrar las facturas", {
        description: error instanceof Error ? error.message : "Error desconocido",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Trash2 className="h-4 w-4 mr-2" />
          Borrar Facturas de QBO
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Borrar Facturas de QuickBooks</DialogTitle>
          <DialogDescription>
            Selecciona las facturas que quieres borrar de QuickBooks. Esto limpiará los registros y permitirá republicarlas correctamente.
          </DialogDescription>
        </DialogHeader>

        {isFetchingDocs ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b pb-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    checked={selectedDocs.size === documents.length && documents.length > 0}
                    onCheckedChange={toggleAll}
                  />
                  <span className="font-medium">
                    Seleccionar todas ({documents.length})
                  </span>
                </div>
                <span className="text-sm text-muted-foreground">
                  {selectedDocs.size} seleccionadas
                </span>
              </div>

              <div className="space-y-2 max-h-96 overflow-y-auto">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer"
                    onClick={() => toggleDocument(doc.id)}
                  >
                    <Checkbox
                      checked={selectedDocs.has(doc.id)}
                      onCheckedChange={() => toggleDocument(doc.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{doc.doc_number}</p>
                      <p className="text-sm text-muted-foreground truncate">
                        {doc.supplier_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Cuenta: {doc.xml_data?.cuentaContable || 'N/A'} • QBO ID: {doc.qbo_entity_id}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">
                        ₡{doc.total_amount.toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}

                {documents.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">
                    No hay facturas publicadas en QuickBooks
                  </p>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsOpen(false)}
                disabled={isLoading}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isLoading || selectedDocs.size === 0}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Borrando...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Borrar {selectedDocs.size} Factura(s)
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
