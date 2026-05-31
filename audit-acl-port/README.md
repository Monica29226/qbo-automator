# Kit portable para Audit ACL

Esta carpeta contiene artefactos **listos para copiar al proyecto "Audit ACL"**. No forman parte de la app `qbo-automator` (es una zona de staging). El diseño completo está en `../AUDIT_SYSTEM_DESIGN.md`.

## Contenido

| Archivo | Destino en Audit ACL | Qué es |
|---|---|---|
| `migrations/0001_audit_schema.sql` | `supabase/migrations/` | Esquema completo: enums, tablas, índices y RLS |
| `functions/audit-agent-planner/index.ts` | `supabase/functions/audit-agent-planner/` | Edge function del Agente Planificador |

## Antes de aplicar — ajustes a revisar

1. **Modelo de membresía / RLS.** La migración asume que existe una tabla de membresía que liga usuarios a la firma (`organization_members(user_id, organization_id)`) y una función `auth.uid()`. Si en Audit ACL la tabla o columnas se llaman distinto, ajustá el helper `is_org_member()` al inicio del SQL — todas las políticas lo reutilizan.
2. **`processed_documents`.** La tabla `workpaper_documents` referencia `processed_documents(id)`. Si Audit ACL no tiene esa tabla (las facturas viven en qbo-automator), dejá la columna `processed_document_id` como `uuid` **sin** la FK y úsala como referencia lógica, o apuntá a la tabla de soportes de Audit ACL.
3. **Secreto de IA.** La function usa `LOVABLE_API_KEY` (igual que en qbo-automator). Confirmá que el secreto exista en Audit ACL.
4. **`profiles`.** Las FK de `prepared_by`/`reviewed_by`/`partner_id` apuntan a `profiles(id)`. Ajustá si Audit ACL usa `auth.users` directamente.

## Cómo aplicar

```sh
# En el repo de Audit ACL:
cp 0001_audit_schema.sql supabase/migrations/$(date +%Y%m%d%H%M%S)_audit_schema.sql
cp -r audit-agent-planner supabase/functions/
supabase db push          # o aplicar vía el flujo de Lovable
supabase functions deploy audit-agent-planner
```

> Mejor opción: abrir una sesión de Claude Code directamente en el repo de Audit ACL para que yo aplique e integre esto contra su esquema real (auth, RLS y UI incluidos).
