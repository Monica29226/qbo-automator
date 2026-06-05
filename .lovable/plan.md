## Diagnóstico

### 1) ASADA DE TARBACA — "última sync = marzo 2026"

El badge del dashboard sí está en tiempo real: lee `sync_logs.started_at` cada 60s. El problema real es que **no se ha ejecutado ninguna sincronización desde el 25 de marzo 2026**, y la razón es:

- `organizations.is_active = false` para Tarbaca.
- El cron `auto-sync-invoices` filtra `is_active = true` (línea 109), por lo que **Tarbaca está siendo omitida en todas las corridas**, aunque Gmail se reconectó ayer (04-jun) y QuickBooks está activo.
- La última corrida (25-mar) terminó en error `Gmail API error 403`, y desde entonces alguien marcó la organización como inactiva.

El badge dice la verdad: no hay sincronización porque la organización está desactivada.

### 2) Tree of Life — "está sumando IVA donde no corresponde"

Configuración actual:
- `system_settings.default_uses_tax = 'false'` (IVA como gasto) ✅
- `settings.tax_handling = 'included_in_line_items'` (IVA al gasto en líneas) ✅

Auditoría XML vs QBO de las últimas 10 facturas publicadas:

```text
9 OK, 0 IVA separado, 1 mismatch
```

Todas las facturas normales publicadas en QBO tienen `TotalAmt` idéntico al `totalComprobante` del XML (ej. 21,855.33 / 79,100 / 3,000,000.84 / 68,295.32 — todos coinciden con `GlobalTaxCalculation=NotApplicable` y `TotalTax=0`).

El único "mismatch" es una **nota de crédito** (`00100501030000008297`): XML −21,855.33, QBO +21,855.33. Esto es correcto en QBO porque las `VendorCredit` se almacenan con monto positivo (el signo lo da el tipo de entidad, no el `TotalAmt`); el auditor compara con signo y por eso lo marca.

Necesito el número de factura o el proveedor específico que estás viendo inflado para reproducirlo, porque los datos actuales en QBO de Tree of Life respetan exactamente el `totalComprobante` del XML.

---

## Cambios propuestos

### A. Reactivar Tarbaca y endurecer la visibilidad

1. **Reactivar la organización en BD**
   ```sql
   UPDATE public.organizations
   SET is_active = true, updated_at = now()
   WHERE id = 'e03a56ce-8936-4591-8c1c-f8c067efe89d';
   ```

2. **Disparar primera sincronización manual** (Gmail) para que se cree un nuevo `sync_logs` y el badge se ponga verde.

3. **Mejorar el badge "Última sync"** en `src/pages/Dashboard.tsx`:
   - Si `organizations.is_active = false` → mostrar badge ámbar "Organización inactiva — la sincronización está pausada" (en vez de "Sin registros" o una fecha vieja). Esto evita confusión futura.
   - Tooltip con la causa exacta del último `sync_logs.error_message`.

4. **Alerta en SystemAlertsPanel**: si han pasado >24 h sin un `sync_logs` exitoso para una org con integraciones activas, levantar issue `stale_sync` con botón "Sincronizar ahora".

### B. Caso Tree of Life (pendiente de evidencia)

Como las 10 facturas auditadas hoy respetan el XML al céntimo, antes de tocar el publicador necesito:

- El número de factura (o `doc_key`) específico donde ves el monto inflado, o
- Aprobación para correr el auditor sobre los últimos 30 días de Tree of Life y entregar la lista de discrepancias reales antes de cambiar lógica de publicación.

No voy a tocar `publish-to-quickbooks` "preventivamente" porque podría romper las facturas que hoy están correctas.

---

## Archivos a modificar (parte A)

- Migración SQL: `UPDATE organizations SET is_active = true ...`
- `src/pages/Dashboard.tsx` — badge "Última sync" con estado `inactive`
- `src/hooks/useDashboardStats.ts` — exponer `is_active` de la organización
- `src/components/dashboard/SystemAlertsPanel.tsx` — issue `stale_sync`
