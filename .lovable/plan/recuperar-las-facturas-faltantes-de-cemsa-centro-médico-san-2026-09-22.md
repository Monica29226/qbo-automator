# Recuperar las facturas faltantes de CEMSA (Centro Médico San Antonio)

## Qué está pasando hoy

- La última factura registrada de CEMSA es del **14 de setiembre de 2026**. Hay 651 documentos en total: 630 publicados en QuickBooks, 18 en revisión y 2 con error.
- El buzón `facturacion@cemsacr.com` **rechaza la contraseña guardada** desde el 17 de setiembre (antes, el 15, falló por un certificado que no corresponde al servidor). El sistema lo intenta cada 30 minutos y cada intento termina en error, con cero correos leídos.
- Mientras el buzón no abra, ninguna factura nueva puede entrar de forma automática. No es un problema de procesamiento: es acceso al correo.

## Plan

### 1. Recuperar el acceso al buzón (lo primero)

Necesito dos datos del panel del hosting de cemsacr.com:

- la **contraseña actual** del buzón `facturacion@cemsacr.com`;
- el **nombre del servidor de correo entrante seguro** (IMAP) que indica el propio hosting.

Con eso actualizo la conexión de la empresa y confirmo la lectura en el momento, sin esperar al siguiente ciclo automático.

Si el hosting no permite recuperar la contraseña, la alternativa es cambiarla ahí mismo y darme la nueva.

### 2. Drenar todo el atraso desde el 14 de setiembre

Una vez abierto el buzón:

- leo **todas las carpetas** del correo (no solo la bandeja de entrada) desde el 14 de setiembre;
- registro cada factura electrónica dirigida a CEMSA, con los montos tal como vienen en el archivo de Hacienda;
- descarto duplicados y las facturas dirigidas a otro receptor, y rechazo tiquetes electrónicos;
- publico en QuickBooks las que ya tienen cuenta de gasto asignada y le dejo en revisión las que necesiten que usted elija la cuenta.

Al terminar le entrego el detalle: cuántas entraron, cuántas se publicaron, cuántas quedan esperando su clasificación.

### 3. Cerrar los pendientes viejos

- Reviso las 2 facturas con error y las 18 en revisión y le indico qué falta en cada una.

### 4. Evitar que vuelva a pasar en silencio

- El aviso de "buzón inaccesible" ya está activo y ahora sí llega por correo a monica@aclcostarica.com, con el nombre de la empresa, el buzón y desde cuándo falla. Se apaga solo cuando la lectura vuelve a funcionar.
- Además agrego al panel un indicador por empresa que muestre si su buzón está leyendo bien o lleva días fallando, para verlo de un vistazo sin depender del correo.

### 5. Si no se puede abrir el buzón

Dos caminos de respaldo, según lo que usted prefiera:

- configurar en el hosting un **reenvío automático** de `facturacion@cemsacr.com` a un correo de ACL que ya funciona, y leer de ahí;
- que usted me pase los archivos de las facturas del período y yo las registre y publique manualmente.

## Detalles técnicos

- La conexión vive en `integration_accounts` (tipo `bluehost`, `facturacion@cemsacr.com`, organización `e06ff1bc…`); la actualización de credenciales se hace por función de servidor, sin exponer la clave en la aplicación.
- El drenaje usa `bluehost-fetch-invoices` con cursor reanudable y lotes pequeños, más `process-document-xml` para el registro, y `publish-to-quickbooks` con bloqueo atómico para evitar duplicados.
- El indicador de estado del buzón se alimenta de `sync_logs` (últimos resultados por empresa) y de la alerta `mailbox_unreachable` de `alert_history`.
