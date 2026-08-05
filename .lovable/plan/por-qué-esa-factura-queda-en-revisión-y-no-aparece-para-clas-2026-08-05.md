# Por qué esa factura queda en "Revisión" y no aparece para clasificar

## Lo que encontré (verificado en datos y código)

La factura `00100001010000000039` de ALVARO SEGURA BARBOZA (ASADA DE TARBACA, emitida 2026-07-02, ingresada 2026-08-05) está en la base con:

- `status = 'review'`
- `error_message = 'Proveedor sin regla automática'`
- `default_account_ref` vacío, sin `vendor_id`

Es decir: el sistema la ingirió bien, solo que el proveedor no tiene regla de cuenta.

### Causa 1 — Estados inconsistentes: el ingestor escribe `review`, los paneles de clasificación buscan `pending_config`

`process-document-xml` marca como `review` (nunca usa `pending_config`) cuando el proveedor no tiene regla. Pero los paneles del dashboard donde usted clasifica filtran solo `pending_config`:

- `PendingVendorConfiguration` → `.eq("status", "pending_config")` — nunca ve estas facturas.
- `VendorsWithoutRules` → `status in (error, pending, pending_config)` — tampoco incluye `review`.
- `usePendingInvoices` (hook antiguo) → `status in (pending, pending_config)` y encima corta por `issue_date >= 2025-11-01`.

Solo la página "Facturas pendientes" (`InvoicesPendingLog`, que usa `usePendingInvoicesOptimized`) sí incluye `review`. De ahí la sensación de que "sale en revisión pero no aparece para clasificar": depende de por dónde entre.

En esta organización hay 2 facturas en `review` y 70 publicadas — las 2 están invisibles en los paneles del dashboard.

### Causa 2 — Facturas enviadas tarde: la ventana de correo es de 30 días

El `mail_query` guardado es `has:attachment (filename:xml OR filename:pdf) newer_than:30d` (28 de 30 organizaciones igual; una con 7 días). Si el cliente envía la factura más de 30 días después de emitida, el cron **nunca la ve** y no queda ningún rastro. Además, si una organización no tiene `mail_query` configurado, `gmail-fetch-invoices` cae a un default de **3 días**, aún más estrecho.

## Plan de corrección

### 1. Unificar el estado "necesita clasificación"
Tratar `review` y `pending_config` como el mismo estado a la vista del usuario, en todos los puntos de entrada:

- `PendingVendorConfiguration`: cambiar a `status in ('review','pending_config')`.
- `VendorsWithoutRules`: añadir `review` al filtro.
- `usePendingInvoices`: añadir `review` y quitar el corte fijo `issue_date >= 2025-11-01` (o alinearlo al corte oficial 2026-01-01).

Con esto, la factura de ALVARO SEGURA BARBOZA aparece para clasificar desde el dashboard, y al asignar la cuenta se propaga al proveedor como ya funciona hoy.

### 2. Ampliar la ventana de correo para facturas enviadas tarde
- Subir el `mail_query` por defecto de las organizaciones de `newer_than:30d` a `newer_than:90d` (y cambiar el fallback de 3 días en `gmail-fetch-invoices` a 90 días), para cubrir el envío tardío típico.
- La deduplicación por Clave ya existe, así que ampliar la ventana no crea duplicados ni infla Storage (el fix de descarga de PDF ya está aplicado).

### 3. Hacer visible lo que llega tarde (opcional, recomendado)
Marcar en la lista de pendientes cuándo `created_at` es muy posterior a `issue_date` (por ejemplo "recibida 34 días tarde"), para que se distinga un atraso del cliente de una falla del sistema.

## Detalle técnico

Archivos a tocar:

- `src/components/dashboard/PendingVendorConfiguration.tsx` — filtro de estado.
- `src/components/dashboard/VendorsWithoutRules.tsx` — filtro de estado.
- `src/hooks/usePendingInvoices.ts` — filtro de estado y corte de fecha.
- `supabase/functions/gmail-fetch-invoices/index.ts` — solo el default de `newer_than` (sin tocar la lógica de parseo ni de dedup).
- Migración/actualización de `system_settings.mail_query` a 90 días para las organizaciones que hoy tienen 30d o 7d.

No se cambia nada del cálculo de montos, IVA ni de la publicación a QuickBooks.
