# Corregir el error al guardar una empresa nueva (Hacienda el Plantón, persona física)

## Qué está pasando

Verifiqué la base de datos y el código:

1. **La empresa no existe todavía**: no hay ninguna organización cuyo nombre contenga "Plant", así que el guardado nunca se completó.
2. **Causa del error**: la tabla `organizations` tiene la política de seguridad `org_insert_block_clients` con `WITH CHECK (false)`, es decir, la aplicación **no puede crear empresas directamente desde el navegador** (se agregó así por seguridad). El formulario de la página *Empresas* (`Organizations.tsx` → `handleCreateOrg`) sí intenta insertar directo, por lo que siempre falla con un error de permisos.
   - El otro formulario, el del selector de empresa arriba (`CreateOrganizationDialog`), sí usa la ruta correcta a través del servidor (`create-organization`) y funciona.
3. **Segundo defecto, silencioso**: la función `create-organization` guarda `identification_number` pero **nunca guarda `tax_id`**. Como la validación de facturas compara la cédula del receptor del XML contra `tax_id`, una empresa creada por ahí queda sin poder importar facturas (aparece la alerta "Cédula Jurídica no Configurada"). Esto aplica igual para cédula física.

## Qué se va a corregir

1. Que el formulario de la página *Empresas* deje de insertar directo y use la misma ruta segura del servidor que ya funciona, mostrando el mensaje real de error si algo falla (no un "Error al crear organización" genérico).
2. Que la creación en el servidor guarde también `tax_id` con la identificación limpia (solo dígitos), de modo que una persona física de 9 dígitos quede lista para recibir facturas.
3. Validar el tipo/número de identificación en el servidor con las reglas de Costa Rica ya definidas (física 9, jurídica 10, DIMEX 11–12, NITE 10) y devolver un mensaje claro cuando no calce.
4. Después del despliegue, crear la empresa **Hacienda el Plantón** como persona física con la cédula que usted indique, para confirmar de punta a punta que guarda sin error.

## Detalle técnico

- `src/pages/Organizations.tsx`: `handleCreateOrg` pasa a `supabase.functions.invoke("create-organization", …)` enviando nombre, `identification_type`, `identification_number`, email; se conservan `qbo_company_id` y los campos de Drive con un `update` posterior (permitido para admins). Mensajes de error surfaced desde `data.error`.
- `supabase/functions/create-organization/index.ts`: limpiar la identificación con regex de dígitos, validar longitud por tipo, insertar `tax_id` = identificación limpia, y rechazar duplicados por `tax_id` además del nombre.
- No se toca RLS: la inserción sigue siendo exclusiva del servidor con rol de servicio.

## Lo que necesito de usted

El número de cédula física de Hacienda el Plantón (9 dígitos) para hacer la prueba final. Si prefiere, dejo el arreglo y usted la crea desde la pantalla.
