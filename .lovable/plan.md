

# Plan: Corregir el número de documento enviado a QuickBooks

## Problema
El sistema envía el `NumeroConsecutivo` completo (20 dígitos, ej: `00100008010000067534`) como `DocNumber` a QuickBooks. Este número incluye prefijos internos de Hacienda (sucursal, terminal, tipo). El número real de la factura que aparece en el PDF es solo la parte consecutiva (últimos 10 dígitos: `0000067534`, o sin ceros: `67534`).

Esto causa que en QuickBooks el número no coincida con lo que el proveedor y el usuario ven en la factura física.

## Estructura del NumeroConsecutivo (Costa Rica)
```text
00100008010000067534
SSS = 001 (sucursal)
CCC = 000 (caja/terminal)  
MM  = 08  (tipo: 01=FE, 03=NC, 08=FEC, etc.)
NNNNNNNNNN = 0000067534 (consecutivo real)
```

## Cambio propuesto

**Archivo: `supabase/functions/publish-to-quickbooks/index.ts`**

Modificar la lógica de `qboDocNumber` (líneas ~1212 y ~2225) para extraer solo los últimos 10 dígitos del `NumeroConsecutivo` y eliminar ceros a la izquierda innecesarios, pero manteniendo el consecutivo completo en el `PrivateNote` para trazabilidad.

Lógica nueva:
```
// Extraer consecutivo real: últimos 10 dígitos del NumeroConsecutivo
if doc_number tiene 20 dígitos exactos:
  qboDocNumber = últimos 10 dígitos sin ceros iniciales (ej: "67534")
else:
  truncar a 21 chars como antes (fallback)
```

Actualizar ambas ocurrencias (línea ~1212 en `registerInTracking` y línea ~2225 antes de crear el Bill/VendorCredit).

El `PrivateNote` ya incluye la clave completa, así que la trazabilidad se mantiene.

## Impacto
- Aplica a **todas las compañías** (lógica global)
- Solo afecta facturas nuevas; las ya publicadas mantienen su número en QBO
- El `doc_number` en la base de datos NO cambia (se mantiene el consecutivo completo)
- Solo cambia lo que se envía como `DocNumber` a QuickBooks

