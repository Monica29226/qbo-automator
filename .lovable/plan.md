# Doral Overseas: por qué no se envían las facturas

## Lo que encontré (verificado en la base de datos)

Doral tiene 115 comprobantes cargados: **66 en error**, **43 esperando clasificación**, 5 enviados y 1 pendiente.

Son dos problemas distintos, ninguno es una falla de importación:

1. **66 en error — QuickBooks de Doral no tiene el impuesto del 13% configurado.**
   El mensaje es el mismo en los 66: falta el código de impuesto de 13% en QuickBooks. El sistema
   bloquea la publicación a propósito, para no registrar un monto distinto al de la factura.
   La prueba: las 5 facturas que sí se enviaron son exactamente las que traen IVA en cero.

2. **43 esperando clasificación — el proveedor no tiene cuenta de gasto asignada.**
   Doral tampoco tiene cuenta de gasto por defecto, así que ningún proveedor nuevo se resuelve solo.

## Qué propongo hacer

### Para las 66 con error, dos caminos (usted elige uno)

- **Camino A — configurar el IVA en QuickBooks de Doral (recomendado si quiere ver el impuesto separado).**
  Se crea en QuickBooks el impuesto de compras al 13% y luego yo reintento las 66. El impuesto queda
  registrado como tal, igual que en las demás empresas.
- **Camino B — registrar el IVA dentro del gasto** (es lo que ya usa Tree of Life). No requiere tocar
  QuickBooks: se activa esa modalidad para Doral y las 66 se reintentan de inmediato. El total de cada
  factura queda idéntico al del XML, pero el IVA no se separa en QuickBooks.

En ambos casos no se recalcula nada: los montos salen literales del XML y solo se marca como enviada
si QuickBooks devuelve el documento creado.

### Para las 43 sin clasificar

1. Definir la cuenta de gasto por defecto de Doral.
2. Asignar cuenta a los proveedores que aparecen repetidos (la asignación se propaga a todas las
   facturas pendientes de ese proveedor).
3. Publicar en bloque lo que quede listo.

### Cierre

Reviso al final que no haya ninguna factura marcada como enviada sin el documento real en QuickBooks,
ni claves repetidas, y le entrego el conteo final por estado.

## Detalles técnicos

- Empresa `5e403346-7122-4a13-b524-95834515ef56`, realm QBO `9341457852771666`.
- El bloqueo viene de la prevalidación de `publish-to-quickbooks`: no encuentra `TaxCodeRef` ni
  `TaxRateRef` para 13% y se niega a degradar a "fuera del alcance".
- Camino B = `system_settings.tax_handling = 'included_in_line_items'` para esta empresa
  (`includeTaxInLines`, omite `TaxCodeRef` con `GlobalTaxCalculation=NotApplicable`).
- `organizations.default_account_ref` está vacío; hay que fijarlo y cargar reglas de proveedor.
- Sin cambios de código: es configuración por empresa más reintento de publicación.
