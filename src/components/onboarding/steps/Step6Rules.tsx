import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  organizationId: string;
  initial?: any;
  onSaved: (data: any) => void;
  bindActions: (a: { onNext: () => any; disableNext?: boolean }) => void;
}

interface Rule { vendor_name: string; account_code: string; }

export default function Step6Rules({ organizationId, onSaved, bindActions }: Props) {
  const [rules, setRules] = useState<Rule[]>([{ vendor_name: "", account_code: "" }]);
  const [mode, setMode] = useState<"now" | "later">("later");

  useEffect(() => {
    bindActions({
      onNext: async () => {
        if (mode === "now") {
          const valid = rules.filter((r) => r.vendor_name.trim() && r.account_code.trim());
          if (valid.length) {
            const { data: { user } } = await supabase.auth.getUser();
            const { error } = await supabase.from("vendor_classification_rules").insert(
              valid.map((r) => ({ ...r, organization_id: organizationId, created_by: user?.id })),
            );
            if (error) return toast.error(error.message);
          }
          onSaved({ count: valid.length });
        } else {
          onSaved({ count: 0 });
        }
      },
    });
  }, [rules, mode, organizationId, onSaved, bindActions]);

  return (
    <div className="space-y-4">
      <p className="text-sm">¿Quieres agregar reglas de proveedores frecuentes? Esto automatiza la clasificación.</p>
      <div className="flex gap-2">
        <Button variant={mode === "later" ? "default" : "outline"} onClick={() => setMode("later")}>Agregar después</Button>
        <Button variant={mode === "now" ? "default" : "outline"} onClick={() => setMode("now")}>Agregar ahora</Button>
      </div>

      {mode === "now" && (
        <div className="space-y-3">
          {rules.slice(0, 5).map((r, i) => (
            <Card key={i} className="p-3 space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Nombre del proveedor</Label>
                  <Input value={r.vendor_name} onChange={(e) => setRules((p) => p.map((x, j) => j === i ? { ...x, vendor_name: e.target.value } : x))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Código de cuenta QBO</Label>
                  <Input value={r.account_code} onChange={(e) => setRules((p) => p.map((x, j) => j === i ? { ...x, account_code: e.target.value } : x))} />
                </div>
              </div>
              {rules.length > 1 && (
                <Button size="sm" variant="ghost" onClick={() => setRules((p) => p.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </Card>
          ))}
          {rules.length < 5 && (
            <Button size="sm" variant="outline" onClick={() => setRules((p) => [...p, { vendor_name: "", account_code: "" }])}>
              <Plus className="h-4 w-4 mr-1" /> Agregar regla
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
