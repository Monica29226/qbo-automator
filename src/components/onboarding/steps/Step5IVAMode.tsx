import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  organizationId: string;
  initial?: any;
  onSaved: (data: any) => void;
  bindActions: (a: { onNext: () => Promise<void> | void; disableNext?: boolean }) => void;
}

export default function Step5IVAMode({ organizationId, onSaved, bindActions }: Props) {
  const [mode, setMode] = useState<"recoverable" | "expense">("recoverable");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("system_settings").select("value").eq("organization_id", organizationId).eq("key", "default_uses_tax").maybeSingle();
      if (data?.value === "false") setMode("expense");
    })();
  }, [organizationId]);

  useEffect(() => {
    bindActions({
      onNext: async () => {
        await (supabase as any).from("system_settings").upsert(
          {
            organization_id: organizationId,
            key: "default_uses_tax",
            value: mode === "recoverable" ? "true" : "false",
            description: "Modo de IVA: true=recuperable, false=gasto",
          },
          { onConflict: "organization_id,key" },
        );
        onSaved({ mode });
      },
    });
  }, [mode, organizationId, onSaved, bindActions]);

  return (
    <div className="space-y-4">
      <p className="text-sm">¿Cómo manejas el IVA en esta empresa?</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[
          { k: "recoverable", t: "IVA Recuperable", d: "El IVA pagado se registra como impuesto separado y se acredita contra el IVA cobrado. Aplica para la mayoría de empresas." },
          { k: "expense", t: "IVA como Gasto", d: "El IVA pagado se incluye en el monto del gasto. Aplica para empresas sin actividades gravadas, escuelas, ONGs, etc." },
        ].map((o) => (
          <Card
            key={o.k}
            className={`p-4 cursor-pointer border-2 transition ${mode === o.k ? "border-primary" : "border-muted"}`}
            onClick={() => setMode(o.k as any)}
          >
            <div className="flex items-center justify-between">
              <h4 className="font-semibold">{o.t}</h4>
              {mode === o.k && <CheckCircle2 className="h-5 w-5 text-primary" />}
            </div>
            <p className="text-sm text-muted-foreground mt-2">{o.d}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
