# Skill: Importar ingresos (ventas) desde Excel y publicarlos en QuickBooks

## Cuándo usar este skill
Cuando el usuario quiera **cargar ingresos / facturas de venta emitidas** a partir de un **Excel** (típicamente el reporte de Hacienda/ATV "Documentos Emitidos") y registrarlas en QuickBooks como **Invoices de venta**. Los GASTOS entran por correo (XML); los INGRESOS entran por este Excel.

## Contexto del sistema (qué ya existe — NO reconstruir)
- `supabase/functions/sync-from-excel/index.ts`: parsea el Excel (usa `XLSX`), detecta columnas de Clave (50) y Consecutivo, y por cada fila intenta ubicar/importar el comprobante (llama a `search-import-invoice`).
- `supabase/functions/publish-sales-to-quickbooks/index.ts`: crea el **Invoice** de venta en QBO (busca o crea el Customer por DisplayName).
- `src/pages/SalesInvoices.tsx` + `src/hooks/useSalesInvoices.ts`: lista de facturas de venta, publicar y enviar por correo.
- `mark-invoice-paid`: marca facturas como pagadas.

## Reglas de negocio (OBLIGATORIAS)
1. **Multi-empresa**: todo se scopea por `organization_id`. Un Excel pertenece a UNA empresa (la activa). Nunca mezclar ingresos entre empresas.
2. **Identidad fiscal CR**: la **Clave de 50 dígitos** es el identificador único. Deduplicar ingresos por `doc_key` (clave) + `organization_id`. El mismo consecutivo de distinto emisor NO es duplicado.
3. **Ingreso vs gasto**: un documento de ingreso es donde la organización es el **EMISOR** (no el receptor). Marcar estos registros como tipo venta para no confundirlos con gastos. Si reusás `processed_documents`, agregá/usá un campo que distinga `direction = 'income' | 'expense'` (o `doc_role`). NO mezclar en las mismas listas/contadores de gastos.
4. **Fidelidad del dato**: tomar montos LITERALES del Excel/XML (total, impuesto, moneda, tipo de cambio). No recalcular ni redondear.
5. **Mapeo flexible de columnas**: el Excel de ATV varía. Detectar encabezados por candidatos (ej. "Clave","Clave Numérica","Consecutivo","Total Comprobante","Nombre Receptor/Cliente","Fecha Emisión","Moneda","Impuesto"). Mostrar al usuario los encabezados detectados y a qué campo se mapeó cada uno; permitir corregir el mapeo antes de importar.
6. **Cliente (Customer)**: en QBO, buscar el Customer por nombre/cédula; crearlo solo si no existe. Nunca duplicar clientes.
7. **Sin duplicados en QBO**: antes de crear el Invoice, verificar si ya existe (por DocNumber/clave) para no duplicar ingresos en la contabilidad.

## Invariantes de publicación (igual que gastos)
- NUNCA marcar un ingreso como `published` sin un Id real devuelto por QuickBooks.
- Guardar `qbo_entity_id`, `qbo_entity_type` (Invoice) y `qbo_realm_id` (compañía QBO) en cada ingreso publicado.
- Adjuntar el XML y el PDF al Invoice si existen.
- Si el total de QBO no cuadra con el del Excel/XML → bloquear y marcar a revisión, no publicar un monto distinto.

## Flujo objetivo (UX)
1. En `SalesInvoices` (o una pestaña "Importar ingresos"): botón **"Subir Excel de ingresos"**.
2. Subir → previsualizar primeras filas + mapeo de columnas detectado → confirmar.
3. `sync-from-excel` crea/normaliza los registros de ingreso (dedupe por clave, dirección = income).
4. Lista de ingresos pendientes con su cliente/monto → botón **"Publicar a QuickBooks"** (usa `publish-sales-to-quickbooks`, verificando duplicados).
5. Reporte claro: cuántos importados, cuántos publicados, cuántos omitidos (duplicados) y cuántos con error — con el motivo de cada uno (sin tragar errores).

## Qué revisar/corregir al implementar
- Confirmar que `sync-from-excel` distinga ingreso de gasto y no contamine los KPIs/listas de gastos.
- Confirmar que `publish-sales-to-quickbooks` use el `realm_id` de la organización activa (aislamiento) y verifique duplicados antes de crear.
- Manejo de moneda y tipo de cambio (CRC/USD).
- Reporte de resultados honesto (nada de "éxito" si hubo fallos).

## Definición de "hecho"
- Subo el Excel de "Documentos Emitidos" de una empresa, veo el mapeo, importo, y los ingresos quedan listados.
- Los publico y aparecen como Invoices en la compañía CORRECTA de QuickBooks, sin duplicados, con XML/PDF adjunto cuando existan.
- Funciona igual para cualquier empresa (actual o nueva) sin cambios de código por empresa.
