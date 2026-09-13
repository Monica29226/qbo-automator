# Por qué no llegaron las facturas de Grupo SKR (cédula 3-101-733456)

## Qué muestran los registros

El correo `administrativo@gruposkr.com` sí quedó conectado y el sistema lo revisó cada 30 minutos
sin fallar. El problema no fue la conexión: fue que la lectura se quedó atascada en el mismo punto.

- Hasta el 24 de agosto de 2026 la lectura terminaba normal y las facturas entraban.
- Desde el 24 de agosto hasta hoy, cada revisión terminó marcada como "parcial: queda correo
  pendiente" y registró **cero facturas ingresadas**, unas 48 revisiones por día durante 20 días.
- Ese día también hubo una caída del proceso de lectura (arranque fallido), que fue lo que dejó
  la marca de avance congelada.
- Resultado en el registro de documentos: 2 facturas el 24 de agosto y ninguna entre el 25 de
  agosto y el 12 de septiembre.

La causa: la marca que indica "por dónde seguí leyendo" nunca se reinició. Como el correo se lista
de lo más nuevo a lo más viejo, el sistema volvía siempre al mismo tramo viejo y nunca miraba los
correos nuevos.

## Estado hoy

La marca de avance ya se corrigió y se reinició esta mañana. En el drenaje de hoy entraron
**62 facturas** con fechas de emisión entre el 2 de agosto y el 12 de septiembre de 2026, y
**31 quedaron en revisión** esperando que ustedes asignen la cuenta de gasto de cada proveedor.
Ninguna se publicó sola en QuickBooks.

## Lo que propongo construir para que no vuelva a pasar

1. **Alerta de buzón atascado.** Si durante 24 horas el sistema encuentra correos pero no ingresa
   ni una factura, se envía el aviso por correo con el nombre de la empresa y el buzón afectado,
   y se muestra en el panel de alertas. Hoy esa situación se podía sostener 20 días en silencio.
2. **Reinicio automático de la marca de avance.** Si la marca lleva más de 6 horas sin moverse, la
   siguiente lectura arranca desde los correos más nuevos en vez de quedarse en el tramo viejo.
3. **Drenaje del atraso sin intervención.** Cuando queda correo pendiente, la lectura se vuelve a
   encolar sola hasta terminar, en lugar de esperar el siguiente turno de media hora.
4. **Verificación del rango completo.** Reviso que no falte ninguna factura entre el 24 de agosto y
   hoy comparando los correos con archivo XML contra las facturas ingresadas, y le reporto la
   diferencia exacta si aparece alguna.

## Detalle técnico

- Función afectada: `gmail-fetch-invoices`; la marca vive en `system_settings`
  (`gmail_resume_cursor_<org>`), hoy en `0`.
- La alerta se agrega a `check-sync-health`: condición `gmail_fetched > 0 AND gmail_processed = 0`
  sostenida en `sync_logs` durante 24 h por organización, registrada en `alert_history` con
  auto-resolución cuando vuelve a ingresar al menos una factura.
- El reinicio por antigüedad y el reencolado del atraso ya están implementados en
  `gmail-fetch-invoices`; falta extender la misma lógica a los buzones IMAP
  (Hostinger/Bluehost/Outlook) para que el atraso no dependa del cron.
- La verificación del rango se hace contra los mensajes con adjunto XML y `doc_key` de 50 dígitos,
  sin volver a publicar nada en QuickBooks.
