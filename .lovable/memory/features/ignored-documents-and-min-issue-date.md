---
name: Lista de exclusión y fecha de corte por empresa
description: Borrar una factura la registra en ignored_documents por clave de 50; process-document-xml respeta esa lista y validation_min_date
type: feature
---
- Tabla `ignored_documents` (organization_id + doc_key de 50, único). Eliminar una factura desde la UI
  (individual o masiva) primero registra su clave ahí y luego borra el documento: helper
  `src/lib/discardInvoices.ts` → `discardDocuments(ids)`.
- `process-document-xml` rechaza con `reason: 'ignored_by_user'` cualquier clave presente en la lista,
  antes de la detección de duplicados. Así borrar significa ignorar, no olvidar.
- `system_settings.validation_min_date` por empresa: la ingesta rechaza con `before_min_issue_date`
  todo comprobante cuya FechaEmisión sea anterior. CIRENAS quedó en 2026-07-01.
- Motivo: al borrar, la clave desaparecía y el correo (Gmail `newer_than:90d`) reimportaba la factura.
