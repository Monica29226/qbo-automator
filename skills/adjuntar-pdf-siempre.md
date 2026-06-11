# Skill: Adjuntar el PDF (y XML) existente a QuickBooks — NUNCA recrearlo

## Cuándo usar este skill
Cuando se quiera que los Bills/Invoices en QuickBooks lleven adjunto el **PDF real** de la factura (y el XML). Todas las facturas YA tienen su PDF guardado; el trabajo es adjuntar el que existe, no generar ninguno.

## Regla dura
- **PROHIBIDO generar/recrear PDFs** ni "representaciones gráficas". Se adjunta el PDF original tal cual llegó (en `pdf_attachment_url`). Si por algún caso no hubiera PDF, NO inventar uno: registrar el caso y adjuntar al menos el XML.

## Estado actual
- Los fetchers de correo guardan el PDF real en storage y setean `processed_documents.pdf_attachment_url`.
- `publish-to-quickbooks` adjunta XML + PDF al crear el Bill (función `attachFileToQuickBooks`), bajando el archivo desde storage (`company-documents`).
- El adjunto es **no bloqueante**: si falla, el Bill se crea igual y solo se loguea el aviso.

## Posibles causas de que el PDF no aparezca en QBO (revisar en este orden)
1. **El Bill se publicó ANTES de que existiera el adjunto** → no hay backfill que vuelva a adjuntarle el PDF. (Causa más probable para facturas históricas.)
2. El adjunto falló en silencio (descarga de storage o subida a QBO) y, al ser no bloqueante, nadie se enteró → revisar logs de `publish-to-quickbooks` por "attachment failed/error".
3. `pdf_attachment_url` venía nulo en ese documento puntual.

## Qué construir/operar
1. **Backfill de adjuntos** (lo que falta): función + botón que recorra `processed_documents` ya publicados (`status='published'`, `qbo_entity_id` no nulo) que tengan `pdf_attachment_url` y **adjunten el PDF (y XML) existente** a su Bill en QuickBooks, sin recrear nada. Idempotente (no duplicar el adjunto si ya está), por empresa (`organization_id`), respetando el `realm_id`.
2. **Visibilidad**: que un fallo de adjunto quede registrado (no silenciado) y se pueda reintentar.

## Reglas
- Multi-empresa: scope por `organization_id` y usar el `realm_id` correcto.
- Adjuntar SIEMPRE ambos: XML (documento fiscal) y PDF (representación original).
- Nunca recrear el PDF. Si falta, reportar — no inventar.

## Definición de "hecho"
- Las facturas ya publicadas muestran su PDF y XML reales adjuntos en QuickBooks.
- Las nuevas publican con ambos adjuntos automáticamente.
- Funciona para cualquier empresa y cualquier fuente (Gmail, Outlook, IMAP, carga manual).
