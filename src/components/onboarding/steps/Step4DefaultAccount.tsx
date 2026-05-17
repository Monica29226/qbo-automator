import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  organizationId: string;
  initial?: any;
  onSaved: (data: any) => void;
  bindActions: (a: { onNext: () => any; disableNext?: boolean }) => void;
}

export default function Step4DefaultAccount({ organizationId, onSaved, bindActions }: Props) {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>("");
  const [suggested, setSuggested] = useState<any | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke("verify-qbo-readiness", {
        body: { organization_id: organizationId },
      });
      if (error || !data?.connected) {
        setLoading(false);
        return;
      }
      setAccounts(data.accounts?.list ?? []);
      setSuggested(data.accounts?.suggestedDefault ?? null);
      const { data: org } = await supabase.from("organizations").select("default_account_ref").eq("id", organizationId).maybeSingle();
      setSelected((org as any)?.default_account_ref ?? data.accounts?.suggestedDefault?.id ?? "");
      setLoading(false);
    })();
  }, [organizationId]);

  useEffect(() => {
    bindActions({
      onNext: async () => {
        if (selected) {
          const { error } = await supabase.from("organizations").update({ default_account_ref: selected } as any).eq("id", organizationId);
          if (error) return toast.error(error.message);
        }
        onSaved({ default_account_ref: selected });
      },
    });
  }, [selected, organizationId, onSaved, bindActions]);

  if (loading) return <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Cargando cuentas…</div>;

  if (accounts.length === 0) {
    return <Alert><AlertDescription>QuickBooks no está conectado o no se obtuvieron cuentas. Puedes saltar este paso.</AlertDescription></Alert>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm">Cuando llegue una factura sin clasificar, ¿a qué cuenta contable la asignamos por defecto?</p>
      {suggested && <Alert><AlertDescription>Sugerencia: <strong>{suggested.name}</strong></AlertDescription></Alert>}
      <div className="space-y-2">
        <Label>Cuenta default</Label>
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger><SelectValue placeholder="Selecciona una cuenta" /></SelectTrigger>
          <SelectContent className="max-h-72">
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name} <span className="text-xs text-muted-foreground ml-2">({a.type})</span></SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
