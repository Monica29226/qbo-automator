# Skill: Publicar a QuickBooks de forma segura (gastos e ingresos)

## Cuándo usar este skill
Siempre que se vaya a **crear, modificar o depurar** cualquier código del camino de publicación a QuickBooks (Bills, VendorCredits o Invoices): `publish-to-quickbooks`, `publish-sales-to-quickbooks`, `republish-*`, `force-publish-document`, `retry-*`, o flujos que cambien el `status` a `published`.

## Invariantes que NUNCA se pueden romper
1. **"Published" implica ID real.** Jamás poner `status = 'published'` si QuickBooks no devolvió un `Id`. Un documento `published` SIEMPRE debe tener `qbo_entity_id` no nulo. (Bug histórico: "facturas fantasma" marcadas publicadas sin ID, invisibles para la auditoría.)
2. **Tagear la compañía.** Guardar `qbo_realm_id` (la compañía QBO a la que se envió) en cada documento publicado. Sin esto no se puede saber si un Bill "desapareció" porque cambió la empresa conectada.
3. **Confirmar antes de cantar victoria.** Leer el `Id` de la respuesta de QBO. Si la respuesta no trae entidad/Id, es ERROR, no éxito. Nada de toasts de éxito optimistas.
4. **Adjuntar SIEMPRE XML + PDF** al Bill/Invoice (ambos), no solo el PDF.
5. **Fidelidad del XML.** Tomar montos literales (TotalComprobante, TotalImpuesto, descuentos, líneas). No recalcular ni redondear. Si el total de QBO ≠ total del XML, **bloquear** y marcar a revisión; nunca publicar un monto distinto.
6. **Aislamiento multi-empresa.** Usar el token y el `realm_id` de la organización del documento. Nunca publicar en la compañía de otra empresa.
7. **No tragar errores.** Si QBO rechaza, escribir `status='error'` con el mensaje completo de QBO (no truncado de más) y registrarlo en tracking. Nada de `catch {}` vacío.
8. **Sin duplicados.** Antes de (re)publicar, verificar por clave/DocNumber si la entidad ya existe en QBO (usar `verify-qbo-bill-exists` / búsqueda) para no duplicar.

## Checklist al tocar este camino
- [ ] El `status='published'` solo se escribe tras obtener `qbo_entity_id`.
- [ ] Se guarda `qbo_realm_id`.
- [ ] Se adjuntan XML y PDF.
- [ ] Verificación post-publicación: total QBO vs XML; si difiere > tolerancia → review.
- [ ] Errores visibles y persistidos, no silenciados.
- [ ] Probar con una factura real de una empresa que falla (ej. Terranova) y una que funciona (ej. DentoPlus).

## Tipos de comprobante CR (Hacienda v4.x)
01 Factura, 02 Nota de Débito, 03 Nota de Crédito (montos NEGATIVOS), 04 Tiquete, FEC Factura de Compra. Clave=50 dígitos (único), Consecutivo=20. Cuentas 1xx/2xx = activo/pasivo (no usar como gasto en Bills); 3+ = resultado.
