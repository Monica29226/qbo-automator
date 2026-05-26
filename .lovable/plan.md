# Problema

Al usar **Importar Lote** con Jimena Cross o Centro Médico Terranoa, aparece el toast:

> "Esta empresa no tiene integración de correo configurada. Ve a Integraciones para conectar una."

…aunque ambas empresas **sí están conectadas** (verificado en la base):

- Jimena Cross → `gmail` activo
- Centro Médico Terranoa → `hostinger` activo

# Causa raíz

`ImportBatchDialog.tsx` (línea 88-97) detecta el proveedor consultando la tabla `integration_accounts` desde el cliente:

```ts
const { data } = await supabase
  .from("integration_accounts")
  .select("service_type")
  .eq("organization_id", orgId)
  .eq("is_active", true)
  ...
```

Pero la tabla `integration_accounts` **no tiene policy de SELECT** (sólo INSERT/UPDATE/DELETE para admins). En el esquema está explícito:

> *"Currently users can't do any of the following actions on the table integration_accounts: Can't SELECT records from the table"*

Esto es intencional porque la columna `credentials` (JSONB con tokens / passwords) **no debe** exponerse al frontend. Resultado: el query devuelve `[]` → `serviceType = null` → toast de error falso.

Esto explica por qué falla **en todas las organizaciones**, no sólo en esas dos. El bug se introdujo cuando `ImportBatchDialog` empezó a auto-detectar el proveedor en vez de recibirlo por parámetro.

# Solución propuesta

Reemplazar la consulta a `integration_accounts` por una fuente que el cliente **sí** pueda leer. Hay dos opciones limpias:

### Opción A (recomendada) — Usar los flags de `organizations`

La tabla `organizations` ya tiene los booleanos `gmail_connected`, `outlook_connected`, `hostinger_connected`, `bluehost_connected` (y RLS de SELECT para miembros). Refactorizar `getOrgIntegrationType` así:

```ts
const { data: org } = await supabase
  .from("organizations")
  .select("gmail_connected, outlook_connected, hostinger_connected, bluehost_connected")
  .eq("id", orgId).single();

// Prioridad: hostinger > bluehost > outlook(imap) > gmail
if (org?.hostinger_connected) return "hostinger";
if (org?.bluehost_connected)  return "bluehost";
if (org?.outlook_connected)   return "outlook_imap"; // o "outlook" según preferencia actual
if (org?.gmail_connected)     return "gmail";
return null;
```

Ventajas: no toca RLS, no expone credenciales, datos ya cacheables.

Riesgo: si un flag `*_connected` quedara desincronizado de `integration_accounts`, podría mentir. Mitigación → ya existe la edge function `check-system-health`; podemos llamarla como fallback antes de mostrar el toast (sólo cuando `null`).

### Opción B — Crear una RPC `get_org_email_provider(_org_id)`

Función `SECURITY DEFINER` que retorne sólo `service_type` (sin `credentials`), accesible a miembros vía `is_organization_member`. Más estricta pero requiere migración.

**Recomiendo Opción A** por simplicidad y porque los flags ya se mantienen por las propias edge functions de conexión.

# Cambios concretos

1. **`src/components/dashboard/ImportBatchDialog.tsx`**
   - Reemplazar `getOrgIntegrationType` por la lectura de flags en `organizations`.
   - Si el resultado es `null`, hacer un fallback que invoque la edge function `check-system-health` (que sí corre con service role) para confirmar antes de mostrar el toast — evita falsos negativos por flags desactualizados.
   - Mostrar en el toast cuál fue el resultado del check para diagnóstico.

2. **`src/hooks/useImportHealth.ts`** y **`ImportHealthPanel`**
   - Revisar si tienen el mismo bug (consultar `integration_accounts` desde cliente). Aplicar el mismo fix.

3. **(Opcional) Sincronización de flags**
   - Verificar que `integrations-connect-*` y `integrations-disconnect-*` actualicen los booleanos en `organizations`. Si encontramos un proveedor activo en `integration_accounts` pero con flag en `false`, agregar un trigger o migración one-shot que reconcilie.

# Verificación

1. Login como admin de Jimena Cross → abrir Importar Lote → debe detectar `gmail` y conectar.
2. Login como admin de Centro Médico Terranoa → debe detectar `hostinger`.
3. Probar con una org sin integración → toast correcto.
4. Revisar logs de la edge function correspondiente para confirmar que recibe `organization_id` y procesa.
