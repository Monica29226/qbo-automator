# Mostrar el botón de llave para ver la clave del buzón

## Qué está pasando

El buzón Bluehost de Centro Médico San Antonio (`facturacion@cemsacr.com`) sí existe y está
activo en la base de datos. Sin embargo, la pantalla de Integraciones no lo lista: la tabla de
cuentas de integración no permite lectura desde el navegador (por seguridad, ya que ahí se
guardan tokens y contraseñas), así que la consulta devuelve una lista vacía.

Como el botón de llave se dibuja solo por cada cuenta listada, al no listarse ninguna cuenta el
botón nunca aparece. La función de revelado ya existe y funciona; el problema es únicamente que
la tarjeta no muestra el buzón.

## Qué se va a hacer

1. Exponer un listado seguro de cuentas de integración que devuelva **solo datos no sensibles**:
   tipo de servicio, correo, nombre y estado activo. Nunca tokens ni contraseñas.
   - Visible para miembros de la empresa y administradores globales.
2. Usar ese listado en la pantalla de Integraciones, en lugar de la lectura directa que hoy
   queda bloqueada.
3. Con eso, la tarjeta de Bluehost mostrará `facturacion@cemsacr.com` con su botón de llave, y al
   presionarlo se mostrará usuario y contraseña (ocultos por defecto, con opción de revelar y
   copiar), quedando cada consulta registrada en la auditoría.
4. Verificar en la aplicación que el botón aparece y que el diálogo devuelve las credenciales.

Este arreglo aplica a todas las empresas: cualquier buzón Bluehost, Hostinger u Outlook IMAP
volverá a mostrarse en su tarjeta.

## Detalles técnicos

- Nueva función `public.get_integration_accounts(_org_id uuid)` con `security definer`,
  `search_path = public`, que devuelve `id, service_type, account_email, account_name, is_active`
  filtrando por `organization_id` y validando `is_organization_member(auth.uid(), _org_id)` o
  `has_role(auth.uid(), 'admin')`. `EXECUTE` solo para `authenticated`. La columna `credentials`
  queda excluida del retorno, por lo que la tabla sigue sin `SELECT` para el cliente.
- `src/pages/Integrations.tsx`: reemplazar el `supabase.from("integration_accounts").select(...)`
  de `fetchData` por `supabase.rpc("get_integration_accounts", { _org_id: activeOrganization })`,
  manteniendo el filtro de activos y el orden por `service_type`. Sin cambios en el resto de la
  pantalla ni en `MailboxCredentialsDialog.tsx`.
- No se modifica la función `reveal-mailbox-credentials` ni sus registros de auditoría.
