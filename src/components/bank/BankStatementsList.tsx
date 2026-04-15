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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, RefreshCw, Eye, FileSpreadsheet } from "lucide-react";
import { BankJobDetailDialog } from "./BankJobDetailDialog";
import { Skeleton } from "@/components/ui/skeleton";

const statusColors: Record<string, string> = {
  PENDING: "bg-warning/20 text-warning-foreground border-warning/30",
  PROCESSING: "bg-primary/20 text-primary border-primary/30",
  PROCESSED: "bg-accent/20 text-accent-foreground border-accent/30",
  ERROR: "bg-destructive/20 text-destructive border-destructive/30",
  DUPLICATE: "bg-muted text-muted-foreground border-muted-foreground/30",
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
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const filteredJobs = statusFilter === "ALL"
    ? jobs
    : jobs.filter((j: any) => j.status === statusFilter);

  // Stats
  const statusCounts = jobs.reduce((acc: Record<string, number>, j: any) => {
    acc[j.status] = (acc[j.status] || 0) + 1;
    return acc;
  }, {});

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
          <div className="flex items-center justify-between">
            <CardTitle>Importaciones ({filteredJobs.length})</CardTitle>
            <div className="flex items-center gap-2">
              {/* Status summary badges */}
              <div className="flex gap-1 mr-3">
                {Object.entries(statusCounts).map(([status, count]) => (
                  <Badge
                    key={status}
                    variant="outline"
                    className={`${statusColors[status] || ""} cursor-pointer text-xs`}
                    onClick={() => setStatusFilter(statusFilter === status ? "ALL" : status)}
                  >
                    {statusLabels[status] || status}: {count}
                  </Badge>
                ))}
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Filtrar estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  <SelectItem value="PENDING">Pendiente</SelectItem>
                  <SelectItem value="PROCESSING">Procesando</SelectItem>
                  <SelectItem value="PROCESSED">Procesado</SelectItem>
                  <SelectItem value="ERROR">Error</SelectItem>
                  <SelectItem value="DUPLICATE">Duplicado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
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
              {filteredJobs.map((job: any) => (
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
