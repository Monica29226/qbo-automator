## Objetivo

Auditar las facturas de **Tree of Life** publicadas en QuickBooks para detectar dos problemas concretos:

1. Facturas donde el IVA se separó como impuesto en QBO en vez de ir al gasto (la organización tiene `default_uses_tax = false`, así que TODO el IVA debe incluirse en el gasto).
2. Facturas donde el monto total en QBO no coincide con el `TotalComprobante` del XML.

## Hallazgos previos relevantes

- Config actual de Tree of Life: `default_uses_tax = false` → todo el IVA debe ir al gasto.
- Ya existe la edge function `reconcile-xml-vs-qbo` que compara XML vs QBO campo por campo (Total, Impuesto, Subtotal, Modo Impuesto, Fecha, Moneda, Líneas) — pero está pensada para reconciliación general, no para detectar específicamente "IVA mal separado cuando debería ser gasto".

## Plan

### 1. Nueva página de auditoría "Auditoría Tree of Life / IVA como Gasto"

Ruta: `/audit/iva-mode` (o reutilizar `/audit-report`). Filtra por organización activa y rango de fechas (por defecto últimos 30 días).

La página llama a una nueva edge function `audit-iva-mode-vs-qbo` que para cada factura `published` de Tree of Life:

- Lee el XML (`xml_data` / `extracted_data`) y obtiene `TotalComprobante`, `TotalImpuesto`.
- Consulta el Bill correspondiente en QBO (`qbo_entity_id`).
- Compara y clasifica cada factura en una de estas categorías:

  | Estado | Criterio |
  |---|---|
  | ✅ OK | `GlobalTaxCalculation = NotApplicable` (o `TaxExcluded` con Tax = 0), líneas suman = TotalComprobante XML, sin impuesto separado |
  | ⚠️ IVA separado | QBO tiene `TxnTaxDetail.TotalTax > 0` o `GlobalTaxCalculation = TaxExcluded` con tax ≠ 0 — viola la regla "IVA al gasto" |
  | ❌ Total no cuadra | `Bill.TotalAmt` difiere de `TotalComprobante` del XML en más de ₡1 |
  | 🔴 Error | No se puede leer el Bill o el XML |

### 2. UI de resultados

Tabla con: fecha, proveedor, nº factura, total XML, total QBO, IVA XML, IVA QBO, modo QBO, estado, link al PDF y link al Bill en QBO.

Botones por fila:
- **Republicar al gasto** — borra el Bill en QBO y lo vuelve a crear con el IVA incluido en el subtotal (usa el flujo existente `republish-from-extracted-data` con `uses_tax=false` forzado).
- **Ver detalle** — abre modal con el desglose de líneas XML vs líneas QBO.

Botón global: **Republicar todas las marcadas** (procesa en background, 1 a la vez para no saturar QBO).

### 3. Reporte exportable

Botón "Descargar CSV" con todas las filas y su clasificación, para que puedas revisarlo offline.

## Detalles técnicos

- Edge function nueva: `supabase/functions/audit-iva-mode-vs-qbo/index.ts` — basada en `reconcile-xml-vs-qbo` pero con la lógica de clasificación específica de IVA-como-gasto.
- Reutiliza `publish-to-quickbooks` para republicación (ya respeta `default_uses_tax = false`).
- Nuevo componente `src/pages/AuditIvaMode.tsx` + ruta en `App.tsx`.
- No requiere cambios de schema.

## Lo que NO incluye este plan

- No cambia la configuración de Tree of Life (ya está correcta en BD).
- No modifica la lógica de publicación — solo detecta y permite republicar las que ya salieron mal.

¿Apruebas? Si quieres, primero puedo correr la auditoría una sola vez como reporte rápido (sin construir UI) para confirmar cuántas facturas están afectadas antes de invertir en la página completa.
