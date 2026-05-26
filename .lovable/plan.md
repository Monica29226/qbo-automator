# Garantizar que la importación capture TODAS las facturas, para TODAS las empresas

## Estado actual (verificado en DB)

Las 16 empresas activas tienen sus flags `*_connected` **sincronizados** con `integration_accounts`. El fix anterior (leer flags de `organizations`) ya funciona para todas. Las únicas dos sin correo son **Asociacion Horizonte Positivo** y **Sistemas de Desarrollo De Costa Rica** (no tienen integración — esperado).

Falta cubrir:

1. **Validación de cobertura**: confirmar visualmente, por empresa, que la integración detectada importa hasta vaciar el buzón.
2. **Detección de drift futuro**: si alguien desactiva el flag sin desconectar la integración (o viceversa), volvemos al bug original.
3. **Reconciliación contra fuente externa** (Hacienda/Siku) para certificar "tomó todas las facturas", no sólo "tomó todo el buzón".

## Plan

### 1. Función de auto-diagnóstico por empresa (`integration-self-check`)

Nueva edge function (service role) que para un `organization_id` devuelve:

- Flag `organizations.*_connected` vs filas reales en `integration_accounts` (alerta si difieren).
- Resultado de `noop login` IMAP/OAuth (sin descargar correos) para confirmar credenciales vigentes.
- Conteo de mensajes pendientes en el buzón vs `processed_documents` del mes en curso.
- Último `sync_logs` exitoso y backlog estimado.

Se invoca:
- Manualmente desde un botón "Verificar conexión" junto a cada empresa en `/integrations`.
- Automáticamente al abrir **Importar Lote** (antes de mostrar el toast de error).

### 2. Pantalla "Cobertura por empresa" en el Panel de Salud

Ampliar `ImportHealthPanel` con una tabla, una fila por organización activa:

| Empresa | Proveedor | Login OK | Buzón | Importadas mes | Faltantes vs Hacienda | Acción |
|---|---|---|---|---|---|---|
| Terranoa | hostinger | ✅ | 312 | 287 | 3 | [Drenar] |
| Jimena Cross | gmail | ⚠️ token | 0 | 0 | n/d | [Reconectar] |
| … | | | | | | |

Datos vienen de `integration-self-check` + `import-health-summary` (ya existe).

### 3. Botón "Drenar todas las empresas" (operación de un click)

En el panel de salud, un solo botón que itera por cada empresa con `messages_remaining > 0` y dispara `hostinger-fetch-invoices` / `bluehost-fetch-invoices` / `gmail-fetch-invoices` con `drain=true` hasta que cada buzón devuelva 0 pendientes o 3 iteraciones estancadas (misma lógica del modo "Drenar todo el mes" que ya implementamos).

Concurrencia: 3 empresas en paralelo para no saturar Resend ni QBO.

### 4. Reconciliación obligatoria post-drenaje

Tras el drenaje masivo, automáticamente:

- Compara `processed_documents` del mes vs reporte oficial (Hacienda ATV o último Siku importado).
- Lista los `doc_key` que están en Hacienda pero no en nuestra DB → **estos son los que el correo no trajo** (típicamente porque el emisor no envió, terminaron en spam, o cuenta equivocada).
- Genera alerta en `alert_history` con `alert_type='missing_from_email'` y los detalles.

### 5. Trigger de drift para flags

Migración con trigger en `integration_accounts` que mantenga `organizations.*_connected` siempre alineado en INSERT/UPDATE/DELETE. Elimina la posibilidad de regresar al bug original.

### 6. Reporte diario reforzado

Actualizar `daily-import-health-report` para que el correo de las 7 AM incluya:

- Empresas con login fallando.
- Empresas con backlog > 0.
- Total de "faltantes vs Hacienda" del día anterior.

## Archivos a tocar

- **Nuevo:** `supabase/functions/integration-self-check/index.ts`
- **Edit:** `src/components/dashboard/ImportHealthPanel.tsx`, `src/hooks/useImportHealth.ts`, `src/pages/Integrations.tsx` (botón verificar), `supabase/functions/daily-import-health-report/index.ts`, `supabase/functions/import-health-summary/index.ts`
- **Migración:** trigger `sync_org_connection_flags` sobre `integration_accounts`.

## Verificación

1. Abrir Panel de Salud → tabla muestra las 16 orgs con su estado real.
2. Click en "Drenar todas" → cada empresa procesa hasta `messages_remaining=0`.
3. Revisar `alert_history` → 0 alertas `missing_from_email` para empresas al día.
4. Forzar drift manual (UPDATE flag a false) → trigger lo restaura → query del cliente sigue funcionando.
5. Recibir correo diario con resumen verde para todas las empresas conectadas.
