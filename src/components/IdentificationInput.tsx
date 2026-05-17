import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  IDENTIFICATION_TYPE_LIST,
  IdentificationTypeKey,
  getIdentificationMeta,
  validateIdentification,
} from "@/lib/identification-types";
import { cn } from "@/lib/utils";

interface IdentificationInputProps {
  type: string;
  number: string;
  onTypeChange: (type: IdentificationTypeKey) => void;
  onNumberChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  showError?: boolean;
  className?: string;
  idPrefix?: string;
}

export function IdentificationInput({
  type,
  number,
  onTypeChange,
  onNumberChange,
  disabled,
  required,
  showError = true,
  className,
  idPrefix = "id",
}: IdentificationInputProps) {
  const meta = getIdentificationMeta(type);
  const validation =
    showError && (number || required)
      ? validateIdentification(type, number)
      : null;
  const errorMsg = validation && !validation.ok && (number || required) ? validation.error : null;

  return (
    <div className={cn("grid gap-4 sm:grid-cols-2", className)}>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-type`}>
          Tipo de identificación{required ? " *" : ""}
        </Label>
        <Select
          value={type || ""}
          onValueChange={(v) => onTypeChange(v as IdentificationTypeKey)}
          disabled={disabled}
        >
          <SelectTrigger id={`${idPrefix}-type`}>
            <SelectValue placeholder="Seleccionar tipo" />
          </SelectTrigger>
          <SelectContent>
            {IDENTIFICATION_TYPE_LIST.map((t) => (
              <SelectItem key={t.key} value={t.key}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-number`}>
          Número{required ? " *" : ""}
        </Label>
        <Input
          id={`${idPrefix}-number`}
          placeholder={meta?.placeholder ?? "Selecciona tipo primero"}
          value={number}
          onChange={(e) => onNumberChange(e.target.value)}
          disabled={disabled || !type}
          inputMode="numeric"
          aria-invalid={!!errorMsg}
        />
        {meta && !errorMsg && (
          <p className="text-xs text-muted-foreground">{meta.helper}</p>
        )}
        {errorMsg && (
          <p className="text-xs text-destructive">{errorMsg}</p>
        )}
      </div>
    </div>
  );
}
