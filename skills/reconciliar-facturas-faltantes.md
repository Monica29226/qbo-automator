# Skill: Detectar y reenviar facturas faltantes SIN duplicar

## Cuándo usar este skill
Cuando una empresa "dice que tiene facturas publicadas pero no aparecen en QuickBooks" (caso Centro Médico Terranova), o para auditar/reparar discrepancias entre el sistema y QBO.

## Las tres clases de "faltante" (diagnosticar cuál es)
1. **Huérfana con ID**: `status='published'` y `qbo_entity_id` NO nulo, pero el Bill da 404/Deleted en QBO. → La detecta `audit-qbo-published-vs-actual`.
2. **Fantasma sin ID**: `status='published'` pero `qbo_entity_id IS NULL`. NO la ve la auditoría ni la lista de publicadas (ambas filtran `qbo_entity_id not null`), pero el sistema la cuenta como publicada. **Clase más peligrosa.**
3. **Nunca ingerida**: la factura existe en Hacienda/correo pero nunca entró al sistema (ej. IMAP que no leyó una carpeta). No hay registro.

## Reglas de oro
- **CERO duplicados en la contabilidad del cliente.** Antes de (re)publicar CUALQUIER documento, verificar en QBO si ya existe (por Clave/DocNumber, usar `verify-qbo-bill-exists` o búsqueda Query). Solo crear los que de verdad faltan.
- **Confirmar la compañía correcta primero.** Verificar que el `realm_id` conectado de la empresa sea la compañía QBO correcta ANTES de republicar (si cambió el realm, republicar mandaría todo a la empresa equivocada). Comparar contra `qbo_realm_id` guardado en los documentos.
- **No bulk-republicar a ciegas.** Siempre: detectar → verificar en QBO → republicar solo los confirmados faltantes → reportar.

## Procedimiento
1. **Inventario por clase** (read-only), por empresa:
   - Fantasmas: `status='published' AND qbo_entity_id IS NULL`.
   - Huérfanas: correr `audit-qbo-published-vs-actual`.
   - Nunca ingeridas: comparar contra el Excel de ATV "Documentos Aceptados/Emitidos" o el conteo de correos con XML.
2. **Verificar en QBO** cada candidata por Clave/DocNumber.
3. **Reparar**:
   - Fantasma/huérfana que NO existe en QBO → resetear (`status='pending'`/`'processed'`, limpiar id) y publicar (reusar `republish-deleted-from-qbo` que ya hace el reset).
   - Si SÍ existe en QBO pero el sistema no guardó el id → solo **vincular** el id existente (no crear).
4. **Reportar**: cuántas por clase, cuántas reenviadas, cuántas vinculadas, cuántas con error. Sin tragar errores.

## Mejora a construir (para que no vuelva a pasar)
- Que la auditoría también detecte la **clase 2 (fantasmas sin ID)**, no solo las que tienen ID.
- Correr la auditoría de huérfanos por **cron** en TODAS las empresas y generar alerta automática (hoy es botón manual).
- Detector de brecha "esperado vs recibido" (correos con XML vs documentos creados; señal `partial`/backlog del IMAP).
