# Mobiliario Moderno — diagnóstico y plan de recuperación

## Qué encontré (verificado en la base de datos)

1. **La conexión con QuickBooks está caída desde el 20 de julio de 2026.**
   El registro de integración de QuickBooks de esta empresa está `is_active = false` y su token
   expiró el 2026-07-20 14:30 UTC. Realm: 9341454973948088.

2. **Consecuencia: no se publica nada desde el 17 de julio.**
   - 222 documentos publicados (el último con fecha 2026-07-17).
   - 21 documentos en estado `processed` sin `qbo_entity_id` (listos, pero nunca llegaron a QBO),
     el más reciente del 2026-08-11.
   - Cada corrida del cron (cada 30 min) termina en `partial` con `qbo_failed = 1`,
     `qbo_published = 0`.

3. **15 facturas en estado `review` con el motivo "Proveedor sin regla automática"**
   (Alvarado & Arias, RIMUCA, UNOPETROL, SERVICENTRO LA GALERA, CAMILA COTO ROMAN, READY PIZZA,
   entre otras). Estas esperan que se les asigne cuenta contable.

4. **5 documentos en `error`** (últimos del 2026-07-14) y **1 en `currency_mismatch`**.

5. **Correo (Gmail): sí está activo** y sigue trayendo facturas (última corrida 2026-08-14 01:00),
   aunque las corridas quedan marcadas como parciales por límite de tiempo.

Resumen: la ingesta de correo funciona; **la publicación a QuickBooks está detenida por token
expirado**, no por un error de datos.

## Plan de recuperación

### Paso 1 — Reconectar QuickBooks (lo hace la usuaria, es un OAuth)
En Integraciones de Mobiliario Moderno, reconectar QuickBooks con la compañía
realm 9341454973948088. Sin esto ningún paso siguiente puede funcionar.

### Paso 2 — Republicar el atraso
Con la conexión viva, disparar la publicación de los 21 documentos `processed` sin
`qbo_entity_id`, respetando la regla de siempre: montos, IVA por línea y consecutivo de 20 dígitos
tomados literales del XML; si QuickBooks no devuelve un Id real, el documento **no** queda como
publicado, queda para revisión.

### Paso 3 — Clasificar las 15 en revisión
Desde la Cola de Revisión, asignar cuenta a los proveedores sin regla. Al guardar, la regla queda
persistida en `vendor_defaults` y se propaga a todas las facturas atascadas de ese proveedor,
que pasan a la cola de publicación.

### Paso 4 — Revisar los 5 en error y el desfase de moneda
Diagnosticar caso por caso desde la Cola de Revisión: los recuperables se reintentan, los de
rechazo de Hacienda se marcan como no ingresables.

### Paso 5 — Alerta preventiva de token vencido
Para que esto no se repita sin avisar: cuando una integración de QuickBooks quede
`is_active = false` o con token expirado, mostrarlo como alerta visible en el panel de la empresa
afectada (y no solo como `qbo_failed` silencioso en `sync_logs`).

## Notas técnicas

- Verificación usada: `organizations`, `integration_accounts` (expiración de credenciales),
  `processed_documents` agrupado por estado, y `sync_logs` de las últimas 12 corridas.
- Los pasos 2 a 4 se ejecutan con las funciones ya existentes (`publish-to-quickbooks` y la lógica
  de la Cola de Revisión); no requieren código nuevo.
- El paso 5 sí es cambio de código: una tarjeta de alerta en el panel alimentada por el estado real
  de `integration_accounts`.
