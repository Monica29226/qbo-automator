# Agrícola Lloronal: por qué hay facturas con error

De 406 documentos, 378 ya están en QuickBooks. Quedan 28 detenidos, por tres causas distintas:

## 1. Cuatro facturas del 1 de setiembre — corte de conexión momentáneo

Estas cuatro fallaron porque la consulta del proveedor a QuickBooks tardó más de 8 segundos y el
sistema cortó el intento. No es un problema del dato: la factura está completa y se puede reenviar.

- C.R.C Consultores en Agrogestión — 1,017,000
- Cooperativa Dos Pinos — 321,722.95
- Ramoco ADT — 58,195
- Los Guacos de Roca Blanca — 678,000

Acción: reintentar el envío y, para que no vuelva a pasar, dar un segundo intento automático
cuando la búsqueda del proveedor se agote, en vez de marcar la factura como error.

## 2. Siete facturas esperando la cuenta de gasto (7 facturas, 32,492,453 en total)

Estas facturas traen una cuenta contable antigua (códigos 1150040009, 1150040011, 1150040016,
1150040022) que no existe en QuickBooks. Lloronal no tiene ninguna equivalencia registrada, así que
el sistema las detiene en lugar de mandarlas a una cuenta equivocada.

Proveedores afectados: Estructiva (2), Sergio Ruiz Esquivel (3), Michael Quirós Sequeira,
Almacén Siglo Veintiuno.

Acción: en la pantalla de equivalencias de cuentas, indicar a qué cuenta de gasto de QuickBooks
corresponde cada uno de los cuatro códigos. En cuanto queden definidas, las siete se envían solas.
Requiere que usted elija las cuentas; el sistema no debe inventarlas.

## 3. Diecisiete facturas en revisión — proveedor sin regla

Diecisiete facturas (setiembre en su mayoría: Interpack, Concrecasa, Greivin Montero, Discolure,
entre otras) están en la cola de revisión porque el proveedor no tiene una cuenta de gasto asignada.

Acción: clasificarlas desde la cola de revisión. Al asignar la cuenta a un proveedor, la regla se
guarda y las siguientes facturas de ese proveedor entran sin detenerse.

## Detalle técnico

- Causa del grupo 1: en `publish-to-quickbooks`, `findOrCreateVendor` aborta la consulta de
  `Vendor` a los 8000 ms y lanza `Timeout buscando proveedor`, sin reintento. Se agrega un
  reintento (1 vez, 12 s) antes de marcar `status='error'`.
- Grupo 2: `legacy_account_mapping` está vacío para la organización; el publicador bloquea los
  códigos legacy `1150040XXX` por diseño. Solo faltan las filas de mapeo.
- Grupo 3: `status='review'` con `Proveedor sin regla automática`; se resuelve con datos, sin cambio
  de código.
- No se toca la lectura del XML: montos e IVA se conservan literales.

## Orden de ejecución

1. Agregar el reintento en la búsqueda de proveedor.
2. Reenviar las 4 facturas del grupo 1 y reportar el resultado con el ID de QuickBooks.
3. Esperar sus cuentas para los 4 códigos legacy y luego publicar las 7.
4. Dejar las 17 de revisión para clasificar (puedo listarlas por proveedor si lo desea).
