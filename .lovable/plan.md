# Publicación forzada: respetar total e IVA del XML y adjuntar el PDF

## Qué pasa hoy

La función de publicación forzada (`force-publish-document`) crea el Bill o VendorCredit en
QuickBooks y lo marca como publicado de inmediato:

- No compara el total ni el IVA que devolvió QuickBooks contra el XML. El publicador normal
  (`publish-to-quickbooks`) sí lo hace: si el total difiere más de ₡1 deja el documento en
  revisión y registra una alerta. La forzada no tiene ese control.
- No adjunta ni el PDF ni el XML al documento creado. El publicador normal usa la API
  Attachable de QuickBooks para subir ambos; la forzada omite ese paso por completo.
- No guarda `qbo_realm_id`, así que no queda registro de a cuál compañía de QuickBooks se envió.

Por eso una factura forzada aparece en QuickBooks sin respaldo visible y sin verificación de montos.

## Qué se va a hacer

1. **Verificación de total e IVA después de crear el documento**
   Al recibir la respuesta de QuickBooks se compara `TotalAmt` y `TxnTaxDetail.TotalTax`
   contra `total_amount` y `total_tax` del XML.
   - Diferencia de total mayor a ₡1: el documento queda en estado `review` con el detalle de
     la diferencia y se registra la alerta `qbo_total_mismatch`, igual que en el flujo normal.
     No se reporta como éxito.
   - Diferencia solo en IVA: se publica pero se registra la alerta de advertencia.
   Los montos siguen tomándose literales del XML; no se recalcula nada.

2. **Adjuntar PDF y XML al documento de QuickBooks**
   Se reutiliza la misma lógica de adjuntos del publicador normal (multipart a
   `/v3/company/{realm}/upload`), subiendo primero el XML y luego el PDF desde el
   almacenamiento privado. El resultado de cada adjunto se informa en la respuesta.
   Si el documento no tiene `pdf_attachment_url`, se indica explícitamente como
   "PDF no disponible" en lugar de dar por hecho que se adjuntó.

3. **Registrar el realm**
   Se guarda `qbo_realm_id` en `processed_documents` al publicar forzadamente.

4. **Respuesta al usuario**
   La confirmación en pantalla indicará: ID creado en QuickBooks, total e IVA verificados
   contra el XML, y si el PDF y el XML quedaron adjuntos.

## Detalle técnico

- Archivo principal: `supabase/functions/force-publish-document/index.ts`.
- Se extrae la función de adjuntos a un helper compartido (`_shared/qbo-attachments.ts`)
  para que la forzada y el publicador normal usen el mismo código, sin cambiar el
  comportamiento del publicador normal.
- La verificación se hace con los mismos umbrales que ya usa `publish-to-quickbooks`
  (₡1 en total, ₡1 en IVA) para no introducir criterios nuevos.
- En `src/pages/ErrorDocuments.tsx` solo se ajusta el mensaje de resultado del forzado
  para reflejar verificación y adjuntos; el visor de PDF ya existente no cambia.
- Después del despliegue se prueba con un documento real en error y se reporta el
  resultado (ID, totales comparados, adjuntos).
