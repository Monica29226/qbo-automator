# Centro Médico San Antonio: el buzón de facturación está caído desde el 15 de setiembre

## Qué encontré (verificado en los registros)

- La última factura registrada es del 14 de setiembre de 2026 (ingresada el 15 de setiembre a las 8:01 a.m.). Después de esa fecha no entró ninguna.
- La razón no es que no lleguen facturas: el sistema **no logra entrar al buzón** `facturacion@cemsacr.com` (servidor `mail.cemsacr.com`, puerto 993).
- Cronología del fallo:
  - 15 de setiembre, 9:30 p.m.: el servidor de correo empieza a presentar un certificado que no corresponde al nombre `mail.cemsacr.com` ("certificado no válido para ese nombre").
  - 17 de setiembre, 3:00 a.m. en adelante: el error cambia a **contraseña rechazada** por el servidor de correo.
  - Desde entonces, 48 intentos por día, todos fallidos, con cero correos leídos. Hoy 21 de setiembre sigue igual (último intento 1:00 p.m. de Costa Rica).
- Las alertas sí se están generando (avisos críticos cada pocas horas, ninguno marcado como resuelto), pero nadie actuó sobre ellas.
- Ninguna otra empresa tiene este problema de buzón; QuickBooks de esta empresa sí está conectado y funcionando.

Conclusión: no hay facturas perdidas ni descartadas por error; hay facturas **sin leer** acumuladas en el buzón desde el 15 de setiembre. En cuanto se restablezca el acceso deberían entrar todas, porque el sistema lee el histórico del buzón y descarta duplicados por la clave de 50 dígitos.

## Qué se necesita de su lado (sin esto no se puede recuperar)

Alguien con acceso al hosting de `cemsacr.com` debe confirmar dos cosas:

1. La contraseña actual de `facturacion@cemsacr.com` (es muy probable que se cambiara o que el hosting la restableciera el 16–17 de setiembre).
2. El nombre de servidor correcto para IMAP seguro. Cuando el certificado no coincide, el hosting normalmente indica otro nombre (por ejemplo el servidor propio del hosting en vez de `mail.cemsacr.com`).

Con esos dos datos actualizo la conexión y drenamos el atraso.

## Plan de trabajo

1. Actualizar las credenciales y el servidor del buzón de esta empresa con los datos que usted confirme.
2. Probar la conexión de inmediato y, si el certificado sigue sin coincidir, ajustar el nombre de servidor al que indique el hosting.
3. Drenar el atraso por tandas hasta que no queden correos pendientes desde el 14 de setiembre, y reportar cuántas facturas entraron, cuántas ya existían y cuántas quedaron en revisión esperando cuenta de gasto.
4. Publicar a QuickBooks solo las que tengan cuenta asignada; las demás quedan en la pantalla de revisión.
5. Cierre: verificar que no haya claves duplicadas ni facturas marcadas como publicadas sin identificador real de QuickBooks.

## Mejora para que no vuelva a pasar en silencio

Hoy el aviso existe pero se pierde entre otros. Propongo una alerta específica de **buzón inaccesible**: cuando una empresa acumule más de 3 lecturas fallidas seguidas por contraseña rechazada o certificado inválido, enviar un correo con asunto claro, nombre de la empresa, el buzón afectado y desde cuándo, y mostrar ese estado en rojo en el panel de salud de importación, hasta que la conexión se restablezca.

## Detalles técnicos

- Empresa `e06ff1bc-bcfc-4158-a10c-5dbc9c6b0c2f`, cédula 3101618967, proveedor de correo `bluehost`.
- Errores en `sync_logs`: `IMAP_UNKNOWN: invalid peer certificate: NotValidForName` (desde 2026-09-15 21:30 UTC) y `IMAP_IMAP_AUTH_FAILED` (desde 2026-09-17 03:00 UTC).
- La configuración guardada en `integration_accounts.credentials` es `imap_host: mail.cemsacr.com`, `imap_port: 993`, `imap_secure: true`.
- La nueva alerta se añadiría en `check-sync-health` con código `mailbox_unreachable`, agrupando por empresa y proveedor, con auto-resolución cuando vuelva una lectura exitosa.
