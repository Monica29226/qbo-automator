
# Plan: Módulo Administrativo de Pagos

## Objetivo

Hoy el sistema es 100% contable (XML → QuickBooks). Vamos a añadir una capa **Administrativa** paralela: cada factura que llega al sistema queda en estado **Pendiente de pago**, y se marca **Pagada** cuando se sube el comprobante de transferencia. Todo respaldado en Google Drive con nombre legible.

## Flujo administrativo (lo que pediste)

```text
Factura llega por correo / GTI
        │
        ▼
[Pendiente de pago]  ← automático al ingresar al sistema
        │
        │  Usuario sube comprobante de transferencia
        ▼
[Pagada]  ← se exige el archivo; sin comprobante no avanza
```

Solo **dos estados de pago**: `pending_payment` y `paid`. El estado contable de QuickBooks queda independiente (una factura puede estar publicada en QBO y aún pendiente de pago, o pagada antes de publicarse).

## 1. Base de datos (migración)

Nuevos campos en `processed_documents`:

- `payment_status text default 'pending_payment'` — `pending_payment` | `paid`
- `paid_at timestamptz`
- `paid_by uuid` (usuario que confirmó)
- `payment_proof_url text` — ruta en bucket privado
- `payment_proof_drive_id text` — id en Google Drive
- `payment_reference text` — opcional, # de transferencia o nota
- `payment_method text` — opcional (SINPE, transferencia, etc.)

Backfill: todos los documentos existentes quedan en `pending_payment`. Índice en `(organization_id, payment_status, issue_date)`.

Sin cambios en RLS (heredan las políticas actuales de `processed_documents`). Sin tabla nueva — mantener el modelo simple.

## 2. Storage del comprobante

- Bucket privado nuevo: **`payment-proofs`** (privado, signed URLs).
- Path: `{organization_id}/{document_id}/{timestamp}_{filename}`.
- Aceptar PDF, JPG, PNG, WebP (máx 10 MB).
- Políticas RLS sobre `storage.objects`: solo miembros de la org pueden leer/escribir el folder `{org_id}/...`; solo admins pueden eliminar.

## 3. Subida a Google Drive (la mejora que pediste)

Refactor de `upload-to-google-drive`:

- **Nombre actual** (no legible): `Vendor_FE-123_2026-01-15.pdf`
- **Nombre nuevo** (formato confirmado): `Alquileres Eiffel - FE-123 - ₡125,000.pdf`
  - Proveedor: nombre original con caracteres ilegales en filesystem reemplazados (`/\\?%*:|"<>` → `-`), respetando mayúsculas/minúsculas y tildes.
  - Número: el `doc_number` corto (no el consecutivo de 20 dígitos).
  - Monto: con símbolo (`₡` o `$`) y separadores de miles, sin decimales si es CRC.
- Estructura: `Drive root / Año / Mes / <archivo>` (se mantiene).
- Se sube **PDF + XML** con el mismo basename.
- Para el comprobante de pago: subcarpeta `Drive root / Año / Mes / Pagos / Alquileres Eiffel - FE-123 - ₡125,000 - COMPROBANTE.pdf`.
- Si Drive está conectado vía Gmail, ya hay `refresh_token` — reutilizamos.
- Disparador: al crearse el documento Y al marcarse como pagado (no requiere acción del usuario).
- Si Drive no está habilitado, la subida se omite silenciosamente (no bloquea).

## 4. Edge function nueva: `mark-invoice-paid`

Input: `{ document_id, payment_proof_base64, filename, payment_reference?, payment_method? }`

1. Verifica JWT y membresía de org.
2. Sube el comprobante al bucket `payment-proofs`.
3. Actualiza `processed_documents`: `payment_status='paid'`, `paid_at=now()`, `paid_by=auth.uid()`, `payment_proof_url`, `payment_reference`, `payment_method`.
4. Llama `upload-to-google-drive` (modo `payment_proof`) para replicar a Drive.
5. Inserta entrada en `audit_log`.

Sin comprobante → 400. Idempotente: si ya está `paid`, permite reemplazar comprobante (con log).

## 5. UI nueva — sección "Administrativo"

Nuevo grupo en sidebar `DashboardSidebar.tsx`:

```text
Administrativo
├── Cuentas por Pagar      → /admin-payments/pending
└── Pagadas                → /admin-payments/paid
```

Página `AdminPayments.tsx` (una página, tabs según ruta):

- Tabla: Fecha · Proveedor · # Factura · Monto · Moneda · Estado QBO · Estado Pago · Acciones.
- Filtros: rango de fechas, proveedor, moneda, monto min/max.
- Buscador por # factura / proveedor / clave.
- Acción principal por fila: **"Marcar como pagada"** → abre dialog con dropzone para el comprobante + campos opcionales (referencia, método). Al confirmar llama `mark-invoice-paid`.
- En pestaña "Pagadas": botón **"Ver comprobante"** (abre signed URL) y **"Ver en Drive"** si tiene `payment_proof_drive_id`.
- Bulk action: seleccionar varias y marcar todas como pagadas con un solo comprobante consolidado (opcional, fase 2 si quieres).
- KPIs arriba: Total pendiente CRC, Total pendiente USD, # facturas pendientes, # vencidas (>30 días desde emisión).

## 6. Dashboard: card nueva

Card "Cuentas por Pagar" en la grilla principal del Dashboard con el monto total pendiente y link a `/admin-payments/pending`.

## 7. Auditoría y limpieza de UI sin uso

Confirmado que limpie. Candidatos detectados con baja/ninguna referencia desde páginas activas (lo verifico uno por uno antes de borrar):

| Componente | Estado |
|---|---|
| `TestAutoSyncFlow` | Solo dev/QA |
| `QATestSuitePanel` | Solo dev/QA |
| `StabilityScorePanel` | Métrica que ya no se mira |
| `TotalsValidationTest` | Reemplazado por verificación post-publicación |
| `MigrateAndRetryAll` (función edge) | Migración one-shot ya ejecutada |
| `RecoverBacklogButton` | Backlog ya recuperado |
| `BatchUploadToDriveButton` | Será reemplazado por subida automática |
| `CleanIrrecoverableErrorsButton` | Mantener pero mover a /admin/import-health |

Procedimiento: te muestro la lista final con conteo de usos exacto antes de eliminar nada. Nada se borra sin tu OK explícito.

## 8. Detalles técnicos

- **Sin cambios en flujo QBO**. Pago y publicación QBO son independientes.
- **Realtime**: subscribirse a `processed_documents` filtrando por `payment_status` para que la lista se actualice al marcar pagada otra factura.
- **Optimistic UI**: marcar como pagada actualiza UI <100ms; subida a Drive ocurre en background y se reintenta si falla.
- **Reintento Drive**: si falla la subida del comprobante, queda registrado en `audit_log` y aparece un badge "Drive pendiente" en la fila, con botón para reintentar.
- **Permisos**: cualquier `member` puede marcar como pagada; solo `admin` puede revertir (volver a pendiente).

## 9. Fuera de alcance (no en este sprint)

- Conciliación automática con estados de cuenta bancarios (ya existe módulo bank statements; lo conectamos después).
- Workflow de aprobación previo (lo descartamos por tu respuesta).
- Programación de pagos futuros / recordatorios.
- Exportación a Excel del módulo administrativo (fase 2 si lo necesitas).

## Orden de ejecución

1. Migración DB (campos + bucket + RLS).
2. Edge function `mark-invoice-paid`.
3. Refactor `upload-to-google-drive` (nombres + soporte payment proof).
4. UI `AdminPayments` + sidebar + dashboard card.
5. Auditoría de componentes sin uso → reviso contigo → elimino.
6. Backfill: trigger automático para subir a Drive las facturas históricas con nombres nuevos (botón one-shot en /admin).

¿Procedo con esta estructura?
