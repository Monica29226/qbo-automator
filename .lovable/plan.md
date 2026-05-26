# Diagnóstico Centro Médico Terranoa

## Lo que está pasando (datos reales)

**Organización:** `CENTRO MEDICO TERRANOA SOCIEDAD ANONIMA`
**Proveedor de correo:** Hostinger IMAP (`info@centromedicoterranoa.com`)
**QuickBooks:** conectado ✅

### Facturas publicadas por mes
| Mes | Publicadas | Esperado |
|---|---|---|
| Ene 2026 | 37 | ~90 |
| Feb 2026 | 13 | ~90 |
| Mar 2026 | 5 | ~90 |
| Abr 2026 | 29 | ~90 |
| **May 2026** | **15** | ~90 |

Hay un **déficit grande** consistente en todos los meses.

### Estado de la sincronización (últimas 20 corridas del cron)
- Hostinger reporta **510 mensajes** en el buzón filtrado.
- Cada corrida solo procesa **0–4 facturas** y termina como `partial` por límite de tiempo (60–95 s).
- El cursor de reanudación `hostinger_resume_skip` está en **300** y avanza lentísimo (~3 por corrida cada 30 min).
- En el dashboard aparece alerta **"Email IMAP (Hostinger) desconectado · Reconectar"** aunque `is_active=true` en BD (credenciales sin refrescar desde 15-may).

### Causa raíz
1. **Backlog gigante de 510 correos** mezclados con XML/PDF que el cron de 30 min no alcanza a drenar.
2. La función `hostinger-fetch-invoices` está procesando muy pocos mensajes por chunk (tiempo casi todo gastado en IMAP FETCH/decode, no en parseo).
3. La integración Hostinger probablemente perdió la contraseña/IMAP login (de ahí la alerta del banner), por lo que las nuevas facturas tampoco entran limpio.
4. 3 facturas quedaron en `review` (pendientes de configuración de proveedor) y no llegan a publicarse.

## Plan propuesto (NO importar lote todavía)

### Fase 1 — Reparar la conexión Hostinger
- Confirmar/actualizar credenciales IMAP de `info@centromedicoterranoa.com` desde **Conexiones → Hostinger → Reconectar**.
- Validar login con un fetch manual de 1 chunk y revisar `sync_logs` (debe quedar `success`, no `partial` con error de auth).

### Fase 2 — Drenar el backlog de 510 correos
- Ejecutar **Recuperar Backlog** (`recover-org-backlog`) varias veces seguidas para esa organización con `max_chunks=30`. Esto:
  - Reanuda desde `skip=300` ya guardado.
  - Procesa hasta 30 chunks por llamada usando el service-role (más rápido que cron de 30 min).
  - Limpia el cursor cuando termine.
- Monitorear con `sync_logs` por cada corrida hasta que `gmail_fetched` baje o se procese todo el rango.

### Fase 3 — Resolver las 3 facturas en `review`
- Abrir **Configuración Pendiente** para Terranoa.
- Asignar cuenta contable a los proveedores nuevos para que el auto-publish las suba a QBO.

### Fase 4 — Auditoría de huecos
- Comparar consecutivos Hacienda (clave) por mes contra QBO con el botón **Reconciliar XML vs QBO**.
- Listar los `NumeroConsecutivo` faltantes mes a mes para saber **exactamente cuántas y cuáles** facturas se perdieron.

### Fase 5 — Importar Lote (solo cuando 1–4 estén OK)
- Una vez confirmado qué consecutivos faltan, usar `/admin/batch-import-v2` con el ZIP que contenga esos XML específicos + el MensajeReceptor de Hacienda + el PDF.
- El sistema validará namespace, clave de 50 dígitos, deduplicación contra `qbo_publish_tracking` y solo publicará los aceptados por Hacienda (`Mensaje=1`).

---

## Detalle técnico

- **Tablas/funciones revisadas:** `organizations`, `processed_documents`, `sync_logs`, `system_settings`, `integration_accounts`, función `hostinger-fetch-invoices`, función `recover-org-backlog`.
- **Cursor activo:** `system_settings.hostinger_resume_skip_a247170a-b083-41e5-82b9-17ca46a37fa2 = 300`.
- **Tiempos cron:** 60–95 s por corrida (cerca del límite duro). Por eso es crítico drenar con `recover-org-backlog` que corre fuera del cron.
- **Riesgos:** si se importa lote ANTES de drenar el backlog, las mismas facturas pueden llegar dos veces (el dedupe por `doc_key` lo evita, pero ensucia el log y consume ciclos QBO).

---

## Pregunta antes de implementar

1. ¿Confirmás que primero corra **Fase 1 (reconectar Hostinger)** y **Fase 2 (drenar backlog con recover-org-backlog)**, y recién después pasemos a Fase 4 (auditar huecos) y Fase 5 (importar lote)?
2. ¿Tenés acceso a la contraseña IMAP de `info@centromedicoterranoa.com` para reconectar? Si no, hay que pedirla a Terranoa.
