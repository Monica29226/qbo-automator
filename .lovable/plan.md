# Botón para descartar facturas en la Cola de Revisión

## Qué se agrega

En cada fila de la Cola de Revisión, junto a "Revisar" y al ojo del PDF, un botón de papelera
"Descartar". Al usarlo:

1. Aparece una confirmación con el número, el proveedor y el monto, advirtiendo que la factura
   se elimina y queda en la lista de exclusión permanente (no volverá a entrar por correo).
2. Si confirma, la factura desaparece de la lista al instante y se muestra un aviso de éxito.
3. Si algo falla, la fila vuelve a aparecer y se muestra el error.

Además, selección múltiple: una casilla por fila y una barra superior con "Descartar N
seleccionadas", para limpiar varias de una sola vez con la misma confirmación.

Solo se puede descartar lo que aún no está en QuickBooks. Las facturas ya publicadas no muestran
el botón, para no dejar el registro contable sin respaldo.

## Detalle técnico

- `src/pages/ReviewQueue.tsx`: nueva columna de selección, botón `Trash2` por fila y barra de
  acciones masiva; `AlertDialog` de confirmación.
- Reutiliza `discardDocuments(ids)` de `src/lib/discardInvoices.ts`, que llama a la función
  `discard_processed_documents` (registra la clave de 50 en `ignored_documents` y borra el
  documento en una sola transacción).
- El botón se oculta cuando `doc.qbo_entity_id` existe o `status === 'published'`.
- Estado local: `selectedIds: Set<string>`, `docToDiscard`, `isDiscarding`. Tras el descarte se
  filtran los ids del arreglo `documents` sin recargar toda la página.
- Sin cambios en ingesta, publicación a QuickBooks ni en la lectura del XML.
