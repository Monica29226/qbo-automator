
## Diagnóstico de los errores de Tree of Life

Hay **32 facturas en error** (no 12 — el dashboard puede estar filtrando por fecha o tipo). El detalle:

| Tipo de error | Cantidad |
|---|---|
| QBO 6000 "Todos los artículos necesitan una tasa impositiva" | 31 |
| `Cannot read properties of undefined (reading 'Id')` (vendor) | 1 |

### Causa raíz del error 6000 (31 facturas)

Tree of Life tiene en `system_settings`:
- `default_uses_tax = false` ✅ (IVA al gasto — correcto)
- `tax_handling` = **NO está configurado** → cae al default `'standard'`

En `publish-to-quickbooks/index.ts` (línea 2186):
```ts
const includeTaxInLines = taxHandling === 'included_in_line_items';
```

Como `tax_handling='standard'`, `includeTaxInLines = false`. Esto provoca:

1. Las líneas se construyen SIN sumar el IVA al subtotal → **el total de la factura en QBO queda inflado** cuando QBO recalcula impuesto.
2. A cada línea se le intenta asignar el `TaxCodeRef` de la tarifa real (13 %, 4 %, 1 %, 2 %, 0.5 %). Cuando la tarifa no existe en el mapeo de QBO, no se asigna ningún `TaxCodeRef` → **QBO devuelve error 6000**.
3. La corrección previa (forzar `TaxCodeRef` exento + `GlobalTaxCalculation: NotApplicable`) **solo se activa cuando `tax_handling='included_in_line_items'`**, así que nunca aplicó para Tree of Life.

### Resultado esperado

Activando `tax_handling='included_in_line_items'` para Tree of Life:
- Cada línea = subtotal + IVA → el total del Bill respeta el XML.
- Todas las líneas reciben TaxCode **exento** → QBO no recalcula.
- `GlobalTaxCalculation: NotApplicable` → sin `TxnTaxDetail`.
- Las 31 facturas deberían publicarse en el reintento.

## Plan

### 1. Configurar `tax_handling` para Tree of Life

Insertar en `system_settings`:
```sql
INSERT INTO system_settings (organization_id, key, value, description)
VALUES (
  '<org-id-tree-of-life>',
  'tax_handling',
  'included_in_line_items',
  'IVA al gasto: se incluye dentro del monto de cada línea'
)
ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value;
```

### 2. Reintentar las 31 facturas con error 6000

Resetear a `pending` y encolar a `publish-to-quickbooks` (la función ya está parchada para `includeTaxInLines`):

```sql
UPDATE processed_documents
SET status='pending', error_message=NULL, retry_count=0, processed_at=NULL
WHERE organization_id = '<org-id-tree-of-life>'
  AND status='error'
  AND error_message LIKE '%6000%';
```

Luego invocar `publish-to-quickbooks` con los `document_ids` afectados.

### 3. Investigar el error de vendor (1 factura)

Factura `00100001010000039377` — vendor **FABRICA NACIONAL DE TROFEOS S.A.** falla con `Cannot read properties of undefined (reading 'Id')`. Probablemente la búsqueda/creación de vendor en QBO devolvió un cuerpo inesperado. Revisar logs de `publish-to-quickbooks` para ese `doc_id` y, si aplica, crear el vendor manualmente o reintentar tras la corrección.

### 4. Validar

Después del reintento:
- Confirmar 0 facturas en `status='error'` para Tree of Life.
- Verificar en QuickBooks que el **total del Bill = total del XML** y que las líneas muestran TaxCode exento.
- Revisar `/audit-iva-mode` — debería marcar todo como `ok`.

### 5. Considerar globalizar (opcional)

Cualquier otra organización con `default_uses_tax=false` está expuesta al mismo bug. Como mejora futura: hacer que el código fuerce `includeTaxInLines=true` cuando `default_uses_tax=false`, sin requerir la setting separada. (No incluida en este plan, requiere confirmación.)

## Archivos / acciones

- **Migración**: insertar/actualizar `system_settings.tax_handling` para Tree of Life.
- **Edge function `publish-to-quickbooks`**: sin cambios (ya parchado en turno anterior).
- **Acción operativa**: reset SQL + invocación de `publish-to-quickbooks` con los 31 doc_ids.
- **Manual**: 1 factura del vendor (revisión separada).
