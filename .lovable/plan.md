# Diagnóstico y plan de corrección

## Hallazgos principales

1. **El botón “Importar Lote” del dashboard no usa el flujo nuevo `batch-import-v2`.**
   - El dashboard llama a `ImportBatchDialog`.
   - `ImportBatchDialog` ejecuta `hostinger-fetch-invoices` / `bluehost-fetch-invoices`.
   - El arreglo reciente en `batch-import-process` solo aplica a `/admin/batch-import-v2`, no al botón principal que estás usando.

2. **El importador de Hostinger está limitado por lotes pequeños y el botón manual no recuerda el avance entre clics.**
   - `hostinger-fetch-invoices` procesa solo **10 correos por ejecución**.
   - `ImportBatchDialog` corta en **máximo 20 iteraciones**.
   - Eso significa que un clic puede recorrer como máximo **200 correos**.
   - En logs reales de Terranoa hay **514 correos** en el rango, así que una parte del mes puede quedar sin recorrer aunque no haya error visible.

3. **No hay cursor persistente para el botón manual del dashboard.**
   - El sistema sí tiene lógica de reanudación en `auto-sync-invoices` y `recover-org-backlog`.
   - Pero `ImportBatchDialog` no guarda ni reutiliza ese cursor.
   - Resultado: el usuario siente que “no sube” porque el flujo manual no garantiza terminar el backlog completo de Hostinger.

4. **El flujo actual oculta rechazos válidos y por eso parece un fallo silencioso.**
   - `hostinger-fetch-invoices` descarta XML de Hacienda/MensajeReceptor y otros rechazos suaves sin mostrarlos en detalle al usuario.
   - `ImportBatchDialog` solo resume: nuevas, existentes, sin PDF y errores.
   - No expone razones como receptor incorrecto, fuera de rango, duplicada, XML no facturable, etc.

5. **El backend sí está funcionando; el problema es de flujo y visibilidad.**
   - La nube está sana.
   - Hostinger está conectado para Terranoa.
   - En la base ya existen **20 documentos de mayo 2026** para Terranoa:
     - **15 published**
     - **5 review**
   - También vi ejecuciones reales de Hostinger avanzando hasta `skip_count=510` y procesando los últimos correos.

6. **No hay evidencia de que el botón del dashboard esté creando reportes de lote trazables.**
   - `batch_imports` está vacío.
   - Confirma que el flujo que usa el dashboard no deja la trazabilidad rica que sí tiene `batch-import-v2`.

## Qué voy a implementar

1. **Unificar el botón “Importar Lote” con el flujo trazable.**
   - Hacer que el flujo principal deje detalle auditable por factura.
   - Evitar que el arreglo quede dividido entre dos importadores distintos.

2. **Agregar reanudación real para Hostinger/Bluehost en el flujo manual.**
   - Guardar `skip_count` por organización.
   - Reanudar automáticamente en el siguiente clic o continuar dentro del mismo proceso hasta vaciar el rango.
   - Cerrar el mes completo, no solo una ventana parcial de correos.

3. **Eliminar el falso “sin error pero no sube”.**
   - Mostrar contadores separados para:
     - procesadas
     - duplicadas
     - rechazadas por reglas
     - faltantes de PDF
     - pendientes de configuración
   - Exponer motivo por factura, no solo total agregado.

4. **Mejorar la UI del modal de importación.**
   - Mostrar si el proceso quedó parcial.
   - Mostrar cuántos correos faltan por recorrer.
   - Mostrar si el sistema reanudará desde un cursor previo.
   - Permitir descargar detalle CSV o ver tabla resumida.

5. **Alinear las reglas del importador por correo con el pipeline XML estándar.**
   - Mantener la validación real en `process-document-xml`.
   - Hacer que el resumen del importador refleje exactamente los rechazos y omisiones de ese pipeline.

6. **Validar específicamente mayo para Terranoa.**
   - Probar el flujo con Terranoa y el rango de mayo 2026.
   - Confirmar que recorre el backlog completo y que el usuario puede identificar qué faltó y por qué.

## Resultado esperado

- Un clic en **Importar Lote** ya no dará la impresión de que “no hace nada”.
- Si faltan facturas, el sistema mostrará si fue por:
  - backlog no terminado,
  - duplicado,
  - XML no facturable,
  - receptor incorrecto,
  - fuera de rango,
  - pendiente de configuración,
  - u otro rechazo real.
- Terranoa podrá cerrar mayo con trazabilidad clara.

## Detalles técnicos

- **UI involucrada:** `src/components/dashboard/ImportBatchDialog.tsx`
- **Funciones involucradas:**
  - `supabase/functions/hostinger-fetch-invoices/index.ts`
  - `supabase/functions/bluehost-fetch-invoices/index.ts`
  - `supabase/functions/process-document-xml/index.ts`
- **Observación crítica:** el fix previo en `batch-import-process` no impacta el botón del dashboard porque ese botón usa otro backend.
- **Dato real observado:** Terranoa tiene 514 correos en el rango inspeccionado y el importador Hostinger procesa 10 por ejecución; el modal manual corta a 20 iteraciones.

## Validación al terminar

1. Ejecutar importación manual de mayo con Terranoa.
2. Confirmar que el flujo completa todo el rango o deja cursor persistido para continuar sin perder avance.
3. Confirmar que el resumen diferencia procesadas, omitidas y rechazadas con motivo.
4. Verificar documentos creados de mayo y sus estados finales en base de datos.
5. Confirmarte explícitamente si mayo queda completo o qué consecutivos siguen faltando.