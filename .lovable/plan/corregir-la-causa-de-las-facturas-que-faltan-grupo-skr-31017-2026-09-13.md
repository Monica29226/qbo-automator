# Corregir la causa de las facturas que faltan (Grupo SKR 3101733456 y demás empresas)

## Lo que encontramos

La búsqueda puntual de facturas ya quedó arreglada: decía "no hay correo conectado" porque leía la tabla de integraciones sin permiso; ahora usa la consulta segura. El correo de esta empresa sí está conectado (Gmail activo).

Pero eso no explicaba las facturas faltantes. Revisando los datos:

- La empresa 3101733456 tiene 19 facturas, y la más reciente es del **24 de agosto de 2026**. Nada después de esa fecha.
- La revisión automática de correo corre unas 48 veces por día para esta empresa desde el 25 de agosto: encuentra correos (45 a 68 por día) y procesa **0**.
- La marca interna que indica "por dónde seguí leyendo el buzón" quedó congelada en el mensaje número 250 desde el 24 de agosto. Cada corrida vuelve a leer solo ese mismo mensaje viejo y nunca regresa al inicio del buzón, que es justo donde llegan las facturas nuevas.
- La misma marca quedó congelada el 24 de agosto en **19 empresas**, no solo en esta.

En resumen: el sistema quedó leyendo eternamente el final del buzón y dejó de ver los correos nuevos de todas las empresas con Gmail.

## Qué se va a corregir

1. **Desbloquear la lectura del buzón.** La condición que decide "todavía queda pendiente" se cumple siempre por cómo se limita la búsqueda, así que la marca nunca vuelve a cero. Se corrige para que:
   - Cada corrida lea primero los correos **más recientes**.
   - La marca de avance solo se use mientras haya un atraso real y se reinicie sola cuando se llega al final del tramo leído.
   - Si la marca lleva demasiado tiempo sin cambiar, se reinicia automáticamente y queda registrado.
2. **Reiniciar las marcas congeladas** de las 19 empresas afectadas, para que la próxima corrida arranque desde los correos nuevos.
3. **Recuperar el atraso del 24 de agosto a hoy** en la empresa 3101733456 y luego en el resto: se importa desde los XML del correo, sin inventar montos y sin duplicar (la clave de 50 dígitos sigue siendo el control). No se altera nada de lo ya publicado en QuickBooks.
4. **Aviso cuando esto vuelva a pasar:** si una empresa lleva varios días encontrando correos y procesando cero, se genera alerta. Hoy el sistema no avisaba nada de esto.

## Detalles técnicos

- `supabase/functions/gmail-fetch-invoices/index.ts`: `backlogPending` usa `moreInList || !!nextPageToken`, pero `paginationCap = resumeCursor + GMAIL_BATCH_SIZE` garantiza que `nextPageToken` exista siempre, por lo que `cursorValue` nunca vuelve a 0. Se separa "hay más páginas dentro del cap" de "hay atraso real", se agrega tope de antigüedad del cursor y se registra el reinicio en `sync_logs`.
- Reset de `system_settings` con `key like 'gmail_resume_cursor_%'` a `0` (las claves con sufijo de período histórico también).
- Recuperación por lotes invocando la función con rango de fechas acotado (25 de agosto a hoy) por empresa, sin publicar automáticamente lo que requiera reglas de proveedor.
- Chequeo nuevo en `check-sync-health`: `gmail_fetched > 0` y `gmail_processed = 0` sostenido ≥ 2 días genera alerta por empresa.

## Fuera de alcance

No se modifica la publicación a QuickBooks, ni los montos e IVA tomados del XML, ni los cortes de fecha por empresa.
