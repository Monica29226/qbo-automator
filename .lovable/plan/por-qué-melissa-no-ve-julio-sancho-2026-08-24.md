# Por qué Melissa no ve «Julio Sancho»

## Lo que muestran los datos

La empresa **Julio Sancho** sí existe (creada el 25 de marzo de 2026), pero:

- Está **desactivada** (`is_active = false`).
- No tiene **cédula** registrada (`tax_id` vacío), así que no puede recibir facturas.
- Su única membresía es **Mónica** como propietaria. **Melissa no tiene membresía**, y el selector de empresas se arma solo con las membresías del usuario.
- No tiene ningún documento cargado (0 facturas).

El disparador que da acceso automático a los administradores globales solo actúa sobre empresas **nuevas**, por eso Melissa nunca quedó agregada a esta, que es anterior. Además no se creó ninguna empresa nueva hoy: los intentos de «Hacienda el Plantón» no dejaron registro.

## Qué haría para arreglarlo

1. Reactivar la empresa «Julio Sancho» y corregir el nombre al nombre legal completo.
2. Registrar su cédula física (9 dígitos) para habilitar la recepción de facturas.
3. Dar acceso a Melissa y al resto de administradores globales a esa empresa.
4. Ejecutar un respaldo único que otorgue a todos los administradores globales acceso a **todas** las empresas ya existentes, para que no vuelva a faltar ninguna en el selector de nadie.
5. Ocultar del listado de administración las empresas desactivadas o marcarlas claramente como inactivas, para que no se confunda «no aparece» con «no existe».

## Detalle técnico

- `organizations`: `is_active = true`, `tax_id` y `identification_number` con la cédula limpia (solo dígitos), `identification_type = 'fisica'`.
- `organization_members`: upsert de `role = 'admin'`, `is_active = true` para cada usuario con rol global `admin`, sobre todas las empresas activas (respetando la llave única `user_id + organization_id`).
- `src/contexts/AuthContext.tsx`: el listado se construye desde `organization_members` sin filtrar `organizations.is_active`; conviene filtrar también por empresa activa para que un caso como este no muestre empresas apagadas.

## Antes de ejecutar

Necesito la **cédula de Julio Gerardo de Jesús Sancho Piedra** (persona física, 9 dígitos) y confirmar si «Hacienda el Plantón» debe ser esta misma empresa renombrada o una empresa aparte.
