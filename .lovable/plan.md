# Auditoría a fondo: Centro Médico Terranova

## Lo que ya verifiqué en la base de datos

- Organización: `CENTRO MEDICO TERRANOA SOCIEDAD ANONIMA` (id `a247170a-...`)
- Estado actual de facturas: **219 published**, 5 error, 2 needs_account_mapping
- Las 219 publicadas **sí tienen `qbo_entity_id` y registro en `qbo_publish_tracking`** — internamente el sistema cree que todas llegaron
- Solo existe **un realm de QuickBooks** conectado (`9341456229491558`), así que no es un caso de "se reconectó a otra empresa de QBO"
- No hay alertas críticas recientes de discrepancia, solo avisos de token próximo a expirar

Conclusión: las facturas tienen ID de QBO guardado, pero el usuario reporta que al revisar QuickBooks no aparecen. Eso encaja exactamente con el escenario "orphan in QBO": el Bill fue creado, se guardó el ID, y después fue **borrado dentro de QuickBooks** (o el token apuntaba a otro realm en algún momento puntual). Ya existe el edge function `audit-qbo-published-vs-actual` justamente para detectar esto factura por factura.

## Plan

1. **Ejecutar la auditoría completa** contra QuickBooks llamando `audit-qbo-published-vs-actual` paginando las 219 facturas (offset 0, 200, ...). Para cada una hace GET al Bill/VendorCredit por su `qbo_entity_id`:
   - 404 / "Deleted" → **orphan** (existió y se borró, o nunca llegó)
   - Existe pero totales no coinciden → mismatch
   - Existe y cuadra → ok
   La función ya marca automáticamente las que tengan discrepancia de totales como `review` y registra alertas, sin necesidad de cambios.

2. **Reportar el desglose al usuario** en chat:
   - Total verificadas / ok / huérfanas / con discrepancia / no verificables
   - Lista de los huérfanos (número de factura, proveedor, monto, fecha, motivo devuelto por QBO) — esto te dice exactamente cuáles "dicen publicadas pero no están en QBO"

3. **Limpiar y republicar las huérfanas** usando el flujo ya existente `republish-deleted-from-qbo` (botón "Auditar publicadas vs QBO" en el dashboard). Esto:
   - Borra el `qbo_entity_id` y el registro en `qbo_publish_tracking`
   - Las pasa a `pending` para que el publicador en cola las vuelva a crear en QBO con el mismo XML
   Solo se ejecuta si el usuario confirma después de ver el reporte.

4. **Documentar la causa probable**: si la mayoría son huérfanas con motivo `404` o `Deleted`, casi seguro fueron eliminadas dentro de QuickBooks por un usuario. Si en cambio salen "no verificables" por token expirado, primero hay que reconectar QBO (ya hay alertas de token expirando) y reintentar la auditoría.

## Detalles técnicos

- No requiere cambios de esquema ni código nuevo: usa los edge functions existentes `audit-qbo-published-vs-actual` y `republish-deleted-from-qbo`.
- La auditoría es segura (solo lectura en QBO) hasta el paso 3.
- El paso 3 es destructivo solo en el sentido de que reabre las facturas a publicación; el XML original se conserva en `processed_documents`.

¿Procedo con la auditoría completa de las 219 facturas y te devuelvo el reporte detallado?
