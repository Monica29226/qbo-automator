# Menos correos: un solo aviso diario y solo si es grave

Hoy el sistema le manda correos desde varios lugares distintos (revisiones cada hora, recordatorios de conexión, reporte diario de importación, resumen al terminar una importación). Eso es el ruido. Queda un único canal de correo automático.

## Qué le va a llegar después del cambio

Un solo correo al día, y **solo** si hay algo que impide que entren o se publiquen facturas:

- un buzón de correo que no se puede abrir (por ejemplo el de Centro Médico San Antonio),
- QuickBooks desconectado o con el permiso vencido en alguna empresa,
- una empresa que lleva días sin que entre ninguna factura cuando antes sí entraban.

Un solo correo para todas las empresas, con la lista de lo grave. Si no hay nada grave, no llega correo. Nada de recordatorios cada hora, ni reportes "todo bien", ni avisos de diferencias de totales o de facturas pendientes de clasificar: eso se sigue viendo en el panel.

## Qué se mantiene igual

Los correos que usted provoca: invitar a un usuario, correo de bienvenida, restablecer contraseña y enviar una factura por correo. Esos siguen funcionando.

Los problemas se siguen detectando y registrando igual que hoy; lo único que cambia es cuánto se le escribe. El panel sigue mostrando el estado de cada buzón, las alertas abiertas y los pendientes.

## Detalle técnico

- Se apaga el envío de correo en: `check-system-health`, `check-sync-health`, `connection-watchdog` y `batch-import-finalize`. Siguen calculando y guardando en `alert_history` (incluida la resolución automática), pero sin llamar a Resend.
- `daily-import-health-report` (cron `0 13 * * *`) pasa a ser el único emisor. Lee `alert_history` con `resolved = false` y filtra a los códigos críticos: `mailbox_unreachable`, `mailbox_cursor_stuck`, `qbo_disconnected`, `qbo_token_stale`, `no_recent_invoices`. Si no hay ninguno, termina sin enviar.
- Un solo correo consolidado a `monica@aclcostarica.com`, agrupado por empresa, desde `alertas@aclcostarica.com` (dominio verificado). Se elimina el envío por empresa.
- Se quita el cron horario de correo de `connection-watchdog` si su única salida era el correo; la función se mantiene para actualizar estado.
- Se despliegan las funciones tocadas y se hace una corrida de prueba de `daily-import-health-report` para confirmar que produce un único correo con lo grave de hoy (buzón de CEMSA) y nada más.
