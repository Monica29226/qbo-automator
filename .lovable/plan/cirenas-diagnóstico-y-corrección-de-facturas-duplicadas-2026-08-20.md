# CIRENAS: diagnóstico y corrección de facturas duplicadas

## Hallazgos confirmados
- En la base de CIRENAS hay **218 documentos**, **199 publicados**, **0 claves electrónicas duplicadas**, **0 IDs de QuickBooks repetidos** y **0 publicaciones sin ID real**.
- Las restricciones únicas por clave están activas tanto en documentos como en el registro de publicación.
- Existe una segunda ruta de publicación, `batch-publish-all`, que selecciona documentos pendientes sin adquirir el bloqueo `publishing`. Si coincide con la sincronización automática o con otra solicitud, dos ejecuciones pueden tomar el mismo documento antes de que ninguna guarde el ID. Esta es una condición de carrera real; todavía falta confirmar cuáles duplicados visibles en QuickBooks se originaron por ella.

## Plan de acción
1. **Auditar directamente QuickBooks para CIRENAS**
   - Recorrer Bills y VendorCredits del período cubierto por los 218 documentos.
   - Agrupar por número completo de 20 dígitos, proveedor, monto y tipo.
   - Reportar cada grupo con más de una entidad, sus IDs, fechas, montos y la clave de Hacienda relacionada.
   - Distinguir duplicados reales de números iguales emitidos por proveedores distintos.

2. **Cerrar la ruta concurrente**
   - Retirar de `batch-publish-all` la creación directa de Bills/VendorCredits.
   - Hacer que use la ruta canónica `publish-to-quickbooks`, que bloquea documentos, valida tracking, consulta QuickBooks antes de crear y exige un ID real.
   - Mantener la ejecución por lotes, pero sin dos implementaciones independientes de publicación.

3. **Fortalecer el bloqueo atómico**
   - Crear una función transaccional en la base que reclame documentos elegibles con `FOR UPDATE SKIP LOCKED` y cambie su estado a `publishing` en la misma transacción.
   - Usarla en toda publicación masiva para que dos ejecuciones simultáneas nunca puedan reclamar el mismo documento.
   - Mantener aislamiento estricto por `organization_id` y permisos solo para usuarios autorizados y funciones del backend.

4. **Bloquear duplicados aun con carreras externas**
   - Antes de crear, consultar QuickBooks por tipo + número completo y exigir coincidencia de proveedor y monto XML.
   - Si la consulta falla o expira, no crear: dejar el documento en espera para reintento.
   - Después de crear, guardar inmediatamente ID, realm y tracking; solo entonces marcar como publicado.

5. **Tratar los duplicados encontrados sin borrar automáticamente**
   - Preparar un reporte de candidatos a eliminación indicando cuál entidad conservar según clave, tracking, fecha y monto XML.
   - No eliminar nada de QuickBooks hasta presentar la lista y recibir autorización explícita.
   - Para cada caso autorizado, conservar la entidad correcta y reconciliar documento, tracking y realm.

6. **Validación final**
   - Ejecutar dos solicitudes simultáneas sobre documentos controlados y confirmar que solo una los reclama.
   - Reauditar CIRENAS: 0 claves duplicadas en base, 0 nuevos grupos duplicados en QuickBooks y 0 publicados sin ID/realm.
   - Verificar que totales e IVA coincidan literalmente con el XML y que XML + PDF permanezcan adjuntos.

## Detalles técnicos
- La clave de 50 dígitos seguirá siendo el identificador autoritativo; el número de 20 dígitos nunca se usará solo para decidir que dos facturas son iguales.
- No se recalcularán montos ni IVA. Una discrepancia con el XML bloqueará la publicación y pasará a revisión.
- El ajuste aplica globalmente a todas las empresas, no solo a CIRENAS.