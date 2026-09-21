# Que los avisos del sistema le lleguen de verdad

## Qué está pasando hoy

El sistema **sí** detecta los problemas, pero los avisos casi nunca salen por correo:

1. **Los correos se envían desde una dirección no autorizada.** El remitente configurado es
   `alertas@aureoncr.com`, que no está verificado, así que el envío se rechaza. Solo quedan
   verificados `dashboard.aclcostarica.com` y `planillas.aclcostarica.com`.
2. **El respaldo tampoco entrega.** Cuando el envío principal falla, se reintenta con la dirección
   de prueba del proveedor, que solo puede escribirle al dueño de la cuenta, y con un destinatario
   de respaldo que está vacío.
3. **Usted no está en la lista.** Todas las empresas tienen como correo de avisos
   `david@aclcostarica.com`; ninguna tiene `monica@aclcostarica.com`.
4. **Solo un correo cada 12 horas por empresa**, aunque aparezcan problemas nuevos distintos.
5. **El tablero está inundado.** Hay 1.092 avisos abiertos, entre ellos 675 repeticiones del mismo
   problema de descuadre con QuickBooks y 94 de atraso de buzón, algunos desde junio. Con ese
   ruido, un problema nuevo y grave pasa desapercibido.

Números actuales: de ~7.000 avisos generados en 30 días, apenas 23 llegaron a generar un correo.

## Qué voy a hacer

1. **Remitente válido:** enviar desde `alertas@dashboard.aclcostarica.com` (dominio ya verificado),
   y si un envío se rechaza, registrar el motivo real en el historial en vez de fallar en silencio.
2. **Destinatarios:** `monica@aclcostarica.com` en todas las empresas, más el correo de avisos que
   cada empresa ya tenga. Queda editable desde la pantalla de configuración de la empresa.
3. **Aviso inmediato para todo problema nuevo:** en cuanto aparece un problema que no estaba
   abierto, sale el correo. No se reenvía mientras el mismo problema siga abierto; si se resuelve y
   vuelve a aparecer, se avisa otra vez. Así recibe todo sin repeticiones.
4. **Correo de cierre:** cuando un problema grave se resuelve, un aviso corto de "ya quedó".
5. **Limpieza del tablero:** un solo aviso abierto por problema y por empresa; cerrar las
   repeticiones históricas para que la lista quede legible.
6. **Prueba real:** provoco un aviso de prueba y confirmo la entrega antes de darle por terminado.

El correo lleva el nombre de la empresa, qué pasó, desde cuándo y el enlace a la pantalla donde se
arregla. Formato ACL, sin emoji, en español formal.

## Detalles técnicos

- `check-sync-health`: remitente `alertas@dashboard.aclcostarica.com`; reemplazar la ventana
  anti-spam de 12 h por envío disparado al **insertar** un `alert_history` nuevo (código no abierto
  previamente para esa organización); envío de cierre al marcar `resolved = true` en un crítico;
  guardar `email_error` cuando Resend devuelva no-2xx.
- `daily-import-health-report`: mismo remitente verificado (hoy usa `onboarding@resend.dev`).
- Migración: `system_settings` `alert_email` = lista con `monica@aclcostarica.com` para todas las
  organizaciones activas (respetando el valor existente como destinatario adicional);
  índice único parcial sobre `(organization_id, code)` para `alert_history` no resueltos y cierre
  de los duplicados históricos (`qbo_total_mismatch`, `mail_backlog_suspected`,
  `processed_not_published`, etc.).
- `connection-watchdog`: alinear remitente y destinatarios con lo anterior.
- Verificación: ejecutar `check-sync-health`, revisar `alert_history.email_id` poblado y confirmar
  que el conteo de avisos abiertos baja a uno por código y empresa.
