# Importar enero–agosto 2026 para Doral Overseas Corporation S.A.

## Situación verificada

- La empresa Doral Overseas Corporation S.A. (cédula 3101536816) se creó hoy, tiene QuickBooks y el
  buzón Gmail f@doraloverseascr.com conectados, y **0 documentos** en el sistema.
- El buzón quedó con fecha de arranque `04/09/2026 00:22`, por eso la importación automática solo
  trae correos nuevos y no ve nada del año.
- La importación por mes y año del buzón **ignora** esa fecha de arranque, así que sirve para traer
  historial sin tener que modificar la conexión.
- La empresa no tiene fecha de corte configurada, por lo que no hay nada que bloquee enero–agosto.

## Cómo se evita afectar a otras empresas y duplicar gastos

- Cada corrida de importación recibe el identificador de la empresa activa; los documentos se
  guardan y consultan siempre filtrados por empresa. Ninguna otra empresa se toca.
- El bloqueo de duplicados es por Clave electrónica de 50 dígitos junto con la empresa: si un
  comprobante ya existe, se omite. Además la lista de exclusión impide reimportar lo que usted
  haya borrado.
- Nada se envía a QuickBooks en esta carga: los comprobantes quedan pendientes de clasificación,
  como usted pidió.

## Trabajo a realizar

1. Ejecutar la importación del buzón mes por mes para Doral: enero, febrero, marzo, abril, mayo,
   junio, julio y agosto de 2026, esperando el cierre de cada mes antes del siguiente para no
   exceder los límites de recursos del proceso.
2. Después de cada mes, registrar: correos candidatos, XML encontrados, documentos creados,
   omitidos por duplicado y fallidos con su motivo. Sin maquillar: si un mes queda parcial, se
   reporta como parcial y se reintenta.
3. Verificar al final, con consulta a la base de datos, que para esta empresa no exista ninguna
   Clave repetida y que ningún documento haya quedado marcado como publicado sin identificador
   real de QuickBooks.
4. Entregar un resumen por mes con cantidad de comprobantes, monto total y cuántos quedan
   esperando clasificación de proveedor.

## Qué necesita hacer usted después

Revisar la lista de pendientes y asignar la cuenta de gasto a los proveedores nuevos. Una vez
asignadas, la publicación a QuickBooks se dispara con las reglas ya existentes.

## Detalles técnicos

- Función `gmail-fetch-invoices` invocada con `{ organization_id: '5e403346-…', month, year }`;
  ese modo construye la consulta `after:/before:` del mes y salta `sync_from`.
- El alta de documentos pasa por `process-document-xml`, que valida receptor, rechaza Tiquetes
  Electrónicos (04), respeta `ignored_documents` y deduplica por `doc_key` + `organization_id`.
- Sin cambios de código ni de esquema; es una operación de datos por empresa.

## Alternativa si el buzón no tiene el histórico completo

Si algún mes trae menos de lo esperado, la vía es la importación por lote del reporte de Hacienda
(claves) para ubicar los comprobantes faltantes uno por uno. Eso se decide con los resultados en
la mano, no antes.
