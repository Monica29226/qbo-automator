# Skill: Garantizar que toda factura tenga PDF y se adjunte a QuickBooks

## Cuándo usar este skill
Cuando se quiera que los Bills/Invoices en QuickBooks **siempre** lleven adjunto el PDF (y el XML), incluyendo facturas que llegaron solo como XML (típico por IMAP: Bluehost/Hostinger, y Outlook).

## Estado actual (qué ya existe)
- Los fetchers de correo emparejan XML↔PDF por nombre y guardan `pdf_attachment_url` cuando el correo trae ambos.
- `publish-to-quickbooks` adjunta XML + PDF al Bill cuando existen (función `attachFileToQuickBooks`).
- `download-missing-pdf` recupera PDFs faltantes **solo desde Gmail** (busca por número de documento). NO sirve para IMAP ni Outlook.
- **NO existe** generación de PDF a partir del XML.

## El problema
Si el correo trajo solo XML (frecuente en IMAP/Outlook), no hay PDF y `download-missing-pdf` no lo recupera → el Bill queda sin PDF.

## Estrategia objetivo: "PDF garantizado" (cascada)
Para cada factura, asegurar un PDF en este orden:
1. **Del correo**: si ya hay `pdf_attachment_url`, usarlo.
2. **Descargar**: si la fuente es Gmail, intentar `download-missing-pdf`.
3. **Generar desde el XML** (NUEVO, es la pieza que falta y la que garantiza el 100%): crear una **representación gráfica** del comprobante a partir del XML (datos del emisor/receptor, clave, consecutivo, líneas, impuestos, totales) y guardarla como PDF en storage; setear `pdf_attachment_url`.
4. Adjuntar SIEMPRE XML + PDF al publicar.

## Cómo construir la generación de PDF desde XML
- En una edge function Deno: parsear los campos del XML (reusar los helpers de `process-document-xml`) y renderizar un PDF simple pero completo.
- Opciones de librería compatibles con Deno/edge: `pdf-lib` (https://esm.sh/pdf-lib) para componer el PDF, o generar HTML y convertirlo. Mantenerlo liviano (1 página): encabezado con emisor/receptor, Clave (50) y Consecutivo, fecha, tabla de líneas (detalle, cantidad, precio, impuesto), y totales (subtotal, IVA, total). Marcar "Representación gráfica generada a partir del XML".
- Guardar el PDF en el bucket `company-documents` bajo `${organization_id}/pdf/${clave}.pdf` y actualizar `processed_documents.pdf_attachment_url`.
- Hacerlo idempotente (si ya existe PDF, no regenerar) y multi-empresa (scope por organization_id).

## Dónde engancharlo
- Al ingerir (en `process-document-xml` o justo después): si no hay PDF, generar la representación gráfica.
- Batch para el histórico: una función/botón que recorra documentos sin `pdf_attachment_url` y les genere el PDF (por empresa).
- Antes de publicar: si sigue sin PDF, generar al vuelo para que el adjunto nunca falte.

## Reglas
- Multi-empresa: scope por `organization_id`; nunca mezclar PDFs entre empresas.
- No bloquear la publicación si la generación del PDF falla: adjuntar al menos el XML y registrar aviso (no tragar el error).
- El XML es el documento fiscal; el PDF es representación. Siempre adjuntar ambos.

## Definición de "hecho"
- Una factura que llegó solo como XML termina con un PDF generado y, al publicarse, el Bill en QuickBooks muestra XML + PDF adjuntos.
- Funciona para cualquier fuente (Gmail, Outlook, IMAP, carga manual) y cualquier empresa.
