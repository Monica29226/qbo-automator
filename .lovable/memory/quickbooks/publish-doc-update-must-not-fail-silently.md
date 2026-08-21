---
name: Publish update must not fail silently
description: processed_documents.qbo_realm_id existía en el código pero no en la base, y toda actualización post-publicación fallaba en silencio dejando facturas "no publicadas" aunque el Bill sí existía en QuickBooks
type: feature
---

Causa raíz histórica (21/08/2026): `publish-to-quickbooks` actualizaba
`processed_documents` con `qbo_realm_id`, columna que NO existía en la base. PostgREST
rechazaba TODA la actualización, así que el Bill quedaba creado en QuickBooks pero el
documento se quedaba en `processed` sin `qbo_entity_id`, y en cada corrida siguiente se
reportaba como "duplicado omitido".

Reglas:
- La columna `processed_documents.qbo_realm_id` debe existir siempre; cada documento
  publicado guarda el realm de la compañía QBO.
- Toda actualización que marca un documento como publicado debe revisar el error de la
  respuesta, registrarlo en el log y reintentar con campos mínimos. Nunca ignorar el error.
- Reparación: si `qbo_publish_tracking.status='published'` con `qbo_entity_id`, el
  documento correspondiente debe reflejar ese ID y estado.
