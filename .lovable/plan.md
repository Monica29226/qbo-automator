# Bug: facturas de Tree of Life rechazadas con error QBO 6000

## Causa raíz

Tree of Life está configurada como:
- `system_settings.default_uses_tax = false` → IVA al gasto
- `organizations.settings.tax_handling = 'included_in_line_items'` → IVA dentro de cada línea

Eso activa `includeTaxInLines = true` en `publish-to-quickbooks/index.ts`, así que cada línea se envía con `Amount = subtotal + IVA`. **Pero el código sigue asignándole a esa línea el `TaxCodeRef` de la tarifa real (13%, 4%, 1%…)** y el payload del Bill se manda con `GlobalTaxCalculation: "TaxExcluded"` y sin `TxnTaxDetail` (porque `effectiveUsesTax = false`).

Para QBO eso significa: "estas líneas tienen una tasa impositiva 13%, pero no me das el detalle de impuesto" → QBO intenta recalcular tax sobre líneas que ya tienen el IVA incluido, lo que dispara dos problemas:

1. **Error 6000 — "Todos los artículos necesitan una tasa impositiva. Agregue uno donde falta."**
   Si alguna línea tiene `tasaImpuesto = 0` y `getTaxCodeRef(0)` no encuentra un código exento en QBO, la línea se queda **sin** `TaxCodeRef`. Con la cuenta de QBO en modo Automated Sales Tax, QBO rechaza el Bill completo porque exige tax code en todas las líneas.

2. **Cuando sí publica, el total infla el IVA dos veces**
   Líneas con IVA incluido + `TaxCodeRef = 13%` + `TaxExcluded` → QBO calcula tax aparte sobre el subtotal de la línea y lo suma al total. Por eso ves facturas donde "el monto no es el correcto" y "está sumando el impuesto que debería ir al gasto".

Esta combinación nunca debió quedar así: en modo "IVA como gasto" las líneas deben llevar **TaxCodeRef exento/NON** (no la tarifa real) y el Bill debe ir con `GlobalTaxCalculation: "NotApplicable"` sin `TxnTaxDetail`.

## Plan de cambios

### 1. `supabase/functions/publish-to-quickbooks/index.ts` — modo "IVA como gasto"

Cuando `includeTaxInLines === true` (o más en general, cuando `effectiveUsesTax === false` porque el IVA va al gasto):

- **Forzar `TaxCodeRef` exento en cada línea**: llamar siempre a `getTaxCodeRef(0)` en vez de `getTaxCodeRef(tasaImpuesto)`. La línea ya lleva IVA dentro de `Amount`, no debe declarar tarifa.
- **Si no existe ningún código exento** en QBO: registrar el documento como `pending_config` con un mensaje claro ("Falta TaxCode exento/NON/Out of Scope en QuickBooks para publicar con IVA al gasto"), en vez de mandar la línea sin `TaxCodeRef` y reventar con error 6000.
- **No setear `GlobalTaxCalculation: "TaxExcluded"`** en este modo. Usar `"NotApplicable"` y **no enviar** `TxnTaxDetail`. Aplica a Bill y a VendorCredit.
- Aplicar el mismo trato a las líneas de OtrosCargos y a la línea fallback.

### 2. Validación previa

En la validación pre-publicación (líneas ~2540-2588), cuando estamos en modo IVA al gasto, comparar `linesTotalAmount` directamente contra `xmlTotalComprobante` (sin sumar IVA). Hoy ya lo hace porque `ivaForTxnTaxDetail = 0`, pero conviene agregar un log explícito "IVA al gasto: total = suma de líneas" para que la auditoría sea legible.

### 3. Reproceso de Tree of Life

No tocamos config. Los usuarios usan la página existente `/audit-iva-mode` (ya creada) para republicar las facturas que se hayan quedado en `error` o publicadas con tax separado. Con el fix, los reintentos pasarán.

### 4. QA

- Desplegar la función.
- En `/error-documents` para Tree of Life, darle "Reintentar" a un par de facturas con error 6000 y verificar:
  - El Bill se crea en QBO.
  - El total del Bill = total del XML (sin IVA aparte).
  - Todas las líneas tienen el TaxCode exento.
- Revisar logs de la función para confirmar el mensaje nuevo "IVA al gasto" en cada línea.

## Lo que NO toca este plan

- No cambia la lógica para organizaciones con `default_uses_tax = true` (IVA recuperable).
- No cambia la página de Settings ni la auditoría existente.
- No modifica datos en la base; solo cambia cómo se construye el payload hacia QBO.
