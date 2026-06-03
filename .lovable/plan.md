## Folder ID recibido

- Carpeta destino: `1qrDYnfhzXaiPzvk3kesQ52BlrAxGYtgj`
- Organización: Agricola Lloronal (`9f878da2-ef1f-4375-b355-0c9eb1b7cf76`)

## ⚠️ Falta conectar OAuth

Verifiqué la base: **todavía no hay cuenta `google_drive` activa** en `integration_accounts` para esta organización. Hasta que conectes el OAuth desde `/integrations`, aunque guardemos el folder ID, la edge function `upload-to-google-drive` no tiene tokens para subir nada.

## Pasos a ejecutar

1. **Guardar folder ID** (lo hago ahora con un UPDATE a `organizations`):
   ```sql
   UPDATE organizations
   SET google_drive_folder_id = '1qrDYnfhzXaiPzvk3kesQ52BlrAxGYtgj',
       google_drive_enabled = true,
       updated_at = now()
   WHERE id = '9f878da2-ef1f-4375-b355-0c9eb1b7cf76';
   ```

2. **Vos:** abrir `/integrations` con Agricola Lloronal activa → clic en "Conectar Google Drive" → login con la cuenta dueña de la carpeta `1qrD...` → aceptar permisos.

   **Importante:** la cuenta que conectes debe tener acceso de **edición** a esa carpeta (la URL muestra `/u/6/` lo que sugiere que es la 7ª cuenta logueada en tu navegador — asegurate de elegir esa misma cuenta en el flujo OAuth).

3. **Verificación:** una vez conectes, vuelvo a consultar `integration_accounts` y, si todo OK, una factura publicada nueva debería aparecer en:
   ```
   [tu carpeta]/2026/Junio/Proveedor - FE-... - ₡monto.pdf + .xml
   ```

## Resultado

Con el folder ID guardado y el OAuth conectado, cada factura publicada en QuickBooks se sube automáticamente al Drive, organizada por año/mes y con el nombre `Proveedor - Factura - Monto`.

Si después querés que dispare el backfill desde el 1 de junio para las facturas ya publicadas, lo agrego como paso extra.
