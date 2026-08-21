# 3101961861: facturas del 20 y 21 de agosto

## Lo que encontré (verificado en datos)

El correo **sí está entrando**: la sincronización de esta empresa corre cada 30 minutos y todas las
corridas del 20 y 21 de agosto terminaron en estado correcto (69 correos revisados, 0 fallidos, 0
errores de token). La conexión con QuickBooks está activa (realm 9341457306794244) y no hay claves en
la lista de exclusión ni fecha de corte configurada. Es decir, el problema no es el buzón.

Lo que sí está fallando es la **publicación**. Hay dos documentos atascados:

| Proveedor | Emitida | Estado | Monto |
|---|---|---|---|
| Intcomex Costa Rica Mayorista | 20/08/2026 | Publicada en QuickBooks (Id 107) | 1,198.13 |
| Distribuidora Los Ángeles de Mora | 20/08/2026 | Ingresada, sin llegar a QuickBooks | 17,004.00 |
| Correos de Costa Rica | 11/08/2026 (ingresó el 21) | Ingresada, sin llegar a QuickBooks | 6,679.00 |

Ambas atascadas tienen el mismo mensaje interno: *"Recuperado de estado intermedio publishing
(finally guard)"*. Eso significa que la publicación arrancó, el proceso se cortó a medio camino (la
función se quedó sin recursos) y el documento volvió a quedar pendiente. Ambas tienen cuenta de gasto
asignada (65 y 30), así que no les falta configuración: solo les falta un reintento que nunca
ocurrió. La última corrida que publicó algo fue a las 04:00 del 21 de agosto.

De la tercera factura que usted menciona no hay ningún rastro en el sistema, ni ingresada ni
descartada. Hay que buscarla directamente en el buzón por proveedor o por clave.

**No confirmado todavía:** por qué el reintento automático no volvió a tomar esos dos documentos, si
la sincronización sí incluye los pendientes. Verificarlo es el primer paso del plan, no una
suposición.

## Plan

1. **Diagnóstico del reintento (primero)**
   Revisar en los registros de la función de publicación qué pasó con esos dos documentos en las
   corridas posteriores a las 04:00: si no se reclamaron, si se reclamaron y se cortaron, o si el
   filtro de fecha mínima los excluye. Esto define la corrección exacta.

2. **Recuperar las dos facturas atascadas**
   Publicar Distribuidora Los Ángeles de Mora y Correos de Costa Rica respetando el XML: monto e IVA
   literales, sin recálculo, con XML y PDF adjuntos. Si QuickBooks rechaza algo, queda como error
   visible con el motivo, nunca como "publicada".

3. **Buscar la tercera factura**
   Búsqueda dirigida en el buzón de los días 20 y 21 (todas las carpetas, no solo Entrada) para
   ubicarla e ingresarla. Si el correo no existe, se lo reporto explícitamente como "nunca recibida"
   en lugar de dejarlo ambiguo.

4. **Que no se repita: reintento garantizado**
   - Un documento que quedó en "publishing" y fue recuperado se marca con contador de reintentos y
     se vuelve a tomar en la siguiente corrida, con prioridad sobre los nuevos.
   - Cortar el lote por tiempo y tamaño antes de que la función se quede sin recursos, para que el
     corte sea ordenado y no deje documentos en limbo.

5. **Visibilidad en el panel**
   Tarjeta en el panel de esta y todas las empresas: "ingresadas sin llegar a QuickBooks", con
   antigüedad del documento más viejo. Hoy esos dos documentos existían sin ninguna señal en
   pantalla, por eso pasaron horas sin que nadie lo notara.

## Detalles técnicos

- Documentos afectados: claves `...00100015010000008333` (Los Ángeles de Mora) y
  `...00100202010000091663` (Correos), organización `1ff1c915` (3101961861).
- El guard de `publish-to-quickbooks` devuelve el documento a `processed` al abortar, pero no deja
  marca de "pendiente de reintento"; se añadirá `retry_count` y un motivo estable
  (`aborted_worker_limit`) para poder reclamarlos con prioridad vía
  `claim_documents_for_qbo_publish`.
- Se revisa el filtro `_min_issue_date` del claim por si excluye documentos emitidos días antes.
- Se mantiene la invariante: `status='published'` solo con `qbo_entity_id` real y `qbo_realm_id`
  registrado.
- El cambio de reintento y la tarjeta de visibilidad aplican a todas las empresas, no solo a esta.
