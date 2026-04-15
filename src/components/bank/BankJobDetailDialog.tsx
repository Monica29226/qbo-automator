import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
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
import { useBankImports } from "@/hooks/useBankImports";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Props {
  jobId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BankJobDetailDialog({ jobId, open, onOpenChange }: Props) {
  const { getJobItems, jobs } = useBankImports();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const job = jobs.find((j: any) => j.id === jobId);

  useEffect(() => {
    if (jobId && open) {
      setLoading(true);
      getJobItems(jobId)
        .then(setItems)
        .catch(() => setItems([]))
        .finally(() => setLoading(false));
    }
  }, [jobId, open, getJobItems]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>
            Detalle de Importación
            {job && (
              <span className="text-sm font-normal text-muted-foreground ml-2">
                — {(job as any).bank_import_configs?.bank_name || ""}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {job?.error_message && (
          <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
            <strong>Error:</strong> {job.error_message}
            {job.error_details && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs">Detalles técnicos</summary>
                <pre className="text-xs mt-1 whitespace-pre-wrap">{job.error_details}</pre>
              </details>
            )}
          </div>
        )}

        <ScrollArea className="h-[500px]">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No hay items para este job
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Referencia</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="text-right">Ingreso</TableHead>
                  <TableHead className="text-right">Egreso</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-sm">
                      {new Date(item.transaction_date + "T00:00:00").toLocaleDateString("es-CR")}
                    </TableCell>
                    <TableCell className="text-sm">{item.reference || "—"}</TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate">
                      {item.description || "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {item.money_in > 0 ? item.money_in.toLocaleString("es-CR", { minimumFractionDigits: 2 }) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {item.money_out > 0 ? item.money_out.toLocaleString("es-CR", { minimumFractionDigits: 2 }) : "—"}
                    </TableCell>
                    <TableCell>
                      {item.status === "VALID" ? (
                        <Badge variant="outline" className="bg-green-50 text-green-700">Válida</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 text-red-700" title={item.validation_error}>
                          Error
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
