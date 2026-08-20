# CIRENAS: por qué vuelven las facturas de junio y cómo evitarlo

## Causa confirmada

Al revisar CIRENAS encontré lo siguiente:

- El buzón de la empresa (facturaselectronicas@cirenas.org, Gmail) sincroniza con la consulta
  `has:attachment (filename:xml OR filename:pdf) newer_than:90d`, y la cuenta **no tiene fecha de
  corte** (`sync_from` vacío). Es decir, cada sincronización vuelve a leer los últimos 90 días de
  correo, que hoy incluyen todo junio de 2026.
- La detección de duplicados de la ingesta consulta **únicamente** la tabla de documentos
  procesados, por clave de 50 dígitos. Cuando usted borra una factura, desaparece el único rastro
  que existía, de modo que el correo se vuelve a leer y la factura se crea otra vez. No es una
  duplicación en base (0 claves repetidas, 0 IDs de QuickBooks repetidos): es una reimportación.
- Los registros de publicación asociados a los documentos borrados tampoco quedan (0 registros
  huérfanos), así que no hay memoria de lo eliminado.

En resumen: borrar no significa "ignorar"; hoy significa "olvidar", y lo olvidado se reimporta.

## Qué se va a construir

1. **Lista de exclusión permanente por clave**
   - Nueva tabla, aislada por empresa, que guarda la clave de 50 dígitos de todo documento
     descartado, con motivo, fecha y usuario.
   - La ingesta consulta esta lista antes de crear cualquier documento; si la clave está excluida,
     se salta y se registra como "descartado por decisión del usuario", no como error.

2. **El botón de eliminar pasa a "descartar"**
   - Al eliminar una factura (individual o en masa), además de borrar el documento se registra su
     clave en la lista de exclusión. Sin pasos extra para usted.
   - Se mantiene una vista para revisar las claves excluidas y reactivar una si fue por error.

3. **Fecha de corte por empresa, respetada por el correo**
   - Ajuste de "no importar facturas emitidas antes de" por empresa. Para CIRENAS se propone
     **1 de julio de 2026** (a confirmar), de modo que nada de junio o anterior vuelva a entrar.
   - La consulta de Gmail agrega ese corte, y la validación de la ingesta lo verifica contra la
     fecha de emisión del XML, no contra la fecha del correo.

4. **Visibilidad**
   - El reporte de sincronización mostrará cuántos documentos se omitieron por exclusión y cuántos
     por fecha de corte, para que quede claro que no se perdió nada por accidente.

## Limpieza puntual de CIRENAS

- Registrar en la lista de exclusión las facturas de junio y anteriores que usted ya borró y las que
  decida borrar ahora.
- No se toca nada en QuickBooks. Las 54 facturas de junio ya publicadas en QuickBooks permanecen
  intactas; la exclusión solo evita reimportaciones.

## Detalles técnicos

- Tabla nueva `ignored_documents` (organization_id, doc_key de 50, doc_number, issue_date, reason,
  created_by), con RLS estricta por membresía de organización y GRANT explícitos.
- `process-document-xml` consulta la exclusión inmediatamente antes de la verificación por clave, y
  devuelve `skipped: ignored_by_user`.
- `gmail-fetch-invoices` (y por consistencia Outlook/Hostinger/Bluehost) añade el corte como
  `after:` y valida `FechaEmision` contra `validation_min_date` de la empresa.
- Se conserva la clave de 50 dígitos como identificador autoritativo; los montos y el IVA se siguen
  tomando literales del XML, sin recálculo.
- El cambio aplica a todas las empresas, no solo a CIRENAS.

## A confirmar

¿La fecha de corte para CIRENAS es el 1 de julio de 2026, o prefiere otra?
