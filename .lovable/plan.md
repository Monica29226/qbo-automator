## Objetivo

Crear una herramienta masiva de **auditoría y republicación** que detecte facturas marcadas como publicadas en nuestro sistema pero **borradas o inexistentes en QuickBooks**, y permita republicarlas de forma controlada.

## Cómo funcionará

### 1. Nueva Edge Function: `audit-qbo-published-vs-actual`

Recorre `processed_documents` con `status = 'published'` y `qbo_entity_id` no nulo para la organización activa. Para cada una:

1. Consulta QBO: `GET /v3/company/{realm}/{entityType}/{entityId}`
2. Clasifica el resultado:
   - **Existe y activo** → OK, no hacer nada
   - **404 / no existe / `status = "Deleted"`** → marcar como "huérfana QBO" (borrada manualmente)
   - **Error de token / red** → marcar como "no verificable" (no tocar)
3. Devuelve la lista de huérfanas con: `doc_number`, `supplier_name`, `total_amount`, `issue_date`, `qbo_entity_id`, motivo.
4. Procesa en lotes (15 concurrentes, 25s timeout) y soporta paginación por `offset` para evitar timeouts en orgs grandes.

### 2. Nueva Edge Function: `republish-deleted-from-qbo`

Recibe un array de `document_ids` confirmados como huérfanos. Para cada uno:

1. **Limpia el rastro previo**:
   - `DELETE FROM qbo_publish_tracking WHERE document_id = ?`
   - `UPDATE processed_documents SET qbo_entity_id = NULL, qbo_entity_type = NULL, status = 'pending', error_message = NULL, retry_count = 0`
2. Invoca `publish-to-quickbooks` con esos `document_ids`.
3. Registra la operación en `audit_log` con acción `republish_after_qbo_delete`.

### 3. Nuevo panel UI: `AuditPublishedVsQBO.tsx` (en Dashboard)

Tarjeta nueva en quick actions con flujo en 3 pasos:

1. **Botón "Auditar publicadas en QBO"** → invoca la función de auditoría, muestra barra de progreso (paginación).
2. **Tabla de resultados** con las huérfanas detectadas: checkbox por fila, "Seleccionar todo", columnas (fecha, proveedor, número, monto, QBO ID).
3. **Botón "Republicar seleccionadas"** → confirma con diálogo y dispara la función de republicación. Toast de progreso con conteos de éxito/error.

Aplica globalmente (todas las organizaciones via `organization_id` activo). Admins pueden ejecutarlo.

### Detalles técnicos

- **QBO query batching:** 15 concurrentes con `Promise.allSettled`, respeta rate limits (500/min).
- **Detección de "borrado":** QBO devuelve 404 con `code = "610"` (Object Not Found) o el entity puede venir con `status = "Deleted"` en operaciones de query. Manejar ambos.
- **Token expirado:** si falla auth, abortar auditoría con mensaje claro y botón de reconexión QBO (no marcar todo como huérfano por error de token).
- **Seguridad:** ambas funciones validan JWT, verifican membresía admin de la org, usan `service_role` solo para escritura tras validación.
- **Sin duplicados:** después de limpiar `qbo_publish_tracking`, `publish-to-quickbooks` puede crear el Bill nuevo sin chocar con la restricción `org_id + doc_key`.

### Archivos

**Nuevos:**
- `supabase/functions/audit-qbo-published-vs-actual/index.ts`
- `supabase/functions/republish-deleted-from-qbo/index.ts`
- `src/components/dashboard/AuditPublishedVsQBO.tsx`

**Modificados:**
- `src/pages/Dashboard.tsx` — montar el nuevo panel en la sección de quick actions
- `mem://index.md` + nueva memoria `mem://features/audit-republish-deleted-qbo`

### No se toca

- Lógica de publicación (`publish-to-quickbooks` se reutiliza tal cual)
- Estructura de BD (no hay migración — solo lectura/escritura sobre tablas existentes)
- Sync de emails, importación, otros flujos
