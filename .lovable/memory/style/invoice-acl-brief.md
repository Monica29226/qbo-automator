---
name: Invoice ACL · FacturaFlow brief
description: Design system applied to the app shell — navy sidebar, pipeline band, monthly KPIs in colones, Caslon headings, royal "Sincronizar ahora" button, QBO sync pill at top of sidebar
type: design
---

App shell follows the ACL Calderón brand brief:

- Sidebar: navy `--sidebar` background, ACL monogram + "Invoice ACL / FacturaFlow", QBO sync pill at top (green when connected & last sync ≤ 60 min, amber when stale, red when disconnected), nav, user/sign-out at bottom.
- Topbar: white card bg, Caslon title "Panel de Control" + subtitle, royal `--secondary` "Sincronizar ahora" button, OrganizationSwitcher, contextual error button.
- Dashboard top section: `PipelineBand` (Correo recibido → XML extraído → IVA validado → Sincronizado QBO with chevrons and real counts for the current month) followed by `MonthlyKpis` (Facturas del mes with vs-prev-month %, Monto IVA in ₡ compact, Por validar, Tiempo ahorrado = facturas × 8 min).
- Login: split layout — left navy panel with ACL quote ("Sus facturas, del correo a QuickBooks — validadas y sin digitar una sola línea."), XML v4.x / IVA / QBO triad and "Conectado con QuickBooks Online" note; right panel with the form + Google OAuth.
- Currency: always colones with `formatCRC` / `formatCRCCompact` from `src/lib/format.ts`, applied with `tabular-nums`.
- Fonts: `font-heading` = Libre Caslon Text (titles, KPI numerals), `font-body` = Montserrat (everything else). Never redefine palette or fonts in components — use the existing tokens.
