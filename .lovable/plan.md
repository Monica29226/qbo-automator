## Estado actual de Agricola Lloronal

- `google_drive_enabled = true` ✅
- `google_drive_folder_id = NULL` ❌ (falta carpeta raíz)
- No hay cuenta OAuth `google_drive` en `integration_accounts` ❌

Hasta que ambos estén listos, `upload-to-google-drive` hace skip silencioso y **no sube nada**, aunque las facturas se publiquen en QuickBooks.

La lógica de organización (`AAAA/Mes/Proveedor - Factura - Monto.pdf+xml`) ya está implementada en `supabase/functions/upload-to-google-drive/index.ts` — no requiere cambios.

## Qué falta para que funcione

### 1. Conectar Google Drive (OAuth) en Integraciones

Pasos en la UI (`/integrations`, ya estando dentro de Agricola Lloronal):
1. Botón **"Conectar Google Drive"**.
2. Login con la cuenta de Google que será dueña de la carpeta de facturas.
3. Aceptar permisos de Drive.
4. Se crea la fila en `integration_accounts` con `service_type='google_drive'`, `is_active=true` y los tokens.

### 2. Configurar la carpeta raíz

Hoy `google_drive_folder_id` se setea manualmente. Dos caminos:

**Opción A (rápida, sin código):** crear una carpeta en Drive (ej. "Facturas Agricola Lloronal"), copiar el ID desde la URL `https://drive.google.com/drive/folders/{ID}` y guardarlo vía un UPDATE puntual en `organizations`. Yo lo aplico una vez conectado.

**Opción B (recomendada, requiere build):** agregar en `/integrations` un campo "Carpeta destino" debajo del botón de Google Drive, que:
- Liste carpetas con la API de Drive ya conectada, o acepte pegar el link/ID.
- Persista `google_drive_folder_id` en `organizations`.
- Muestre el path de la carpeta seleccionada.

### 3. Resultado esperado

Una vez ambos puntos listos, cada factura publicada (nueva o forzada manualmente) se sube así:

```text
Facturas Agricola Lloronal/
└── 2026/
    └── Junio/
        ├── Proveedor X - FE-00100001010000000123 - ₡125,000.pdf
        ├── Proveedor X - FE-00100001010000000123 - ₡125,000.xml
        └── Pagos/   (cuando se registre el comprobante)
            └── Proveedor X - FE-... - ₡125,000 - COMPROBANTE.pdf
```

### 4. (Opcional) Backfill desde junio

Si querés que las facturas ya publicadas desde el **1 de junio 2026** suban a Drive retroactivamente: corro `batch-upload-to-drive` para esta organización filtrando por `issue_date >= '2026-06-01'`. La función ya existe; solo hay que disparar el llamado. Esto sube PDF + XML de todas las publicadas, sin tocar las que ya estén en Drive (deduplicación por nombre dentro de la carpeta).

## Acción siguiente

Decime cuál preferís:

- **(A) Solo conectar ahora** → vos hacés clic en "Conectar Google Drive" en `/integrations` y me pasás el link/ID de la carpeta raíz; yo aplico el UPDATE.
- **(B) Conectar + UI para elegir carpeta** → construyo el selector de carpeta en Integraciones (≈ pequeño cambio de frontend + 1 edge function para listar carpetas).
- **(C) A o B + backfill desde junio** → además dispara `batch-upload-to-drive` para subir lo ya publicado.
