# Plan: Importar mayo 2026 de Terranoa sin pérdidas silenciosas

## Por qué antes "no subía nada sin dar error"

Tras revisar el flujo actual, las facturas se descartan **en silencio** en 3 puntos:

1. **Deduplicación por `doc_key`** — si el `doc_key` ya existe en `processed_documents` o en `qbo_publish_tracking`, el ítem se marca como `duplicate` y no entra al log visible.
2. **Validación de receptor** — si el XML viene sin `MensajeReceptor` o el `Receptor.Identificacion` no coincide con la cédula de Terranoa, se rechaza como "no dirigida a la organización".
3. **Estado Hacienda** — si no hay XML de respuesta con `EstadoMensaje = 1`, queda en `rejected` sin notificación.

El lote actual (`/admin/batch-import-v2`) procesa el ZIP pero **no muestra qué archivos quedaron fuera ni por qué**, por eso parece que "no sube nada".

## Procedimiento recomendado (sin tocar código todavía)

### Paso 1 — Identificar EXACTAMENTE qué consecutivos faltan
1. Abrir Terranoa → Dashboard → **"Sincronizar desde Excel" (Siku)**
2. Subir el reporte Siku de mayo 2026
3. El sistema devuelve la lista de `NumeroConsecutivo` que están en Siku pero no en el sistema → exportar como CSV

### Paso 2 — Armar el ZIP correctamente
Para cada consecutivo faltante, el ZIP debe contener **3 archivos por factura** con nombres que compartan prefijo:
```
50601052600310XXXX...-FE.xml          ← XML de la factura
50601052600310XXXX...-MR.xml          ← MensajeReceptor (EstadoMensaje=1)
50601052600310XXXX...-FE.pdf          ← PDF (opcional pero recomendado)
```
- Sin MensajeReceptor el sistema rechaza por política de Hacienda
- Si descargas de ATV vienen ya con esos nombres

### Paso 3 — Mejorar el reporte del lote ANTES de importar (cambio mínimo de código)
Para evitar que vuelva a "no pasar nada en silencio", ajustar `BatchImportV2` + `batch-import-finalize` para que el reporte final muestre **una fila por archivo del ZIP** con una de estas razones:

| Estado | Significado |
|---|---|
| `accepted` | Entró a `processed_documents` |
| `duplicate` | `doc_key` ya existía (con link a la factura original) |
| `wrong_receptor` | Cédula receptor ≠ Terranoa |
| `no_mensaje_receptor` | Falta el MR.xml en el ZIP |
| `hacienda_rejected` | `EstadoMensaje ≠ 1` |
| `not_fe` | Es TE/04 u otro tipo no soportado |
| `out_of_date_range` | Fecha < 2026-01-01 |
| `pending_config` | Aceptada pero proveedor sin cuenta QBO |
| `parse_error` | XML inválido (con detalle) |

Y descargar ese reporte como CSV. Así sabés exactamente por qué cada XML no llegó.

### Paso 4 — Importar mayo
1. `/admin/batch-import-v2` → seleccionar organización **Terranoa**
2. Etiqueta de mes: `Mayo 2026`
3. Subir el ZIP del Paso 2
4. Esperar el resumen → revisar el CSV
5. Para los `pending_config` → ir a Configuración Pendiente y asignar cuenta QBO → se auto-publican
6. Para `duplicate` → verificar contra la factura existente (normalmente está bien, solo confirma)
7. Para `no_mensaje_receptor` / `hacienda_rejected` → descargar MR correcto y reintentar solo esas

### Paso 5 — Verificar cierre de mes
- Volver a correr "Sincronizar desde Excel" con el Siku de mayo
- El delta debe ser 0
- Confirmar que `qbo_publish_tracking` tiene entradas para todas las facturas con `qbo_entity_id` no nulo

## Detalles técnicos del cambio mínimo (Paso 3)

Archivos a modificar:
- `supabase/functions/batch-import-process/index.ts` → en cada `continue`/`skip` agregar `batch_import_items.insert({status, reason, doc_key, supplier_name, filename})` con motivo específico (hoy varios `continue` silenciosos no escriben nada).
- `supabase/functions/batch-import-finalize/index.ts` → agregar agregados por `reason` y generar CSV con `Resource: text/csv` subido a `invoice-imports/{batch_id}/report.csv`.
- `src/pages/BatchImportV2.tsx` → tabla de resultados agrupada por estado con botón "Descargar CSV" y filtro por motivo.

Sin cambios de schema; `batch_import_items` ya tiene las columnas `status`, `reason`, `filename`, `doc_key`, `supplier_name`.

## Resultado esperado
- Subís el ZIP de mayo y obtenés un CSV con 90 filas explicando el destino de cada archivo
- Nunca más "no pasó nada en silencio"
- Las que entran como `pending_config` se desbloquean asignando cuenta al proveedor
- Cierre mensual auditable contra Siku
