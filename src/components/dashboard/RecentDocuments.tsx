import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, ExternalLink } from "lucide-react";

const documents = [
  {
    id: "1",
    number: "FAC-2024-001234",
    vendor: "Proveedor Ejemplo S.A.",
    date: "2024-11-03",
    amount: "₡125,450.00",
    status: "processed",
    qboId: "Bill-789",
  },
  {
    id: "2",
    number: "NC-2024-005678",
    vendor: "Distribuidora XYZ Ltda",
    date: "2024-11-03",
    amount: "-₡15,200.00",
    status: "processed",
    qboId: "VCredit-456",
  },
  {
    id: "3",
    number: "FAC-2024-001235",
    vendor: "Servicios ABC S.A.",
    date: "2024-11-03",
    amount: "₡89,750.00",
    status: "review",
    qboId: null,
  },
  {
    id: "4",
    number: "FAC-2024-001236",
    vendor: "Suministros DEF",
    date: "2024-11-02",
    amount: "₡234,890.00",
    status: "pending",
    qboId: null,
  },
];

const statusConfig = {
  processed: { label: "Procesada", variant: "default" as const, color: "text-success" },
  review: { label: "En Revisión", variant: "secondary" as const, color: "text-warning" },
  pending: { label: "Pendiente", variant: "outline" as const, color: "text-muted-foreground" },
};

export const RecentDocuments = () => {
  return (
    <div className="space-y-3">
      {documents.map((doc) => (
        <div
          key={doc.id}
          className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
        >
          <div className="flex items-center gap-4 flex-1">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="font-semibold text-sm text-foreground">{doc.number}</p>
                {doc.qboId && (
                  <Badge variant="outline" className="text-xs">
                    {doc.qboId}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground truncate">{doc.vendor}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="font-semibold text-sm text-foreground">{doc.amount}</p>
              <p className="text-xs text-muted-foreground">{doc.date}</p>
            </div>
            <Badge variant={statusConfig[doc.status].variant} className="min-w-[100px] justify-center">
              {statusConfig[doc.status].label}
            </Badge>
            {doc.qboId && (
              <Button variant="ghost" size="sm">
                <ExternalLink className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};
