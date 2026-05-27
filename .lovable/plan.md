## Diagnóstico del caso "Global Skin de Costa Rica S.A"

Confirmé en la base de datos: **no hay ni una sola factura de ese proveedor importada** (0 filas en `processed_documents` con `supplier_name` que contenga "global skin"). Por eso la búsqueda local devuelve vacío — el sistema simplemente nunca la trajo del correo.

El botón "Buscar en correo" sí existe cuando no hay resultados locales, pero hoy tiene dos limitaciones que hacen que tampoco encuentre nada para este caso:

1. **El "deep search" (que abre los adjuntos XML/PDF y lee el contenido) solo se dispara cuando el término es numérico de 8+ dígitos** (regex `^\d{8,}$` en `SearchInvoiceDialog.tsx`). Si escribís un nombre de proveedor, cae al fallback (`hostinger-fetch-invoices` / `bluehost-fetch-invoices` / `gmail-fetch-invoices`).
2. **El fallback solo busca en los headers FROM y SUBJECT del correo**, no dentro del XML. Comando IMAP real: `SEARCH SINCE … OR FROM "Global Skin de Costa Rica S.A" SUBJECT "Global Skin de Costa Rica S.A"`. La mayoría de proveedores envían desde `fe@managerfe.com`, `noreply@sws-software.com`, etc. y el asunto suele tener el número de factura, no la razón social completa. Resultado: 0 matches.

Por eso "no sale ninguna" aunque el correo sí tenga las facturas adjuntas.

## Plan

### 1. `supabase/functions/search-import-invoice/index.ts` — aceptar búsqueda por proveedor
Hoy la función recibe `invoice_number`. Agregar parámetros alternativos:
- `vendor_name?: string` — texto libre (ej. "Global Skin")
- `vendor_tax_id?: string` — cédula jurídica si la tienen

Lógica:
- Si llega `vendor_name`/`vendor_tax_id`, normalizar (minúsculas, sin tildes, sin `S.A`/`SOCIEDAD ANONIMA`/puntos/comas) y guardar como `needle`.
- En el barrido IMAP de los últimos 90 días, además del `TEXT` search por número, hacer un escaneo de los últimos N mensajes (igual que el fallback de 30 días que ya existe) y, para cada XML adjunto encontrado, comparar la versión normalizada de `<NombreEmisor>` / `<NumeroCedulaEmisor>` contra `needle`.
- Cuando haga match, llamar al pipeline existente (`process-document-xml` → guardar PDF → opcional auto-publicar). Importar **todas** las facturas que matcheen, no solo la primera (devolver `imported: N` + lista de claves).
- Mantener la búsqueda numérica actual sin cambios.

### 2. `src/components/dashboard/SearchInvoiceDialog.tsx` — enrutar nombres al deep search
- Reemplazar la condición `usesDeepSearch = isStructuredInvoiceQuery && supportsDeepAttachmentSearch` por:
  - Si el término es numérico de 8+ dígitos → deep search por `invoice_number` (como hoy).
  - Si el término es texto con al menos 4 caracteres alfabéticos → deep search por `vendor_name` (nuevo).
  - Solo caer al fallback genérico cuando el proveedor de correo no esté soportado por `search-import-invoice` (outlook/outlook_imap).
- Mostrar mensaje claro: "Buscando facturas de '…' dentro de los adjuntos XML del correo (últimos 90 días)…"
- Cuando la respuesta traiga `imported > 0`, refrescar la lista local y mostrarlas todas (no solo la primera).

### 3. Validación
- Repetir el ejercicio con "Global Skin de Costa Rica S.A" en el dashboard de la organización activa.
- Revisar logs de `search-import-invoice`: deben aparecer líneas tipo `🔍 vendor needle: "global skin"` y `✓ match vendor en clave …`.
- Confirmar en `processed_documents` que aparecen las nuevas filas con `supplier_name ILIKE '%global skin%'`.

## Lo que NO se toca
- Sync automática, cron, lógica de duplicados, mapeo de cuentas, publicación a QuickBooks, stability score, sync-from-excel.
- Comportamiento actual de búsqueda por número de factura / clave numérica.

## Notas técnicas
- La normalización debe ser la misma que ya usa el sistema para vendor matching (ver memoria `vendor-name-normalization-critical-for-matching`): `toLowerCase`, `normalize("NFD").replace(/[\u0300-\u036f]/g, "")`, quitar `s\.?a\.?`, `srl`, `sociedad anonima`, puntuación.
- Reutilizar `parseFolderList` y el escaneo `SINCE` ya implementados en `search-import-invoice` para no duplicar lógica IMAP.
- Límite duro: máx 50 mensajes escaneados por carpeta por llamada (igual que hoy) para no exceder los 60s del wall-time.
