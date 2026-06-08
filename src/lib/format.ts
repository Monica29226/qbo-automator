// Formatos centralizados ACL — colones tabular, fechas CR.

const crcFormatter = new Intl.NumberFormat("es-CR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const crcFormatterCompact = new Intl.NumberFormat("es-CR", {
  notation: "compact",
  maximumFractionDigits: 2,
});

export function formatCRC(amount: number | null | undefined): string {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n)) return "₡0";
  return `₡${crcFormatter.format(n)}`;
}

export function formatCRCCompact(amount: number | null | undefined): string {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n)) return "₡0";
  return `₡${crcFormatterCompact.format(n)}`;
}

export const tabularNums = "tabular-nums [font-variant-numeric:tabular-nums]";
