

# Plan: Cotejo Automático XML vs QuickBooks

## Problema
No existe un mecanismo para comparar automáticamente los datos del XML original contra lo que quedó registrado en QuickBooks. Esto significa que errores de monto, impuestos o cuenta contable pasan desapercibidos.

## Solución
Crear una función de auditoría que, para cada factura publicada, lea el bill desde QuickBooks y lo compare campo por campo contra el `xml_data` almacenado en `processed_documents`. El resultado se muestra en un modal del dashboard con indicadores visuales de coincidencia/discrepancia.

## Cambios

### 1. Nueva edge function: `reconcile-xml-vs-qbo`
- Recibe `organization_id` y opcionalmente `document_ids[]` o un rango de fechas
- Para cada documento `published` con `qbo_entity_id`:
  - Lee el bill/vendorcredit desde la API de QuickBooks
  - Compara contra `xml_data` del documento:
    - **Total**: `bill.TotalAmt` vs `total_amount`
    - **Subtotal**: suma de líneas QBO vs subtotal XML
    - **Impuesto**: `bill.TxnTaxDetail.TotalTax` vs `total_tax`
    - **Modo impuesto**: `GlobalTaxCalculation` (TaxExcluded/TaxInclusive/NotApplicable)
    - **Fecha**: `bill.TxnDate` vs `issue_date`
    - **Moneda**: `bill.CurrencyRef` vs `currency`
    - **Proveedor QBO ID**: `bill.VendorRef.value` vs vendor mapping
    - **Número de líneas**: count de líneas QBO vs count de detalle XML
  - Clasifica resultado: ✅ Match exacto, ⚠️ Discrepancia menor (< ₡1), ❌ Discrepancia crítica
- Retorna array de resultados con detalle de cada campo comparado
- Rate limit: 200ms entre llamadas a QBO API

### 2. Componente UI: `ReconcileXmlQboButton` en Dashboard
- Botón "Cotejar XML vs QBO" en la sección de acciones o diagnóstico
- Modal con:
  - Filtro por rango de fechas (default: último mes)
  - Opción de cotejar solo las últimas N facturas
  - Tabla de resultados con columnas: Factura | Proveedor | Total XML | Total QBO | IVA XML | IVA QBO | Estado
  - Cada fila muestra íconos ✅/⚠️/❌
  - Resumen arriba: "45/50 coinciden exactamente, 3 con discrepancia menor, 2 con error crítico"
  - Las filas con discrepancia se expanden para mostrar detalle campo por campo
  - Botón "Republicar" en filas con discrepancias críticas (invoca `force-publish-document`)

### 3. Integración post-publicación (opcional, segundo paso)
- Después de publicar exitosamente un bill, ejecutar una verificación rápida comparando `bill.TotalAmt` vs `total_amount` del documento
- Si hay discrepancia > ₡1, marcar el documento con un flag `qbo_verified = false` y loguearlo

## Archivos a crear/editar
- `supabase/functions/reconcile-xml-vs-qbo/index.ts` — nueva función
- `supabase/config.toml` — agregar config para la nueva función
- `src/components/dashboard/ReconcileXmlQboButton.tsx` — nuevo componente UI
- `src/pages/Dashboard.tsx` — agregar botón al área de diagnóstico

## Detalle técnico

```text
Para cada documento published:
  1. Leer xml_data del DB → extraer subtotal, tax, total, líneas
  2. GET /v3/company/{realmId}/bill/{qbo_entity_id} → obtener bill QBO
  3. Comparar:
     XML total_amount  ↔  QBO TotalAmt           → match/diff
     XML total_tax     ↔  QBO TxnTaxDetail.Total  → match/diff
     XML subtotal      ↔  QBO sum(Line.Amount)     → match/diff
     XML issue_date    ↔  QBO TxnDate              → match/diff
     GlobalTaxCalc     → NotApplicable = ❌ si XML tiene impuesto
  4. Resultado: { field, xml_value, qbo_value, match: bool }
```

