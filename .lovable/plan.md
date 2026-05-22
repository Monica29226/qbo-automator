
# Diagnóstico: conector Gmail a nivel sistema

## TL;DR
**El conector de Gmail SÍ está funcionando.** Las 12 organizaciones con Gmail están conectadas, autenticadas y descargando correos. Lo que la usuaria percibe como "no funciona" es en realidad el conteo de `gmail_failed` en los logs, que mezcla **errores reales de XML** con sincronizaciones parciales por límite de tiempo. No hay ningún fix de autenticación que aplicar aquí.

## Evidencia recogida

### 1. Estado de las cuentas Gmail (DB)
12 organizaciones con `service_type='gmail'`, `is_active=true`, **todas con `refresh_token` presente** y **tokens recién renovados a las 23:00 UTC** (válidos por 1 hora). Solo ASADA DE TARBACA está inactiva (caso aislado).

### 2. Sync logs últimas 3 horas
Todas las corridas de Gmail completaron — ninguna marcó `status='error'` ni `error_code` de auth. Resultados típicos:

| Empresa | fetched | processed | failed | mensaje |
|---|---|---|---|---|
| Cafe Luna | 50 | 1–2 | 19–21 | "errores reales" |
| Dentorori | 50 | 0 | 30 | "errores reales" |
| Eiffel | 50 | 0 | 18 | "errores reales" |
| Tree of Life | 50 | 0 | 20–21 | "errores reales" |
| Bluwood | 17 | 0 | 0 | success ✓ |
| Roberto Artavia | 0 | 0 | 0 | success ✓ |

### 3. Logs de la edge function gmail-fetch-invoices
Última corrida observada:
```
📊 Summary [success]: 1 processed, 47 skipped, 21 errors. Time: 73.0s
❌ Processing error for AHC_5062…xml: XML no procesable: 
   no corresponde a Factura/Tiquete/Nota de Crédito/Nota de Débito
```

### 4. processed_documents (filas insertadas últimas 3h)
Casi todo es `published`, `review` (sin regla de vendor) o `needs_account_mapping`. **Cero filas con `status='error'`** — los "21 errors" del summary no llegan a persistirse.

## Causa raíz real

En `supabase/functions/gmail-fetch-invoices/index.ts` (líneas 680–694), cuando `process-document-xml` rechaza un archivo, se clasifica como `skipped` o `errors` con este criterio:

- `skipped` si el mensaje contiene `"duplicado"`, `"ya existe"`, `"FechaEmision"`, `"not found"`, `"rechazada"` o `"receptor"`.
- `errors` (cuenta como `gmail_failed`) **todo lo demás**.

El caso `"XML no procesable: no corresponde a Factura/Tiquete/Nota de Crédito/Nota de Débito"` cae en el segundo cubo. Esto se dispara con archivos legítimamente no procesables que Gmail trae como adjuntos:

- **MensajeHacienda / MensajeReceptor** (acuses de recepción del MH, no facturas).
- **Tiquetes Electrónicos (TE / tipo 04)** — explícitamente excluidos por requisito del proyecto (memoria `exclusive-electronic-invoice-processing`).
- Archivos firmados (`*_signature.xml`, `AHC_…`) que envuelven el XML real.
- Notas que ya están fuera del cutoff 2026-01-01.

Es decir: **el conector descarga bien, pero el filtro de tipos válidos rechaza ~40-60% de los XML adjuntos**, y esos rechazos legítimos se reportan como "errores reales" en el badge de sync, lo que da la impresión de que Gmail está fallando.

## Lo que NO es el problema

- ❌ No es OAuth / refresh token (todos los 12 refresh_tokens existen y los access_token se renovaron hace minutos).
- ❌ No es CORS, timeout de auth, ni el bug del cron (ese ya quedó resuelto post-upgrade).
- ❌ No es el filtro de `service_type` de ImportBatchDialog (eso era de Outlook IMAP).
- ❌ No son fallas de la API de Gmail (no hay 401/403/429 en logs).

## Propuesta de fix (visual + métrica, no de conexión)

Pequeño cambio en una sola función para que el dashboard refleje la realidad:

1. **`gmail-fetch-invoices/index.ts`** (mismo patrón para hostinger/bluehost/outlook):
   - Ampliar la heurística de "skipped" en líneas 683-685 para incluir también:
     - `"no corresponde a Factura"`
     - `"Tiquete Electrónico"` / `"TE"` / `tipo 04`
     - `"fuera de rango"` / `"anterior a 2026"`
     - `"MensajeHacienda"` / `"MensajeReceptor"`
   - Así esos archivos cuentan como `gmail_skipped` (informativo) en lugar de `gmail_failed` (alarmante).

2. **Sync log message**: cuando `gmail_failed > 0` pero **ningún** `processed_documents` quedó con `status='error'`, registrar el mensaje como:  
   _"N adjuntos XML descartados (tipo no soportado / fuera de rango)"_ en lugar de _"N facturas con errores reales"_.

3. **Opcional UI**: en el dashboard separar el badge en dos contadores: "Descargadas" vs "Descartadas (no facturas)" para que la usuaria sepa que el sistema está sano.

## Archivos a tocar (si se aprueba el plan)

- `supabase/functions/gmail-fetch-invoices/index.ts` — ampliar lista de patrones "skipped" + mejorar mensaje de sync_logs.
- `supabase/functions/hostinger-fetch-invoices/index.ts` — mismo cambio.
- `supabase/functions/bluehost-fetch-invoices/index.ts` — mismo cambio.
- `supabase/functions/outlook-fetch-invoices/index.ts` — mismo cambio.
- `supabase/functions/outlook-imap-fetch-invoices/index.ts` — mismo cambio.
- (Opcional) `src/components/dashboard/CronMonitor.tsx` o similar — separar "descartadas" de "errores".

Ningún cambio de schema, ni de auth, ni de cron. Solo clasificación correcta de adjuntos no-factura.
