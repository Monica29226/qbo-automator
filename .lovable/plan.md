## Filtros en Administrativo · Cuentas por Pagar

Añadir una fila de filtros arriba de la tabla en `src/pages/AdminPayments.tsx`, junto al buscador actual.

### Filtros nuevos
- **Rango de fechas** (desde / hasta) sobre `issue_date` — dos `Input type="date"` o `Popover` con calendario (`react-day-picker` ya disponible vía shadcn `Calendar`).
- **Proveedor** — `Combobox` con la lista única de `supplier_name` derivada de las facturas cargadas (autocompletar, multi opcional pero arrancamos con selección única).
- **# Factura** — `Input` de texto (búsqueda parcial, ya existe en el buscador general pero se separa como campo dedicado).
- Mantener el buscador global existente (clave, referencia).
- Botón **Limpiar filtros**.

### Cambios técnicos
- Estado local: `dateFrom`, `dateTo`, `supplierFilter`, `docNumberFilter`.
- `filtered` (useMemo) aplica todos los filtros combinados con el `search` actual.
- KPIs (totales CRC/USD, count, vencidas) se recalculan sobre `filtered` en lugar de `invoices` para que reflejen lo que el usuario ve. (Confirmar si prefieren mantener totales globales — por defecto: usar filtrados.)
- Lista de proveedores única ordenada alfabéticamente, derivada de `invoices`.
- Layout: una fila responsive `grid md:grid-cols-4 gap-2` dentro del `CardHeader`, con el buscador global arriba o al lado.

### Archivos a modificar
- `src/pages/AdminPayments.tsx` (único cambio)

Sin cambios de backend, esquema ni edge functions.
