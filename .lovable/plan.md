# Diagnóstico — Jimena Cross

## Hallazgos en base de datos

- `organizations.is_active = false` para Jimena Cross (id `4ff74a44…`).
- `integration_accounts`: **Gmail activo con refresh_token** y **QuickBooks activo con refresh_token** (actualizado hoy 16:00 UTC). Ambas integraciones están realmente conectadas.
- `sync_logs`: **0 registros**. El cron nunca ha corrido para esta organización.
- `processed_documents`: 27 en abril, 37 en mayo, **0 en junio**.

## Causa raíz

`auto-sync-invoices` filtra por `organizations.is_active = true` (línea 109). Como Jimena Cross está marcada inactiva, el cron la omite por completo, por eso no aparece ninguna factura de junio. Esto coincide con el mensaje "inactiva — sincronización pausada" en el dashboard.

El cartel "QuickBooks desconectado" que ves es engañoso: la integración SÍ está activa en BD. Los `TypeError: Load failed` de la consola muestran que la RPC `has_active_integration` falló por red en ese momento; el componente trata cualquier error como "no conectado". Además conviven cuatro indicadores que se contradicen ("Sistema saludable", "Auto-actualización activa", "QuickBooks desconectado", "inactiva — pausada"), lo que confunde aún más.

## Plan

1. **Reactivar la organización**
   - Migración que ponga `organizations.is_active = true` para Jimena Cross.
   - Tras la siguiente ejecución de cron (cada hora) entrarán los correos de junio. Opcionalmente disparar `auto-sync-invoices` manualmente para no esperar.

2. **Corregir falsos negativos de "QuickBooks desconectado"**
   - En `QBOSyncPill` y `AutoUpdateStatusBadge`: distinguir entre "error de red al consultar" y "no conectado". Si la consulta falla, mostrar estado "Comprobando…" en ámbar en vez de rojo "Desconectado".
   - Añadir un retry corto (1 reintento) antes de declarar desconexión.

3. **Unificar indicadores de salud en el sidebar/topbar**
   - Una sola píldora con jerarquía clara:
     - Rojo: organización inactiva (pausada manualmente).
     - Rojo: integración sin refresh_token.
     - Ámbar: última sync >60 min o con errores.
     - Verde: sync reciente OK.
   - Quitar duplicados ("Sistema saludable" + "Auto-actualización activa" + pill QBO + banner "inactiva") consolidando en `QBOSyncPill` + un único banner contextual cuando `is_active=false` que explique "Sincronización pausada por administrador — Reactivar".

4. **Botón "Reactivar sincronización"** en el banner de organización inactiva, que llame a un edge function seguro (requiere admin) que ponga `is_active=true` y dispare un primer `auto-sync-invoices` para esa org.

## Archivos afectados (estimado)

- `supabase/migrations/<new>.sql` (reactivar Jimena Cross).
- `src/components/dashboard/QBOSyncPill.tsx`
- `src/components/dashboard/AutoUpdateStatusBadge.tsx`
- `src/pages/Dashboard.tsx` (consolidar banners, añadir botón reactivar)
- Nueva edge function `reactivate-organization-sync` (opcional, sólo si quieres botón en UI).

¿Procedo con los 4 pasos o sólo con (1) reactivar Jimena Cross ahora y dejar el resto para otra iteración?
