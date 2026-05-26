## Objetivo

El panel "Salud de Importación de Correo" en el Dashboard debe mostrar **únicamente** la información de la empresa activa (la seleccionada en el selector de empresa). Hoy, cuando el usuario es admin, mezcla todas las organizaciones en una sola tabla, lo cual viola el aislamiento por empresa.

## Cambios

### 1. `src/components/dashboard/ImportHealthPanel.tsx`
- Forzar siempre el modo "una sola empresa" usando `activeOrganization`, sin importar si el usuario es admin.
  - `useImportHealth({ allOrgs: false, organizationId: activeOrganization })`
- Quitar el botón **"Drenar todas"** del header (era exclusivo admin y operaba global).
- Convertir la tabla en una **vista de detalle de una sola empresa**:
  - Encabezado con nombre de la empresa activa, badge de estado, badge de integración.
  - Cards/grid con: Última sync, Backlog, Importadas hoy / 7d / mes, Pend. config, Errores 7d, últimos códigos de error.
  - Un único botón **"Drenar correo de esta empresa"** que invoca `auto-sync-invoices` con `organization_id: activeOrganization`.
- Si no hay empresa activa, mostrar mensaje "Selecciona una empresa".
- Si la empresa no tiene integración, mostrar CTA "Ir a Integraciones".

### 2. Vista global para admins (separada)
- Para no perder la visibilidad cross-org del admin, **NO** se elimina del producto: se mueve a `/admin/import-health` (página nueva), accesible solo desde el menú admin.
- Esta página sí usa `allOrgs: true` y conserva la tabla multi-empresa y el botón "Drenar todas".
- Archivo nuevo: `src/pages/AdminImportHealth.tsx` (reutiliza la lógica actual del panel, renombrada como `AdminImportHealthTable`).
- Ruta añadida en `src/App.tsx` protegida por `isAdmin`.
- Enlace en `DashboardSidebar.tsx` bajo la sección de Admin.

### 3. Sin cambios en backend
- `import-health-summary` ya respeta `organization_id` y valida membresía: no requiere cambios.
- `auto-sync-invoices` ya acepta `organization_id` puntual.

## Resultado

- En `/dashboard` cada usuario (incluido admin con empresa activa) solo ve la salud de **su empresa activa**. Cero mezcla de datos entre clientes.
- Los admins mantienen la vista consolidada multi-empresa, pero en una pantalla separada y explícita (`/admin/import-health`).
