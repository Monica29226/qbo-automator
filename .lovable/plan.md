# Plan de acción para dejar el sistema confiable al 100%

## Diagnóstico confirmado

Hoy no es solo un caso aislado de Terranova; hay problemas estructurales de estado y verificación:

- **Terranova:** ya se comprobó que de **219** facturas marcadas como publicadas, **193 no existen en QuickBooks**.
- **Global:** hay **8,848** documentos en estado `published` con `qbo_entity_id`.
- **Global:** hay **1,302** documentos marcados como publicados **sin fila de tracking**, o sea con trazabilidad incompleta.
- **Global:** hay **33** documentos en estado `pending` que **todavía conservan `qbo_entity_id`**, lo cual es inconsistente.
- El flujo actual cuenta como éxito casos que no deberían verse como “publicados” todavía.

## Causas raíz detectadas

1. **Se reporta éxito demasiado pronto**
   - El publicador incrementa el contador de `published` cuando `processDocument()` devuelve éxito, aunque el documento haya quedado en `review` por discrepancia post-publicación.

2. **El tracking viejo puede re-marcar como publicado sin verificación fuerte**
   - Si existe una fila previa en `qbo_publish_tracking`, el flujo puede volver a poner el documento como `published` usando ese `qbo_entity_id` sin reconfirmar que todavía exista en QuickBooks.

3. **La UI usa “publicada” como si significara “confirmada y visible en QuickBooks”**
   - Eso hoy no está blindado de punta a punta.

4. **La auditoría existe, pero es reactiva y manual**
   - Falta una reconciliación global automática por empresa para detectar huérfanas, borradas en QBO, discrepancias de monto/IVA y tracking incompleto.

5. **Hay estados de negocio ambiguos**
   - Hoy `published` mezcla al menos 3 realidades distintas:
     - creada y confirmada en QBO,
     - detectada como duplicado,
     - marcada internamente con ID histórico pero no necesariamente verificable hoy.

## Objetivo del cambio

Garantizar para **todas las empresas** que:

- el **XML sea la fuente absoluta de verdad**,
- el **total final sea idéntico al XML**,
- el **IVA quede registrado exactamente como lo dicta el XML**,
- **ningún documento vuelva a mostrarse como publicado si no está confirmado en QuickBooks**,
- el sistema tenga **auditoría global y reparación masiva** cuando algo quede inconsistente.

## Plan por fases

### Fase 1 — Contención inmediata

1. **Cambiar la semántica de estados y mensajes de éxito**
   - Dejar de mostrar “publicada” cuando solo hubo intento exitoso.
   - Separar visualmente:
     - `Enviada a QBO`
     - `Verificada en QBO`
     - `En revisión`
     - `Inconsistente`
     - `Pendiente de reenvío`

2. **Bloquear falsos positivos en toasts, paneles y contadores**
   - Si una factura termina en `review`, no debe sumarse a “éxito”.
   - Si viene de tracking histórico sin verificación actual, no debe verse como confirmada.

3. **Desactivar la confianza ciega en tracking histórico**
   - Antes de reutilizar un `qbo_entity_id` previo, reconfirmar que el Bill/VendorCredit exista realmente en QuickBooks.
   - Si no existe, pasar a inconsistencia/republicación, no a `published`.

### Fase 2 — Endurecer el publicador con validación estricta XML → QBO

1. **Confirmación fuerte post-creación**
   - Después de crear el Bill/VendorCredit, leerlo otra vez desde QuickBooks y validar:
     - existencia real,
     - total,
     - impuesto total,
     - tipo de entidad,
     - documento/consecutivo,
     - proveedor correcto.

2. **Promoción a “published” solo si pasa la validación completa**
   - Si falla cualquier chequeo, marcar `review` o `error`, nunca `published`.

3. **IVA exacto desde XML**
   - Mantener la lógica de IVA por línea como fuente de verdad.
   - Reforzar que el chequeo final compare **IVA XML vs IVA QBO** con tolerancia mínima y explícita.

4. **Persistencia coherente**
   - Alinear `processed_documents` y `qbo_publish_tracking` para que no queden:
     - `published` sin tracking,
     - `pending` con `qbo_entity_id`,
     - `review` con mensaje ambiguo.

### Fase 3 — Auditoría global de todas las empresas

1. **Ejecutar auditoría masiva tenant-wide**
   - Revisar organización por organización todas las facturas “publicadas” contra QuickBooks.

2. **Clasificar cada documento en categorías operativas**
   - Verificada OK
   - Huérfana / borrada en QBO
   - Monto distinto
   - IVA distinto
   - Tracking incompleto
   - Estado incoherente
   - No verificable por token/conexión

3. **Generar un reporte global accionable**
   - Resumen por empresa
   - Conteos por tipo de fallo
   - Listado exportable de documentos afectados

### Fase 4 — Reparación masiva segura

1. **Limpiar inconsistencias de estado**
   - Corregir documentos `pending` con `qbo_entity_id`.
   - Corregir documentos `published` sin tracking.
   - Corregir documentos cuyo tracking apunta a entidades inexistentes.

2. **Republicación controlada por lotes**
   - Reabrir solo documentos auditados como huérfanos o inconsistentes.
   - Republicar respetando exactamente XML, total e IVA.

3. **Verificación posterior obligatoria**
   - Cada lote republicado debe re-auditarse automáticamente antes de marcarlo como exitoso.

### Fase 5 — Monitoreo permanente y prevención

1. **Auditoría automática programada**
   - Revisar de forma periódica publicaciones recientes para detectar borrados o discrepancias.

2. **Alertas confiables**
   - Si QuickBooks no devuelve el documento o devuelve total/IVA distinto, levantar alerta crítica y sacar el documento de “published”.

3. **Panel de salud por empresa**
   - Mostrar por organización:
     - publicadas verificadas,
     - en revisión,
     - huérfanas,
     - pendientes de reparación,
     - fallos de conexión/token.

## Orden de ejecución recomendado

1. Corregir semántica de éxito/estado en backend y UI.
2. Blindar el publicador para que solo marque `published` con verificación real.
3. Ejecutar auditoría global de todas las empresas.
4. Entregarte reporte global por empresa.
5. Ejecutar republicación masiva por lotes con re-verificación automática.
6. Dejar monitoreo permanente para que no vuelva a pasar.

## Resultado esperado

Al terminar este plan:

- “Published” significará realmente **visible y confirmado en QuickBooks**.
- El sistema dejará de inventar éxito cuando hay discrepancias.
- El **XML seguirá mandando siempre** para montos e IVA.
- Tendremos un diagnóstico completo de **todas las empresas**, no solo Terranova.
- La reparación quedará hecha con trazabilidad y control.

## Detalles técnicos

- Habrá cambios en el flujo de publicación, tracking, auditoría y UI de estados.
- Haré una revisión de los edge functions de publicación/republicación/auditoría y de las pantallas que hoy muestran “publicado”.
- Probablemente se necesiten ajustes de esquema para separar mejor estados verificados vs inconsistentes y para registrar auditorías globales de forma confiable.
- La republicación de Terranova debe ejecutarse **después** de aplicar al menos la contención de la Fase 1, para no volver a producir falsos positivos.

Si apruebas este plan, lo implemento en ese orden y te entrego primero la **contención + auditoría global**, que es lo más urgente.