import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetOrgId: string;
  onReplicated?: (report: Record<string, number>) => void;
}

export function ReplicateConfigDialog({ open, onOpenChange, targetOrgId, onReplicated }: Props) {
  const [orgs, setOrgs] = useState<Array<{ id: string; name: string }>>([]);
  const [sourceId, setSourceId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase
        .from("organizations")
        .select("id, name")
        .eq("is_active", true)
        .neq("id", targetOrgId)
        .order("name");
      setOrgs(data || []);
    })();
  }, [open, targetOrgId]);

  const run = async () => {
    if (!sourceId) return toast.error("Selecciona una empresa de origen");
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("replicate-org-config", {
        body: { source_org_id: sourceId, target_org_id: targetOrgId, confirm: true },
      });
      if (error) throw error;
      const r = data?.report || {};
      toast.success(
        `Copiado: ${r.vendor_defaults_copied ?? 0} proveedores, ${r.legacy_mappings_copied ?? 0} mapeos, ${r.iva_settings_copied ?? 0} ajustes IVA.`
      );
      onReplicated?.(r);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "Error replicando configuración");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Replicar configuración desde otra empresa</DialogTitle>
          <DialogDescription>
            Copia reglas de proveedores, mapeo de cuentas legacy y ajustes de IVA. No copia integraciones ni facturas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger><SelectValue placeholder="Empresa de origen" /></SelectTrigger>
            <SelectContent>
              {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={run} disabled={busy || !sourceId}>
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Copy className="h-4 w-4 mr-1" />}
            Replicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
