import { useState, useEffect, useMemo } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Send, RefreshCw } from "lucide-react";
import { useBankImports } from "@/hooks/useBankImports";
import { useQBOAccounts } from "@/hooks/useQBOAccounts";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Props {
  jobId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CATEGORIZABLE_TYPES = new Set([
  "Expense",
  "Income",
  "Other Income",
  "Other Expense",
  "Cost of Goods Sold",
]);

export function BankJobDetailDialog({ jobId, open, onOpenChange }: Props) {
  const { getJobItems, jobs, publishJob, updateItemCategory } = useBankImports();
  const { accounts: qboAccounts } = useQBOAccounts();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const job = jobs.find((j: any) => j.id === jobId);
  const categoryAccounts = useMemo(
    () => qboAccounts.filter((a: any) => CATEGORIZABLE_TYPES.has(a.type)),
    [qboAccounts]
  );

  const reload = () => {
    if (!jobId) return;
    setLoading(true);
    getJobItems(jobId)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (jobId && open) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, open]);

  const handleCategoryChange = async (itemId: string, accountId: string) => {
    const account = categoryAccounts.find((a: any) => a.id === accountId);
    await updateItemCategory.mutateAsync({
      itemId,
      categoryAccountId: accountId,
      categoryAccountName: account?.name || "",
    });
    setItems((prev) =>
      prev.map((it) =>
        it.id === itemId ? { ...it, category_account_id: accountId, category_account_name: account?.name } : it
      )
    );
  };

  const pendingCount = items.filter(
    (it) => (it.status === "VALID" || it.status === "PUBLISH_ERROR") && !it.qbo_entity_id
  ).length;

  const handlePublish = async () => {
    if (!jobId) return;
    await publishJob.mutateAsync({ jobId });
    reload();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between pr-8">
            <span>
              Detalle de Importación
              {job && (
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  — {(job as any).bank_import_configs?.bank_name || ""}
                </span>
              )}
            </span>
            <Button
              size="sm"
              onClick={handlePublish}
              disabled={publishJob.isPending || pendingCount === 0}
            >
              {publishJob.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Publicar a QuickBooks {pendingCount > 0 ? `(${pendingCount})` : ""}
            </Button>
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
                  <TableHead className="min-w-[180px]">Cuenta contable</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item: any) => {
                  const isPublished = item.status === "PUBLISHED" && !!item.qbo_entity_id;
                  const canCategorize = item.status === "VALID" || item.status === "PUBLISH_ERROR";
                  return (
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
                        {isPublished ? (
                          <span className="text-xs text-muted-foreground">{item.category_account_name || "—"}</span>
                        ) : canCategorize ? (
                          <Select
                            value={item.category_account_id || ""}
                            onValueChange={(v) => handleCategoryChange(item.id, v)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Sin categorizar" />
                            </SelectTrigger>
                            <SelectContent>
                              {categoryAccounts.map((a: any) => (
                                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {isPublished ? (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700">
                            Publicada ({item.qbo_entity_type})
                          </Badge>
                        ) : item.status === "PUBLISH_ERROR" ? (
                          <Badge variant="outline" className="bg-red-50 text-red-700" title={item.publish_error}>
                            Error al publicar
                          </Badge>
                        ) : item.status === "VALID" ? (
                          <Badge variant="outline" className="bg-green-50 text-green-700">Válida</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-red-50 text-red-700" title={item.validation_error}>
                            Error
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
