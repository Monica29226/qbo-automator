import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { FileSearch, Loader2 } from "lucide-react";
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

interface QBOAccount {
  id: string;
  name: string;
  accountNumber: string | null;
  type: string;
  active: boolean;
}

export const QBOAccountsDiagnostic = () => {
  const { activeOrganization } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [accounts, setAccounts] = useState<QBOAccount[]>([]);
  const [byType, setByType] = useState<Record<string, QBOAccount[]>>({});
  const [selectedType, setSelectedType] = useState<string | null>(null);

  const fetchAccounts = async () => {
    if (!activeOrganization) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("list-quickbooks-accounts", {
        body: { organization_id: activeOrganization },
      });

      if (error) throw error;

      if (data.success) {
        setAccounts(data.accounts);
        setByType(data.byType);
        setIsOpen(true);
        toast.success(`✓ ${data.total} cuentas encontradas en QuickBooks`);
      } else {
        toast.error("No se pudieron cargar las cuentas");
      }
    } catch (error) {
      console.error("Error fetching QBO accounts:", error);
      toast.error("Error al consultar cuentas de QuickBooks");
    } finally {
      setIsLoading(false);
    }
  };

  const displayedAccounts = selectedType ? byType[selectedType] : accounts;

  return (
    <>
      <Button 
        onClick={fetchAccounts}
        disabled={isLoading}
        variant="outline"
        className="w-full"
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <FileSearch className="h-4 w-4 mr-2" />
        )}
        Diagnóstico de Cuentas QuickBooks
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-5xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Cuentas de QuickBooks</DialogTitle>
            <DialogDescription>
              Total: {accounts.length} cuentas encontradas
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Filter by type */}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={selectedType === null ? "default" : "outline"}
                onClick={() => setSelectedType(null)}
              >
                Todas ({accounts.length})
              </Button>
              {Object.entries(byType).map(([type, accs]) => (
                <Button
                  key={type}
                  size="sm"
                  variant={selectedType === type ? "default" : "outline"}
                  onClick={() => setSelectedType(type)}
                >
                  {type} ({accs.length})
                </Button>
              ))}
            </div>

            {/* Accounts table */}
            <ScrollArea className="h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedAccounts.map((acc) => (
                    <TableRow key={acc.id}>
                      <TableCell className="font-mono">
                        {acc.accountNumber || <span className="text-muted-foreground">Sin código</span>}
                      </TableCell>
                      <TableCell>{acc.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{acc.type}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={acc.active ? "default" : "secondary"}>
                          {acc.active ? "Activa" : "Inactiva"}
                        </Badge>
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
