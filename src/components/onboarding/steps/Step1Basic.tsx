import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { IdentificationInput } from "@/components/IdentificationInput";
import { validateIdentification } from "@/lib/identification-types";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  organizationId: string;
  initial?: any;
  onSaved: (data: any) => void;
  bindActions: (a: { onNext: () => Promise<void> | void; disableNext?: boolean }) => void;
}

const SECTORS = [
  "Servicios médicos",
  "Educación",
  "Comercio",
  "Construcción",
  "Servicios profesionales",
  "Otros",
];

export default function Step1Basic({ organizationId, initial, onSaved, bindActions }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [idType, setIdType] = useState(initial?.identification_type ?? "");
  const [idNumber, setIdNumber] = useState(initial?.identification_number ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [sector, setSector] = useState(initial?.sector ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("organizations")
        .select("name,identification_type,identification_number,email,sector")
        .eq("id", organizationId)
        .maybeSingle();
      if (data) {
        setName(data.name ?? "");
        setIdType(data.identification_type ?? "");
        setIdNumber(data.identification_number ?? "");
        setEmail(data.email ?? "");
        setSector((data as any).sector ?? "");
      }
    })();
  }, [organizationId]);

  useEffect(() => {
    bindActions({
      onNext: async () => {
        if (!name.trim()) return toast.error("Nombre obligatorio");
        const v = validateIdentification(idType, idNumber);
        if (!v.ok) return toast.error(v.error!);
        if (idType === "juridica" && !/^[234]/.test(v.cleaned))
          return toast.error("Cédula jurídica debe iniciar con 2, 3 o 4");
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          return toast.error("Email inválido");
        setSaving(true);
        const { error } = await supabase
          .from("organizations")
          .update({
            name,
            identification_type: idType,
            identification_number: v.cleaned,
            email: email || null,
            sector: sector || null,
          } as any)
          .eq("id", organizationId);
        setSaving(false);
        if (error) return toast.error(error.message);
        onSaved({ name, identification_type: idType, identification_number: v.cleaned, email, sector });
      },
      disableNext: saving,
    });
  }, [name, idType, idNumber, email, sector, saving, organizationId, onSaved, bindActions]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Nombre completo / Razón social *</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Empresa S.A." />
      </div>
      <IdentificationInput
        type={idType}
        number={idNumber}
        onTypeChange={setIdType}
        onNumberChange={setIdNumber}
        idPrefix="onb-id"
      />
      <div className="space-y-2">
        <Label>Email principal</Label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="empresa@ejemplo.cr" />
      </div>
      <div className="space-y-2">
        <Label>Sector (opcional)</Label>
        <Select value={sector} onValueChange={setSector}>
          <SelectTrigger><SelectValue placeholder="Selecciona un sector" /></SelectTrigger>
          <SelectContent>
            {SECTORS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>País</Label>
        <Input value="Costa Rica" disabled />
      </div>
    </div>
  );
}
