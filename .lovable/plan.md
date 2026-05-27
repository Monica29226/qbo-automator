# Republicar factura borrada en QuickBooks

## Diagnóstico

Factura encontrada en el sistema:
- **Proveedor:** JORGE MARIN RAMIREZ
- **Número:** 00100001010000000828
- **Clave:** 50618012600060374005100100001010000000828197160363
- **Monto:** ₡1,251,583.42
- **Estado interno:** `published` (Bill #56 en QBO, publicada 15-may-2026)
- **Estado real:** No existe en QuickBooks (borrada manualmente)

Es un caso clásico de "huérfana": el sistema cree que está publicada porque guarda el `qbo_entity_id`, pero el Bill fue eliminado en QBO. Por eso no aparece en duplicados ni se vuelve a publicar.

## Opción recomendada: usar la herramienta existente

Ya existe en el Dashboard la sección **"Auditar publicadas vs QuickBooks"** (`AuditPublishedVsQBO`) que hace exactamente esto:

1. Recorre todas las facturas con `status=published` y verifica si el `qbo_entity_id` existe realmente en QBO.
2. Lista las huérfanas (borradas o inexistentes).
3. Permite seleccionarlas y republicarlas: limpia `qbo_publish_tracking`, resetea `processed_documents` a `pending` y dispara `publish-to-quickbooks`.

**Acción para ti (sin tocar código):**
- Ve al Dashboard → tarjeta "Auditar publicadas vs QuickBooks" → "Iniciar auditoría".
- Cuando aparezca la fila de JORGE MARIN RAMIREZ 00100001010000000828, selecciónala y dale "Republicar".

## Si prefieres que lo haga directo (un solo clic, sin auditar todo)

Puedo añadir un pequeño cambio en build mode para resolver este caso específico sin esperar la auditoría completa:

### Cambios propuestos

1. **`src/components/dashboard/AuditPublishedVsQBO.tsx`**
   - Añadir un input "Republicar por número de factura" + botón.
   - Al confirmar, busca el `processed_documents` por `doc_number` o `doc_key` dentro de la organización activa y llama directamente a `republish-deleted-from-qbo` con ese `id`.
   - Mensaje de éxito/error con toast.

2. **No requiere edge functions nuevas** ni cambios de schema; reutiliza `republish-deleted-from-qbo` que ya limpia tracking y republica.

### Alcance fuera

- No tocar lógica de QBO ni de detección de duplicados.
- No cambiar la auditoría masiva existente.

## Recomendación

Probar primero la **herramienta existente** (es un solo clic más). Si te resulta lento auditar las miles de publicadas, implemento el atajo "Republicar por número" en build mode.

¿Procedo con el atajo o lo resuelves desde la auditoría existente?
