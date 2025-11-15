import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { AlertCircle, Loader2, RefreshCcw, Trash2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ErrorDocument {
  id: string;
  doc_number: string;
  doc_key: string;
  doc_type: string;
  supplier_name: string;
  total_amount: number;
  currency: string;
  error_message: string;
  created_at: string;
}

export const ErrorLogsViewer = () => {
  const { activeOrganization } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [errors, setErrors] = useState<ErrorDocument[]>([]);
  const [errorCounts, setErrorCounts] = useState<Record<string, number>>({});

  // Real-time subscription
  useEffect(() => {
    if (!activeOrganization || !isOpen) return;

    const channel = supabase
      .channel('error_logs_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'processed_documents',
          filter: `organization_id=eq.${activeOrganization}`
        },
        (payload) => {
          console.log('Error logs: Document changed, refreshing...');
          fetchErrors();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeOrganization, isOpen]);

  const fetchErrors = async () => {
    if (!activeOrganization) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("processed_documents")
        .select("id, doc_number, doc_type, supplier_name, total_amount, currency, error_message, created_at, doc_key")
        .eq("organization_id", activeOrganization)
        .eq("status", "error")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      setErrors(data || []);
      
      // Count errors by type
      const counts: Record<string, number> = {};
      data?.forEach(doc => {
        if (doc.error_message) {
          const errorType = doc.error_message.split(':')[0].trim();
          counts[errorType] = (counts[errorType] || 0) + 1;
        }
      });
      setErrorCounts(counts);
      
      setIsOpen(true);
      toast.success(`${data?.length || 0} errores encontrados`);
    } catch (error) {
      console.error("Error fetching error logs:", error);
      toast.error("Error al cargar logs de errores");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCleanResolvedErrors = async () => {
    if (!activeOrganization) return;

    setIsCleaning(true);
    try {
      let cleanedCount = 0;

      // Para cada error, verificar si existe una versión exitosa
      for (const errorDoc of errors) {
        const { data: publishedDoc } = await supabase
          .from("processed_documents")
          .select("id")
          .eq("organization_id", activeOrganization)
          .eq("doc_key", errorDoc.doc_key)
          .eq("status", "published")
          .maybeSingle();

        // Si existe exitoso, eliminar el registro con error
        if (publishedDoc) {
          const { error: deleteError } = await supabase
            .from("processed_documents")
            .delete()
            .eq("id", errorDoc.id);

          if (!deleteError) {
            cleanedCount++;
          }
        }
      }

      if (cleanedCount > 0) {
        toast.success(`${cleanedCount} error(es) limpiado(s) correctamente`);
        fetchErrors(); // Refrescar lista
      } else {
        toast.info("No se encontraron errores corregidos para limpiar");
      }
    } catch (error) {
      console.error("Error cleaning resolved errors:", error);
      toast.error("Error al limpiar errores corregidos");
    } finally {
      setIsCleaning(false);
    }
  };

  const handleDeleteError = async (errorId: string, docNumber: string) => {
    try {
      const { error } = await supabase
        .from("processed_documents")
        .delete()
        .eq("id", errorId);

      if (error) throw error;

      toast.success(`Error ${docNumber} eliminado`);
      fetchErrors(); // Refrescar lista
    } catch (error) {
      console.error("Error deleting error log:", error);
      toast.error("Error al eliminar registro");
    }
  };

  return (
    <>
      <Button 
        onClick={fetchErrors}
        disabled={isLoading}
        variant="outline"
        className="w-full"
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <AlertCircle className="h-4 w-4 mr-2" />
        )}
        Ver Log de Errores
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-6xl max-h-[80vh]">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>Log de Errores de Publicación</DialogTitle>
                <DialogDescription>
                  {errors.length} documentos con errores encontrados
                </DialogDescription>
              </div>
              <Button
                onClick={handleCleanResolvedErrors}
                disabled={isCleaning || errors.length === 0}
                variant="outline"
                size="sm"
              >
                {isCleaning ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Limpiar Errores Corregidos
              </Button>
            </div>
          </DialogHeader>

          <div className="space-y-4">
            {/* Error summary */}
            <div className="flex flex-wrap gap-2">
              <div className="text-sm font-medium">Resumen de errores:</div>
              {Object.entries(errorCounts).map(([type, count]) => (
                <Badge key={type} variant="destructive">
                  {type}: {count}
                </Badge>
              ))}
            </div>

            {/* Errors table */}
            <ScrollArea className="h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Documento</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Proveedor</TableHead>
                    <TableHead>Monto</TableHead>
                    <TableHead>Error</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {errors.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell className="font-mono text-xs">
                        {doc.doc_number}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{doc.doc_type}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        {doc.supplier_name}
                      </TableCell>
                      <TableCell>
                        {new Intl.NumberFormat('es-CR', {
                          style: 'currency',
                          currency: doc.currency || 'CRC'
                        }).format(doc.total_amount)}
                      </TableCell>
                      <TableCell className="max-w-[300px]">
                        <div className="text-xs text-destructive break-words">
                          {doc.error_message}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {new Date(doc.created_at).toLocaleDateString('es-CR')}
                      </TableCell>
                      <TableCell>
                        <Button
                          onClick={() => handleDeleteError(doc.id, doc.doc_number)}
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
