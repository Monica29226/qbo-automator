

# Diagnóstico: Por qué Bluehost IMAP se cuelga para Centro Médico San Antonio

## Causa raíz identificada

El problema es el **escaneo individual de BODYSTRUCTURE** en el paso de pre-filtrado. Los logs muestran:

```text
INBOX: 361 messages in range → 287 candidates → solo puede procesar 6-9 antes del timeout
Tiempo total: 91-101 segundos → Edge Function timeout (150s)
```

**Flujo actual (líneas 281-303):**
1. IMAP SEARCH devuelve ~361 mensajes (SINCE 01-Jan-2026)
2. El sistema hace `FETCH {msgId} BODYSTRUCTURE` **uno por uno** para hasta 300 mensajes
3. Cada round-trip IMAP toma ~200-500ms → 300 × 300ms = **~90 segundos solo en pre-filtrado**
4. Luego intenta `FETCH BODY[]` para cada candidato → se queda sin tiempo
5. El cron detecta el proceso "stuck" después de 30 min y lo marca como `stuck_timeout`

**¿Por qué Café Luna funciona?** Usa Gmail (API REST, rápida), no IMAP sobre un servidor Bluehost lento.

## Solución propuesta (3 mejoras)

### 1. Usar FETCH por rangos en vez de individual (mayor impacto)
En lugar de hacer 300 llamadas individuales `FETCH {id} BODYSTRUCTURE`, usar un solo comando batch:
```typescript
// ANTES (300 round-trips):
for (const msgId of msgIdsToScan) {
  const structResp = await cmd(`FETCH ${msgId} BODYSTRUCTURE`);
}

// DESPUÉS (1 round-trip):
const range = `${msgIdsToScan[0]}:${msgIdsToScan[msgIdsToScan.length-1]}`;
const batchResp = await cmd(`FETCH ${range} BODYSTRUCTURE`, true);
// Parse all responses from single batch
```
Esto reduce ~90 segundos a ~3-5 segundos.

### 2. Limitar el rango de búsqueda desde la última importación
El sistema ya tiene lógica para esto (líneas 546-559), pero el cron no pasa `month`/`year`, y si hay un `start_date` setting configurado en enero, busca desde enero. Cambiar para que el rango sea dinámico: solo buscar desde 7 días antes de la última factura importada.

### 3. Limitar mensajes pre-filtrados a 50 (no 300)
Reducir `msgIdsToScan` de `allMsgIds.slice(-300)` a `allMsgIds.slice(-50)` y compensar con la paginación ya existente.

## Archivos a modificar

**`supabase/functions/bluehost-fetch-invoices/index.ts`:**
- Líneas 281-303: Reemplazar escaneo individual de BODYSTRUCTURE con fetch batch por rango
- Línea 282: Reducir límite de 300 a 80 mensajes por ronda
- Agregar parser para respuestas batch de BODYSTRUCTURE

## Impacto esperado
- Tiempo de IMAP: de ~90-100s → ~10-15s por ronda
- El cron dejará de quedarse "stuck"
- Las facturas pendientes (marzo 24 → abril 14) se importarán automáticamente
- No afecta la lógica de procesamiento de documentos ni QuickBooks

