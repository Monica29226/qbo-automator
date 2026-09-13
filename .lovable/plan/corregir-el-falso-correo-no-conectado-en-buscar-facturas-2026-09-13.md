# Corregir el falso "correo no conectado" en Buscar facturas

## Qué pasa

Al buscar la factura y pedir que la busque en el correo, la pantalla responde que no hay correo
conectado, aunque en Integraciones aparece conectado. Comprobado en la base de datos: la tabla de
conexiones de correo **no permite lectura desde la aplicación** (solo tiene permisos de crear,
actualizar y borrar). Por eso la consulta vuelve vacía y el sistema concluye "no conectado", cuando
en realidad la conexión existe y funciona.

Integraciones sí muestra el estado correcto porque consulta por una vía segura ya existente; las
demás pantallas consultan directo y siempre reciben vacío.

## Alcance

Pantallas y tarjetas que hoy pueden decir falsamente "no conectado" o dejar el estado en blanco:

- Buscar facturas (el caso reportado)
- Importar desde Gmail, Hostinger y Bluehost
- Estado del sistema, monitor de renovación de token, diagnóstico de QuickBooks
- Tarjeta de guía de publicación, aislamiento por empresa, tarjeta de Siku
- Dos consultas internas en la propia página de Integraciones

Todas pasan a leer el estado por la vía segura, con el mismo control de acceso por empresa.

## Después del cambio

- Buscar facturas reconoce el buzón conectado y busca dentro de los adjuntos XML/PDF del correo.
- Los avisos de "no conectado" solo aparecen cuando la conexión realmente está caída.
- Una vez que la búsqueda funcione, reviso el caso de las facturas que le faltan (el número que
  termina en 456) y le reporto si el correo las tiene o si nunca llegaron al buzón.

No se toca la ingesta ni la publicación a QuickBooks. Las credenciales siguen sin exponerse: la vía
segura devuelve solo el estado, nunca claves ni tokens.

## Detalle técnico

1. Ampliar `public.get_integration_accounts(_org_id uuid)` (SECURITY DEFINER, ya valida membresía o
   rol admin) para devolver además `organization_id`, `expires_at` (derivado de
   `credentials->>'expires_at'`), `sync_from`, `created_at`, `updated_at`. Sin tokens ni claves.
   Añadir un parámetro opcional para incluir inactivas, que los avisos de desconexión necesitan.
2. Reemplazar cada `supabase.from("integration_accounts").select(...)` del cliente por
   `supabase.rpc("get_integration_accounts", ...)` en:
   `SearchInvoiceDialog.tsx`, `GmailFetchDialog.tsx`, `HostingerFetchDialog.tsx`,
   `BluehostFetchDialog.tsx`, `SystemStatusPanel.tsx`, `TokenRenewalMonitor.tsx`,
   `QBOConnectionDiagnostic.tsx`, `PublishGuideCard.tsx`, `CompanyIsolationStatus.tsx`,
   `siku/SikuCard.tsx` (solo lecturas; los `insert`/`update` quedan igual), y las lecturas de
   `Integrations.tsx` (líneas 160, 692, 704).
3. Regenerar tipos y verificar con typecheck y build.
