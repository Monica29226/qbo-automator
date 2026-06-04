# Arreglar falso "Gmail desconectado" + refresco lento

## Causa raíz

`GmailTokenAlert` lee `integration_accounts` directamente desde el cliente para verificar credenciales. Por política de seguridad esa tabla **no tiene SELECT para usuarios** (sólo `service_role`), por lo que RLS devuelve `null` y la alerta se dispara aunque la conexión esté sana. Verificado en DB para `ASADA DE TARBACA`: `gmail_connected=true`, `integration_accounts.is_active=true`, `refresh_token` y `access_token` presentes.

Además, el chequeo refresca cada 10 minutos y no escucha cambios de organización ni eventos de reconexión, así que tras reconectar la alerta puede tardar mucho en desaparecer.

## Cambios

### 1. Nueva RPC `get_email_provider_health(_org_id uuid)` — SECURITY DEFINER

Devuelve por proveedor si está activo y si las credenciales están completas, sin exponer las credenciales en sí:

```sql
RETURNS TABLE(
  service_type text,
  is_active boolean,
  has_credentials boolean  -- refresh_token (OAuth) o password+imap_host (IMAP)
)
```

Validar que el caller es miembro de la org (`is_organization_member(auth.uid(), _org_id)`).
`GRANT EXECUTE ... TO authenticated`.

### 2. `src/components/dashboard/GmailTokenAlert.tsx`

- Eliminar el `select` directo a `integration_accounts`.
- Usar la nueva RPC `get_email_provider_health` para validar el proveedor activo.
- Conservar la lógica de prioridad gmail → outlook → bluehost → hostinger.
- Bajar el intervalo de polling a 60 s.
- Escuchar el evento custom `dashboard:refresh` (ya disparado por `SyncEmailNowButton` y otros) y volver a chequear al recibirlo.
- Disparar `window.dispatchEvent(new CustomEvent("dashboard:refresh"))` al final de la reconexión exitosa de Gmail/Outlook en `Integrations.tsx` para que la alerta se limpie inmediatamente.
- Re-chequear también cuando la pestaña vuelve a foco (`visibilitychange`).

### 3. Memoria de seguridad

Reafirmar que ningún componente cliente debe `SELECT` sobre `integration_accounts`; siempre vía RPC SECURITY DEFINER. Añadir esta regla al índice si no existe.

## Validación

1. En el dashboard de ASADA DE TARBACA la alerta "Gmail desconectado" desaparece sin necesidad de reconectar.
2. Desconectar Gmail manualmente (poner `is_active=false`) → alerta aparece dentro de ≤60 s o al cambiar de pestaña/org.
3. Reconectar desde Integraciones → alerta desaparece de inmediato (vía evento `dashboard:refresh`).
4. Cambiar de organización → la alerta refleja la nueva org sin esperar 10 min.
