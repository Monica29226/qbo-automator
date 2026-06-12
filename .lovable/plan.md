## Problema

La pantalla **Mapeo de cuentas legacy** (`/legacy-account-mapping`) guarda el mapeo (código `1150040xxx` → cuenta QBO), pero las facturas afectadas no se vuelven a publicar y siguen marcadas como `needs_account_mapping` / `error`. Causas detectadas en código y base de datos:

1. Hay facturas en `status='error'` cuyo `error_message` contiene el código legacy pero su `default_account_ref` es otro (ej. `"652 Cuotas y suscripciones"` con error `Cuenta 1150040027 no existe`). `saveRow` las marca como `processed`, pero al republicar, `publish-to-quickbooks` extrae el código de `default_account_ref` (`"652"`), NO entra al branch de mapeo legacy y vuelve a fallar.
2. `saveRow` solo cambia el `status` a `processed`; **no dispara automáticamente la republicación**. El usuario debe acordarse de pulsar "Reintentar publicación".
3. `qbo_publish_tracking` queda con el estado viejo (`needs_account_mapping`), así que algunas vistas de auditoría siguen mostrando la factura como pendiente aunque ya se haya resuelto.
4. La función `publish-to-quickbooks` ya tiene el branch de resolución legacy (líneas 2204-2228), pero solo lo usa cuando `default_account_ref` empieza con `1150040`.

## Solución

### 1. Arreglo en `src/pages/LegacyAccountMapping.tsx` — `saveRow`
Al guardar un mapeo:
- Localizar los documentos afectados (mismo filtro `.or()`).
- Actualizarlos en una sola pasada con:
  - `status = 'processed'`
  - `default_account_ref = <legacy_code>` (forzar que el resolver use el branch legacy).
  - `error_message = null`.
- Limpiar `qbo_publish_tracking` (`status='needs_account_mapping'`) de esos documentos para que las auditorías reflejen el cambio.
- Disparar `publish-to-quickbooks` en background (fire-and-forget) con `organization_id` para republicar inmediatamente.
- Mostrar toast con conteo: "X facturas re-encoladas, publicando en segundo plano…".
- Llamar `load()` al terminar.

### 2. Mejora en `publish-to-quickbooks/index.ts`
Reforzar el branch legacy para resolver también cuando el código viene en `error_message` (no solo en `default_account_ref`). Como fallback defensivo:
- Si `getAccountIdByCode(extractedCode)` devuelve null **y** el `error_message` del documento contiene `1150040\d+`, intentar resolver vía `legacy_account_mapping` antes de marcar error.

### 3. Botón "Reintentar publicación"
Hoy invoca `publish-to-quickbooks` sin filtro y muestra el resultado. Añadir:
- Refresco automático del listado tras 2-3 s.
- Toast intermedio "Procesando en segundo plano…" si la respuesta tarda.

### 4. Deploy
Desplegar `publish-to-quickbooks` después del cambio.

## Archivos a tocar

- `src/pages/LegacyAccountMapping.tsx` — `saveRow` y `retryAll`.
- `supabase/functions/publish-to-quickbooks/index.ts` — fallback legacy desde `error_message`.

## Validación

- Tomar una factura ejemplo de Centro Médico Terranoa (org `a247170a…`) con `default_account_ref` legacy, guardar el mapeo y confirmar que aparece como `published` con `qbo_entity_id` en menos de 30 s.
- Repetir con una factura cuyo legacy code solo está en `error_message` (caso `00100001010043452608`).
- Confirmar que el contador de "Facturas afectadas" en la pantalla baja a 0 tras el save.
