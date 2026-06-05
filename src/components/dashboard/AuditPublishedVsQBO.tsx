import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Loader2, RefreshCw, ShieldCheck, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Orphan {
  id: string;
  doc_number: string;
  doc_key: string;
  supplier_name: string;
  issue_date: string;
  total_amount: number;
  currency: string;
  qbo_entity_id: string;
  qbo_entity_type: string | null;
  reason: string;
}

interface AmountMismatch extends Orphan {
  xml_total: number;
  qbo_total: number;
  total_diff: number;
  xml_tax: number;
  qbo_tax: number;
  tax_diff: number;
}

export const AuditPublishedVsQBO = () => {
  const { activeOrganization } = useAuth();
  const [auditing, setAuditing] = useState(false);
  const [republishing, setRepublishing] = useState(false);
  const [orphans, setOrphans] = useState<Orphan[]>([]);
  const [mismatches, setMismatches] = useState<AmountMismatch[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ checked: number; total: number } | null>(null);
  const [ran, setRan] = useState(false);
  const [quickQuery, setQuickQuery] = useState("");
  const [quickRepublishing, setQuickRepublishing] = useState(false);

  const republishByNumber = async () => {
    const q = quickQuery.trim();
    if (!activeOrganization || !q) return;
    setQuickRepublishing(true);
    try {
      const { data: docs, error: findErr } = await supabase
        .from("processed_documents")
        .select("id, doc_number, doc_key, supplier_name, status, qbo_entity_id")
        .eq("organization_id", activeOrganization)
        .or(`doc_number.eq.${q},doc_key.eq.${q}`)
        .limit(5);
      if (findErr) throw findErr;
      if (!docs || docs.length === 0) {
        toast.error("No se encontró ninguna factura con ese número/clave en esta organización");
        return;
      }
      if (docs.length > 1) {
        toast.error(`Se encontraron ${docs.length} coincidencias; usa la clave completa para precisar`);
        return;
      }
      const doc = docs[0];
      const { data, error } = await supabase.functions.invoke("republish-deleted-from-qbo", {
        body: { organization_id: activeOrganization, document_ids: [doc.id] },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Error al republicar");
      const published = data?.publish_result?.published ?? 1;
      const errors = data?.publish_result?.errors?.length ?? 0;
      if (errors > 0) {
        toast.warning(`Encolada con avisos. Publicadas: ${published}, errores: ${errors}`);
      } else {
        toast.success(`✅ ${doc.supplier_name} ${doc.doc_number} republicada`);
      }
      setQuickQuery("");
      setOrphans((prev) => prev.filter((o) => o.id !== doc.id));
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
    } finally {
      setQuickRepublishing(false);
    }
  };

  const runAudit = async () => {
    if (!activeOrganization) {
      toast.error("Selecciona una organización");
      return;
    }
    setAuditing(true);
    setOrphans([]);
    setSelected(new Set());
    setProgress({ checked: 0, total: 0 });

    try {
      let offset = 0;
      let allOrphans: Orphan[] = [];
      let total = 0;
      // Safety cap to avoid infinite loops
      for (let i = 0; i < 50; i++) {
        const { data, error } = await supabase.functions.invoke("audit-qbo-published-vs-actual", {
          body: { organization_id: activeOrganization, offset, limit: 200 },
        });
        if (error) throw error;
        if (!data?.success) {
          if (data?.token_expired) {
            toast.error("Token de QuickBooks expirado. Reconecta la integración.");
            return;
          }
          throw new Error(data?.error || "Error de auditoría");
        }
        total = data.total ?? 0;
        allOrphans = allOrphans.concat(data.orphans || []);
        offset = data.next_offset ?? (offset + (data.checked_in_page || 0));
        setProgress({ checked: offset, total });
        setOrphans([...allOrphans]);
        if (!data.has_more) break;
      }
      setRan(true);
      toast.success(`Auditoría completa: ${allOrphans.length} huérfanas de ${total} publicadas`);
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
    } finally {
      setAuditing(false);
    }
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === orphans.length) setSelected(new Set());
    else setSelected(new Set(orphans.map((o) => o.id)));
  };

  const republish = async () => {
    if (!activeOrganization || selected.size === 0) return;
    setRepublishing(true);
    try {
      const ids = Array.from(selected);
      const { data, error } = await supabase.functions.invoke("republish-deleted-from-qbo", {
        body: { organization_id: activeOrganization, document_ids: ids },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Error al republicar");

      const published = data?.publish_result?.published ?? ids.length;
      const errors = data?.publish_result?.errors?.length ?? 0;
      if (errors > 0) {
        toast.warning(`Republicadas: ${published}, errores: ${errors}`);
      } else {
        toast.success(`✅ ${published} facturas republicadas en QuickBooks`);
      }
      // Remove republished from list
      setOrphans((prev) => prev.filter((o) => !selected.has(o.id)));
      setSelected(new Set());
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
    } finally {
      setRepublishing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Auditar publicadas vs QuickBooks
        </CardTitle>
        <CardDescription>
          Detecta facturas marcadas como publicadas en el sistema pero borradas o inexistentes en QuickBooks, y permite republicarlas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-3 border rounded space-y-2 bg-muted/30">
          <div className="text-sm font-medium">Republicar una factura específica</div>
          <div className="text-xs text-muted-foreground">
            Pega el número de documento (20 dígitos) o la clave electrónica (50 dígitos) si ya sabes que fue borrada de QuickBooks.
          </div>
          <div className="flex items-center gap-2">
            <Input
              placeholder="00100001010000000828 o clave 50…"
              value={quickQuery}
              onChange={(e) => setQuickQuery(e.target.value)}
              disabled={quickRepublishing}
              className="font-mono text-xs"
            />
            <Button
              onClick={republishByNumber}
              disabled={quickRepublishing || !quickQuery.trim() || !activeOrganization}
              size="sm"
            >
              {quickRepublishing ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Republicando…</>
              ) : (
                <><Send className="h-4 w-4 mr-2" /> Republicar</>
              )}
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={runAudit} disabled={auditing || !activeOrganization}>
            {auditing ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Auditando…</>
            ) : (
              <><RefreshCw className="h-4 w-4 mr-2" /> Iniciar auditoría</>
            )}
          </Button>
          {progress && (
            <span className="text-sm text-muted-foreground">
              Verificadas {progress.checked} / {progress.total}
            </span>
          )}
        </div>


        {ran && orphans.length === 0 && !auditing && (
          <div className="text-sm text-muted-foreground flex items-center gap-2 p-3 bg-muted rounded">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Todas las facturas publicadas existen en QuickBooks.
          </div>
        )}

        {orphans.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <span className="text-sm font-medium">
                  {orphans.length} factura(s) borradas o inexistentes en QBO
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={toggleAll}>
                  {selected.size === orphans.length ? "Deseleccionar todo" : "Seleccionar todo"}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" disabled={selected.size === 0 || republishing}>
                      {republishing ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Republicando…</>
                      ) : (
                        <>Republicar {selected.size} seleccionada(s)</>
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Confirmar republicación</AlertDialogTitle>
                      <AlertDialogDescription>
                        Se limpiará el rastro de QuickBooks y se publicarán nuevamente {selected.size} factura(s).
                        Esta acción es irreversible y creará nuevos Bills en QuickBooks.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={republish}>Republicar</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>

            <div className="border rounded max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr className="text-left">
                    <th className="p-2 w-10"></th>
                    <th className="p-2">Fecha</th>
                    <th className="p-2">Proveedor</th>
                    <th className="p-2">Número</th>
                    <th className="p-2 text-right">Monto</th>
                    <th className="p-2">QBO ID</th>
                    <th className="p-2">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {orphans.map((o) => (
                    <tr key={o.id} className="border-t hover:bg-muted/50">
                      <td className="p-2">
                        <Checkbox
                          checked={selected.has(o.id)}
                          onCheckedChange={() => toggle(o.id)}
                        />
                      </td>
                      <td className="p-2 whitespace-nowrap">{o.issue_date}</td>
                      <td className="p-2">{o.supplier_name}</td>
                      <td className="p-2 font-mono text-xs">{o.doc_number}</td>
                      <td className="p-2 text-right whitespace-nowrap">
                        {o.currency} {Number(o.total_amount).toLocaleString()}
                      </td>
                      <td className="p-2 font-mono text-xs">{o.qbo_entity_id}</td>
                      <td className="p-2">
                        <Badge variant="outline" className="text-xs">{o.reason}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
