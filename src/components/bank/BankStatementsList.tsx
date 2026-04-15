import { useState } from "react";
import { useBankImports } from "@/hooks/useBankImports";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, RefreshCw, Eye, FileSpreadsheet } from "lucide-react";
import { BankJobDetailDialog } from "./BankJobDetailDialog";
import { Skeleton } from "@/components/ui/skeleton";

const statusColors: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  PROCESSING: "bg-blue-100 text-blue-800",
  PROCESSED: "bg-green-100 text-green-800",
  ERROR: "bg-red-100 text-red-800",
  DUPLICATE: "bg-gray-100 text-gray-800",
};

const statusLabels: Record<string, string> = {
  PENDING: "Pendiente",
  PROCESSING: "Procesando",
  PROCESSED: "Procesado",
  ERROR: "Error",
  DUPLICATE: "Duplicado",
};

export function BankStatementsList() {
  const { jobs, isLoading, generateCsv, reprocessJob, downloadCsv } = useBankImports();
  const [detailJobId, setDetailJobId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Importaciones</CardTitle></CardHeader>
        <CardContent>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full mb-2" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (jobs.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <FileSpreadsheet className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-medium mb-2">No hay importaciones</h3>
          <p className="text-muted-foreground text-sm">
            Sube un estado de cuenta para comenzar
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Importaciones ({jobs.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Banco</TableHead>
                <TableHead>Archivo</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Válidas</TableHead>
                <TableHead className="text-right">Errores</TableHead>
                <TableHead>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job: any) => (
                <TableRow key={job.id}>
                  <TableCell className="font-medium">
                    {(job as any).bank_import_configs?.bank_name || "—"}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm">
                    {job.onedrive_file_name || "Subida manual"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(job.created_at).toLocaleDateString("es-CR")}
                  </TableCell>
                  <TableCell>
                    <Badge className={statusColors[job.status] || ""} variant="outline">
                      {statusLabels[job.status] || job.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{job.valid_rows || 0}</TableCell>
                  <TableCell className="text-right">
                    {job.invalid_rows > 0 ? (
                      <span className="text-destructive font-medium">{job.invalid_rows}</span>
                    ) : (
                      "0"
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDetailJobId(job.id)}
                        title="Ver detalle"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {job.status === "PROCESSED" && !job.generated_csv_url && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => generateCsv.mutate(job.id)}
                          disabled={generateCsv.isPending}
                          title="Generar CSV para QBO"
                        >
                          <FileSpreadsheet className="h-4 w-4" />
                        </Button>
                      )}
                      {job.generated_csv_url && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => downloadCsv(job.generated_csv_url)}
                          title="Descargar CSV"
                        >
                          <Download className="h-4 w-4 text-green-600" />
                        </Button>
                      )}
                      {job.status === "ERROR" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => reprocessJob.mutate(job.id)}
                          disabled={reprocessJob.isPending}
                          title="Reprocesar"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <BankJobDetailDialog
        jobId={detailJobId}
        open={!!detailJobId}
        onOpenChange={(open) => !open && setDetailJobId(null)}
      />
    </>
  );
}
