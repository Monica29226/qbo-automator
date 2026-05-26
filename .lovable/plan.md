# Plan: Garantizar importación correcta desde correo

## Recomendación de origen
**Hostinger/Bluehost IMAP como fuente principal** — ya está optimizado (BATCH_SIZE=40, cursor persistente, UTF-8). Outlook OAuth queda como secundario por la expiración de tokens. Reportes Siku se usan sólo para auditoría final.

---

## 1. Panel de Salud de Importación (Dashboard)

Nuevo componente `ImportHealthPanel.tsx` que muestra, para **cada organización** (vista admin) o la activa:

- **Última sincronización exitosa** — timestamp + badge (verde <2h, amarillo <24h, rojo >24h)
- **Estado IMAP** — conectado / token expirado / sin integración
- **Backlog en mailbox** — `skip_count` persistido vs total estimado
- **Importadas hoy / 7d / mes** — conteo desde `processed_documents`
- **Errores recientes** — últimos 7 días desde `sync_logs` con código de error
- **Botón "Drenar mailbox completo"** — abre el dialog con modo drenaje activado

Se ubica en Dashboard arriba de las quick actions.

---

## 2. Modo "Drenaje Completo" en ImportBatchDialog

Checkbox **"Drenar todo el mes (sin límite de iteraciones)"** que:

- Quita el tope de 80 iteraciones
- Continúa llamando a `hostinger-fetch-invoices` hasta que la respuesta indique `messages_remaining = 0` **o** se acumulen 3 iteraciones consecutivas sin avance
- Muestra barra de progreso en vivo: `X procesados / Y restantes en mailbox`
- Persiste el cursor entre iteraciones (ya implementado)
- Al finalizar genera resumen descargable (CSV) con: clave, proveedor, fecha, estado, motivo

---

## 3. Reporte diario por email (todas las organizaciones)

Edge function programada **`daily-import-health-report`** que corre cada día a las 7am CR:

- Para cada organización activa, calcula:
  - Sincronizaciones últimas 24h (éxito / fallo)
  - Facturas importadas, pendientes de configuración, en error
  - Backlog acumulado en mailbox
  - Conexiones IMAP con problemas (token vencido, login fallido)
- Envía un único email HTML al admin global con tabla resumen por org
- Usa Resend (ya configurado, `RESEND_API_KEY` existe)
- Plantilla con código de colores: verde (OK), amarillo (atención), rojo (acción requerida)

Programación vía `pg_cron` apuntando a la edge function.

---

## 4. Verificación post-importación reforzada

Al terminar **Importar Lote**, mostrar tarjetas con:

- ✅ Aceptadas y publicadas en QBO (con `qbo_entity_id`)
- ⏳ Aceptadas pero pendientes QBO (sin entity_id aún)
- ⚠️ Pendientes de configuración (proveedor sin cuenta)
- 📭 Falta Mensaje Receptor de Hacienda
- ❌ Rechazadas con motivo específico
- 🔁 Duplicadas (ya existían)

Cada categoría es clickeable y abre lista filtrada en `/invoices-pending-log` o `/error-documents`.

---

## Archivos a crear/editar

**Nuevos:**
- `src/components/dashboard/ImportHealthPanel.tsx` — panel principal
- `src/hooks/useImportHealth.ts` — query agregada por org
- `supabase/functions/daily-import-health-report/index.ts` — cron de email
- `supabase/functions/import-health-summary/index.ts` — datos para el panel

**Editados:**
- `src/components/dashboard/ImportBatchDialog.tsx` — modo drenaje + CSV + categorías
- `src/pages/Dashboard.tsx` — incluir `<ImportHealthPanel />`
- `supabase/functions/hostinger-fetch-invoices/index.ts` — exponer `messages_remaining` y `mailbox_total` en respuesta
- `supabase/functions/bluehost-fetch-invoices/index.ts` — mismo cambio

**Migración:**
- Crear cron job en `pg_cron` para ejecutar `daily-import-health-report` diariamente a las 13:00 UTC (7am CR)

---

## Cómo verificarás que todo importa correctamente

Después del cambio tendrás 3 puntos de control:

1. **Diario automático**: te llega un email cada mañana con el estado de todas las orgs
2. **Visual en tiempo real**: el Panel de Salud en el dashboard muestra backlog y última sync
3. **Bajo demanda**: el modo "Drenar todo el mes" garantiza vaciar el mailbox de una corrida

Si una org tiene backlog >0 en el panel o el email diario marca rojo, sabes exactamente cuál revisar.
