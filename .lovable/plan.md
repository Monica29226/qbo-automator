## Objetivo
Corregir el problema que hace que algunas compañías publiquen en contabilidad con IVA agregado incorrectamente, y reforzar el dashboard para que las alertas de correo/token reflejen de forma confiable el estado automático real.

## Hallazgos confirmados
- El caso de **Tree of Life / factura 00100001010000000398** sí reproduce el problema.
- En la base, el XML y el documento procesado guardan el total correcto: **457,650.00** con impuesto **52,650.00**.
- El total inflado que llega a contabilidad (**517,144.50**) ocurre por configuración de publicación de esa organización:
  - `default_uses_tax = false`
  - `tax_handling = included_in_line_items`
- Esa combinación hace que el publicador arme líneas con IVA incluido, pero en QuickBooks el resultado final termina variando por compañía según cómo esa cuenta tenga configurados sus códigos/tasas de impuesto.
- No es un problema del XML; es un problema de cómo se interpreta por organización al publicar.
- Hoy solo encontré dos organizaciones con una configuración especial que puede causar este comportamiento:
  - Tree of Life
  - ASOCIACION DESTINY PROYECT
- Las alertas actuales de correo/token son limitadas:
  - QuickBooks muestra solo casos críticos cercanos a expiración.
  - Correo solo detecta desconexión o credenciales incompletas.
  - El dashboard no muestra claramente “última renovación automática exitosa” ni un estado verificable de auto-actualización.

## Plan de implementación
1. **Unificar la regla de publicación para respetar literal el XML**
   - Ajustar `publish-to-quickbooks` para que, en facturas XML con impuesto, nunca dependa de una combinación ambigua por organización que permita a QuickBooks recalcular encima.
   - Hacer que la publicación priorice el total del XML como fuente absoluta y bloquee configuraciones que generen un total distinto.
   - Mantener la excepción solo cuando realmente se trate de un modo contable explícito y seguro, sin permitir que termine inflando el total.

2. **Eliminar la variación peligrosa por compañía**
   - Revisar la lógica que mezcla `tax_handling` y `default_uses_tax`.
   - Convertirla en una decisión determinística y auditada para compras:
     - o IVA separado y total exacto del XML,
     - o gasto incluido sin recálculo adicional de QuickBooks.
   - Evitar que una organización quede en un estado híbrido que produzca un total distinto al XML.

3. **Agregar validación dura antes de publicar**
   - Si el payload esperado para QuickBooks no cuadra exactamente con `totalComprobante` del XML, detener la publicación con error claro en vez de enviar algo ambiguo.
   - Registrar mejor el motivo para que se vea cuál configuración causó el bloqueo.

4. **Mejorar alertas automáticas en dashboard**
   - Añadir señal visible para renovación automática de token de QuickBooks.
   - Añadir señal visible para estado de conexión/credenciales del correo con refresco periódico y mensajes más concretos.
   - Evitar que el usuario tenga que “adivinar” si sí se renovó o si solo no hay alerta crítica.

5. **Auditoría focalizada del caso Tree of Life**
   - Dejar trazabilidad más clara del modo fiscal usado en la publicación de cada documento.
   - Preparar el caso para que futuras diferencias por compañía se puedan detectar rápido desde el sistema, sin depender de screenshots de contabilidad.

## Archivos a tocar
- `supabase/functions/publish-to-quickbooks/index.ts`
- `src/components/dashboard/QuickBooksTokenAlert.tsx`
- `src/components/dashboard/GmailTokenAlert.tsx`
- Posiblemente `src/pages/Dashboard.tsx` si hace falta exponer el nuevo estado en la vista principal.

## Resultado esperado
- La factura de Tree of Life y las equivalentes en otras compañías respetarán literalmente el total del XML.
- El comportamiento dejará de depender peligrosamente de la configuración particular de cada compañía.
- El dashboard mostrará mejor cuándo correo y token se están actualizando automáticamente y cuándo realmente hay una falla.