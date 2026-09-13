# Sus 46 facturas y la limpieza de botones repetidos

## Lo que ya está resuelto (aplicado a todas las empresas)

La lectura del correo estaba congelada desde el 24 de agosto: el sistema releía siempre el mismo tramo viejo y nunca alcanzaba los correos nuevos. Ya quedó corregido para las 19 empresas con correo conectado, con dos protecciones: si la marca de avance queda vieja más de 6 horas se reinicia sola, y si una corrida se corta por tiempo se retoma donde iba en lugar de volver al inicio. También agregué un aviso automático cuando una empresa recibe correos pero no procesa ninguna factura por dos días.

## Sus 46 facturas del archivo

Las 46 están en el sistema, ninguna se perdió:

- 27 ya están registradas en QuickBooks.
- 19 están detenidas únicamente porque el proveedor no tiene asignada una cuenta de gasto.

Los proveedores pendientes de asignar cuenta son, entre otros: Liberty Telecomunicaciones (9 facturas), Ferretería Córdoba, Portones y Sistemas Barth, Lanprosa, Flores y Arenas de Jaco, Inmobiliaria Vimoncal, E Source, EPA, Intcomex, Sur Química, Alpemusa, Tectel, American Business CSM.

## Botones que hacen lo mismo

Revisé toda la aplicación: hay unos 55 botones que disparan publicación, sincronización, reintentos o auditorías. Los solapamientos reales son estos:

1. Dos botones del tablero ("Sincronizar ahora" y "Publicar a QuickBooks") ejecutan exactamente la misma acción.
2. Reintentar facturas con error se ofrece desde cuatro lugares distintos con el mismo efecto.
3. Recuperar una factura que no quedó bien en QuickBooks se ofrece en cinco variantes ("Republicar", "Forzar publicación", "Reintentar", "Republicar desde datos extraídos").
4. Sincronizar el correo se ofrece en cuatro botones ("Sincronizar correo ahora", "Importar lote", "Drenar correo", "Reactivar sincronización").
5. Nueve pantallas o tarjetas ya no están accesibles desde ninguna parte de la aplicación: son restos de versiones anteriores.

## Propuesta de trabajo

### Paso 1 — Publicar las 19 facturas detenidas
Asignar la cuenta de gasto a los proveedores de la lista y dejar la regla guardada, de modo que las próximas facturas de esos proveedores entren solas. Después publicar las 19 respetando el monto y el IVA exactos del XML.

### Paso 2 — Consolidar los botones
- Tablero: dejar un único botón "Enviar a QuickBooks" y un único "Sincronizar correo ahora" (con la opción de elegir mes dentro del mismo botón).
- Errores: un único botón "Reintentar" por factura y uno masivo, que internamente elija el camino correcto según el tipo de falla.
- Recuperación: un solo botón "Volver a enviar a QuickBooks", que verifique primero si el documento existe en QuickBooks y actúe según el caso.
- Auditorías: mantener las tres (huérfanas, cotejo de montos, modo de IVA) porque responden preguntas distintas, pero agruparlas en una sola tarjeta "Revisiones" para que no compitan entre sí.
- Retirar las nueve pantallas sin acceso.

### Paso 3 — Que no vuelva a fallar en silencio
Además del aviso ya activo, agregar en el tablero una sola línea honesta por empresa: última lectura del correo, facturas detenidas por falta de cuenta y facturas con error, con el enlace directo a resolverlas.

## Detalles técnicos

- Botones idénticos: `Dashboard.tsx:358` y `Dashboard.tsx:541` comparten `handlePublishToQuickBooks`.
- Reintentos solapados: `retry-error-documents` (ErrorDocuments, ErrorDocumentsModal, Dashboard), `retry-failed-bills` (ErrorDocuments, ErrorDiagnostic), `retry-qbo-waiting` (AdminCleanupQuickActions, WaitingForQboPanel).
- Republicación solapada: `republish-deleted-from-qbo`, `force-publish-document`, `republish-from-extracted-data`, `republish-credit-notes`.
- Correo solapado: `SyncEmailNowButton` e `ImportBatchDialog` llaman el mismo mapa `*-fetch-invoices`; `ImportHealthPanel` y el aviso del tablero llaman `auto-sync-invoices`.
- Sin acceso: `AuditQBOBills`, `BatchDownloadMissingPdfs`, `ProcessAllNowButton`, `PublishOrphanedInvoices`, `VerifyBillButton`, `BatchImportInvoices`, `PublishSingleDocButton`, `SyncFromExcelButton`, `SharePointUploadButton`, `ProcessingFlow`.
- La consolidación es de interfaz: no se cambia ninguna regla de fidelidad al XML ni el requisito de que `published` siempre tenga identificador de QuickBooks.
