/**
 * Tipos de identificación oficiales de Costa Rica (Hacienda).
 * Fuente única de verdad para etiquetas, validación, longitudes y formato.
 */

export type IdentificationTypeKey = "fisica" | "juridica" | "dimex" | "nite";

export interface IdentificationTypeMeta {
  key: IdentificationTypeKey;
  label: string;
  shortLabel: string;
  /** Código oficial de Hacienda */
  haciendaCode: "01" | "02" | "03" | "04";
  /** Longitudes válidas (número de dígitos) */
  lengths: number[];
  placeholder: string;
  helper: string;
}

export const IDENTIFICATION_TYPES: Record<IdentificationTypeKey, IdentificationTypeMeta> = {
  fisica: {
    key: "fisica",
    label: "Cédula Física",
    shortLabel: "Física",
    haciendaCode: "01",
    lengths: [9],
    placeholder: "1-2345-6789",
    helper: "9 dígitos. Personas costarricenses.",
  },
  juridica: {
    key: "juridica",
    label: "Cédula Jurídica",
    shortLabel: "Jurídica",
    haciendaCode: "02",
    lengths: [10],
    placeholder: "3-101-123456",
    helper: "10 dígitos. Empresas y entidades.",
  },
  dimex: {
    key: "dimex",
    label: "DIMEX",
    shortLabel: "DIMEX",
    haciendaCode: "03",
    lengths: [11, 12],
    placeholder: "112345678901",
    helper: "11 o 12 dígitos. Documento de identidad para extranjeros residentes.",
  },
  nite: {
    key: "nite",
    label: "NITE",
    shortLabel: "NITE",
    haciendaCode: "04",
    lengths: [10],
    placeholder: "1234567890",
    helper: "10 dígitos. Número de identificación tributario especial.",
  },
};

export const IDENTIFICATION_TYPE_LIST = Object.values(IDENTIFICATION_TYPES);

/** Limpia guiones, espacios y caracteres no numéricos */
export function cleanIdentification(value: string): string {
  return (value || "").replace(/[^\d]/g, "");
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  cleaned: string;
}

export function validateIdentification(
  type: IdentificationTypeKey | string | null | undefined,
  value: string,
): ValidationResult {
  const cleaned = cleanIdentification(value);
  if (!type) return { ok: false, error: "Selecciona un tipo de identificación", cleaned };
  const meta = IDENTIFICATION_TYPES[type as IdentificationTypeKey];
  if (!meta) return { ok: false, error: "Tipo de identificación no válido", cleaned };
  if (!cleaned) return { ok: false, error: "Ingresa el número de identificación", cleaned };
  if (!meta.lengths.includes(cleaned.length)) {
    const expected = meta.lengths.join(" o ");
    return {
      ok: false,
      error: `${meta.label} debe tener ${expected} dígitos (tiene ${cleaned.length}).`,
      cleaned,
    };
  }
  return { ok: true, cleaned };
}

/** Formato visual con guiones según tipo */
export function formatIdentification(
  type: IdentificationTypeKey | string | null | undefined,
  value: string,
): string {
  const cleaned = cleanIdentification(value);
  if (!cleaned) return "";
  switch (type) {
    case "fisica":
      // 1-2345-6789
      if (cleaned.length === 9) return `${cleaned[0]}-${cleaned.slice(1, 5)}-${cleaned.slice(5)}`;
      return cleaned;
    case "juridica":
      // 3-101-123456
      if (cleaned.length === 10) return `${cleaned[0]}-${cleaned.slice(1, 4)}-${cleaned.slice(4)}`;
      return cleaned;
    default:
      return cleaned;
  }
}

export function getIdentificationMeta(
  type: IdentificationTypeKey | string | null | undefined,
): IdentificationTypeMeta | null {
  if (!type) return null;
  return IDENTIFICATION_TYPES[type as IdentificationTypeKey] ?? null;
}

export function getIdentificationLabel(
  type: IdentificationTypeKey | string | null | undefined,
): string {
  return getIdentificationMeta(type)?.label ?? "Identificación";
}
