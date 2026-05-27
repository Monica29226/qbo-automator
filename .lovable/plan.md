# Por qué la sincronización dijo "Total 332" y nada más

Los logs de `sync-from-excel` confirman:

```
📋 332 rows
✅ Summary: processed=0 alreadyQBO=0 alreadyDB=0 notFound=0 failed=0 skipped=0
```

Tomó **1.1 segundos**. Eso quiere decir que el loop iteró las 332 filas y todas cayeron en `if (!docNumber && !clave) continue;` — **nunca llamó a `search-import-invoice`**, nunca tocó Hostinger/Gmail/Bluehost/Outlook.

Causa: el código busca headers exactos `"Consecutivo Documento" | "Consecutivo" | "NumeroConsecutivo"` y `"Clave" | "Clave Numerica"`, pero el Excel de Siku usa otros nombres (probablemente con tildes, mayúsculas distintas, espacios extra, o nombres como `"Número Consecutivo"`, `"Clave Numérica"`, `"Clave Comprobante"`, etc.).

# Plan de fix (3 cambios mínimos)

## 1. `supabase/functions/sync-from-excel/index.ts` — detección robusta de headers

- Al recibir las filas, tomar `Object.keys(rows[0])` y loguearlas una vez: `log("Headers detectados: ...")` para que en logs siempre veamos qué viene.
- Reemplazar el lookup directo por una función `pickField(row, candidates)` que:
  - Normaliza ambos lados (lowercase, sin tildes, sin espacios extra, sin signos de puntuación)
  - Prueba candidatos para clave: `clave`, `clavenumerica`, `clavecomprobante`, `claveelectronica`, `numeroclave`
  - Prueba candidatos para consecutivo: `consecutivo`, `consecutivodocumento`, `numeroconsecutivo`, `numerodocumento`, `numero`, `documento`
  - Prueba candidatos para emisor: `nombreemisor`, `emisor`, `nombre`, `proveedor`, `razonsocial`
- Si en una fila no encuentra ni clave ni consecutivo, incrementar un contador nuevo `rows_skipped_no_id` y guardar `{row_index, available_keys}` en `details` (solo las primeras 3) para diagnóstico.
- Devolver siempre todos los contadores en el response, incluyendo `skipped_timeout` y `rows_skipped_no_id`, aunque sean 0.
- Agregar en el response `detected_headers: string[]` (las columnas que vino en el Excel) para que la UI las muestre cuando todo sea 0.

## 2. `src/components/SyncFromExcelDialog.tsx` — mostrar diagnóstico

- Cambiar `SyncResult` para incluir `skipped_timeout?`, `rows_skipped_no_id?`, `detected_headers?`.
- Renderizar **siempre** todas las tarjetas (Procesados, Ya en QB, Ya en BD, No encontrados, Fallidos, Saltados sin ID) aunque el valor sea 0, para que el usuario vea explícitamente que "No encontrados = 0" y entienda que no se buscó nada.
- Si `rows_skipped_no_id === total` (caso actual), mostrar un alert rojo:
  > "No se reconoció la columna de Clave/Consecutivo en el Excel. Headers detectados: `[lista]`. Renombrá la columna a 'Clave' o 'Consecutivo Documento', o avisanos para agregar el header."
- Mostrar el toast `"Buscando en Hostinger/Bluehost/Gmail/Outlook"` solo si realmente hay filas con ID; si no, mostrar el alert de diagnóstico.

## 3. Verificación

- Después del fix, re-subir el mismo Excel de Siku de Terranoa.
- Confirmar en logs de `sync-from-excel`:
  - `Headers detectados: [...]`
  - `rows_skipped_no_id` baja de 332 a ~0
  - Empiezan a aparecer llamadas a `search-import-invoice`
- En la UI, el diálogo debe mostrar conteos no-cero en "No encontrados" y/o "Procesados", confirmando que sí fue al correo.

# Lo que NO se va a tocar

- `search-import-invoice`, `hostinger-fetch-invoices`, `bluehost-fetch-invoices`, `gmail-fetch-invoices`, `outlook-imap-fetch-invoices`: ya funcionan, el problema está antes de llamarlos.
- Lógica de publicación a QuickBooks.
- Score de estabilidad.

# Detalles técnicos (para implementación)

```ts
// normalizador
const norm = (s: string) =>
  s.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

function pickField(row: Record<string, any>, candidates: string[]): string {
  const normalizedRow: Record<string, any> = {};
  for (const k of Object.keys(row)) normalizedRow[norm(k)] = row[k];
  for (const c of candidates) {
    const v = normalizedRow[norm(c)];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}
```

Esto resuelve el bug de fondo: la sincronización **sí ejecuta el flujo Excel → BD → IMAP → QBO**, pero solo si el Excel tiene una columna que matchee. El fix lo hace tolerante a variantes de nombre y le da al usuario feedback claro cuando no matchea.
