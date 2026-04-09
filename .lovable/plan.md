

# Plan: Alinear formato de DocNumber en todas las funciones

## Problema
Tres funciones aún usan la lógica vieja de truncar a 21 caracteres, mientras que `publish-to-quickbooks` y `publish-sales-to-quickbooks` ya usan la lógica nueva (extraer últimos 10 dígitos). Esta inconsistencia puede causar que el sistema no detecte duplicados correctamente.

## Cambios

### 1. `supabase/functions/batch-publish-all/index.ts`
- **Línea 209** (función `checkDuplicateInQBO`): Cambiar de `docNumber.length > 21 ? docNumber.substring(docNumber.length - 21) : docNumber` a la lógica nueva
- **Línea 548** (creación del Bill): Mismo cambio

Lógica nueva en ambos puntos:
```typescript
const qboDocNumber = docNumber.length === 20
  ? docNumber.substring(10).replace(/^0+/, '') || '0'
  : (docNumber.length > 21 ? docNumber.substring(docNumber.length - 21) : docNumber);
```

### 2. `supabase/functions/migrate-tracking-records/index.ts`
- **Líneas 95-97**: Cambiar la asignación de `qbo_doc_number` a la misma lógica nueva

### 3. `supabase/functions/force-publish-document/index.ts`
- **Líneas 190-192**: Cambiar la asignación de `docNumber` a la misma lógica nueva

### 4. Redesplegar las 3 funciones

## Impacto
- Todas las funciones usarán el mismo formato de DocNumber (ej: `67534` en vez de `00100008010000067534`)
- La detección de duplicados funcionará correctamente entre funciones
- Facturas ya publicadas con formato largo no se ven afectadas (el check primario de duplicados usa `clave_hacienda` en la tabla de tracking, no el DocNumber)

