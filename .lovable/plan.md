

# Fix: Sistema de Recepcion de Facturas - 6 Problemas Criticos

## Resumen

Hay 6 problemas identificados en `auto-sync-invoices`, `bluehost-fetch-invoices` y `hostinger-fetch-invoices` que causan que no todas las companias reciban sus facturas. A continuacion el analisis y solucion de cada uno.

---

## Problema 1 - Filtro QuickBooks obligatorio excluye companias sin QBO

**Archivo:** `supabase/functions/auto-sync-invoices/index.ts` linea 89

**Bug:** `.eq("quickbooks_connected", true)` impide que organizaciones con email conectado pero sin QuickBooks activo reciban facturas.

**Fix:** Quitar el filtro `quickbooks_connected`. Solo filtrar por `is_active`. La publicacion a QBO ya tiene su propia validacion interna; si QBO no esta conectado, simplemente se omite esa fase pero las facturas se importan correctamente.

**Cambio adicional:** En `processOrganization`, hacer condicional la fase de publicacion a QuickBooks - solo intentar si la organizacion tiene `quickbooks_connected=true`. Actualmente intenta publicar para todas.

---

## Problema 2 - processOrganization llama correctamente segun tipo de email

**Archivo:** `supabase/functions/auto-sync-invoices/index.ts` lineas 172-186

**Resultado:** El codigo YA determina correctamente el provider con un `if/else if` chain (gmail -> outlook -> bluehost -> hostinger). Esto funciona bien para organizaciones con un solo provider. No hay bug aqui.

---

## Problema 3 - Ventana de busqueda limitada al mes actual

**Archivo:** `supabase/functions/bluehost-fetch-invoices/index.ts` linea 416
**Archivo:** `supabase/functions/hostinger-fetch-invoices/index.ts` linea 517

**Bug:** Si estamos a inicio de febrero y hay facturas de enero que fallaron, se pierden porque la busqueda arranca el 1ro del mes actual.

**Fix:** Cambiar la ventana default a **primer dia del mes anterior** en ambos archivos:

```text
// Antes:
startDate = new Date(now.getFullYear(), now.getMonth(), 1);

// Despues:
startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
// JavaScript maneja correctamente month==-1 (se convierte a diciembre del ano anterior)
```

La deduplicacion por `doc_key` evita reprocesamiento de facturas ya importadas.

---

## Problema 4 - Credenciales IMAP por organizacion

**Resultado:** El codigo YA lee credenciales correctamente desde `integration_accounts` filtrando por `organization_id` y `service_type = "bluehost"` (lineas 375-383). Cada empresa usa sus propias credenciales IMAP almacenadas. No hay bug aqui.

---

## Problema 5 - Limite de organizaciones en modo cron

**Resultado:** El query en linea 86 NO tiene `.limit()`. Sin embargo, Supabase tiene un limite default de 1000 filas por query, lo cual es mas que suficiente. No hay bug aqui.

---

## Problema 6 - Manejo de errores en dispatch

**Archivo:** `supabase/functions/auto-sync-invoices/index.ts` lineas 107-123

**Bug:** Si el dispatch HTTP falla (network error), solo se hace `console.error` y se pierde. No queda registro en `sync_logs`.

**Fix:** Agregar registro de fallo en `sync_logs` para cada dispatch que falle, y implementar un reintento unico antes de descartar:

```text
const dispatches = validOrgs.map(async (org) => {
  console.log(`Dispatching sync for ${org.name} (${org.id})`);
  
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(...);
      if (resp.ok || resp.status < 500) return resp;
      // Server error - retry
      console.warn(`Dispatch attempt ${attempt+1} failed for ${org.name}: ${resp.status}`);
    } catch (err) {
      console.warn(`Dispatch attempt ${attempt+1} network error for ${org.name}:`, err);
    }
    if (attempt === 0) await new Promise(r => setTimeout(r, 1000));
  }
  
  // Both attempts failed - log to sync_logs
  await supabase.from("sync_logs").insert({
    organization_id: org.id,
    trigger_type: trigger,
    status: "error",
    error_message: "Dispatch failed after 2 attempts",
    completed_at: new Date().toISOString(),
  });
  return null;
});
```

---

## Resumen de Cambios

| # | Archivo | Cambio |
|---|---------|--------|
| 1 | `auto-sync-invoices/index.ts` L89 | Quitar `.eq("quickbooks_connected", true)` |
| 1b | `auto-sync-invoices/index.ts` L217-260 | Condicionar publicacion QBO a `quickbooks_connected` |
| 2 | N/A | Sin cambios (ya funciona correctamente) |
| 3 | `bluehost-fetch-invoices/index.ts` L416 | Ventana = mes anterior (month - 1) |
| 3b | `hostinger-fetch-invoices/index.ts` L517 | Ventana = mes anterior (month - 1) |
| 4 | N/A | Sin cambios (credenciales ya son por organizacion) |
| 5 | N/A | Sin cambios (no hay LIMIT) |
| 6 | `auto-sync-invoices/index.ts` L107-123 | Retry + registro en sync_logs |

**Archivos a modificar:** 3
- `supabase/functions/auto-sync-invoices/index.ts`
- `supabase/functions/bluehost-fetch-invoices/index.ts`
- `supabase/functions/hostinger-fetch-invoices/index.ts`

**Funciones a redesplegar:** `auto-sync-invoices`, `bluehost-fetch-invoices`, `hostinger-fetch-invoices`

