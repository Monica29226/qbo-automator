# Plan de confiabilidad para la importación de Terranoa

## Confirmación actual

- La recuperación puntual sí funcionó: las 4 facturas nuevas y las 3 que ya existían figuran como publicadas, todas con ID real de QuickBooks y registro de seguimiento.
- Las otras 7 claves no están registradas porque no fueron encontradas en el buzón; no se marcaron falsamente como procesadas o publicadas.
- Actualmente hay cero claves duplicadas para Terranoa tanto en documentos como en el seguimiento de QuickBooks.
- No es correcto garantizar todavía que el problema no se repetirá: los ciclos recientes de Hostinger continúan registrando sincronizaciones parciales y errores `WORKER_RESOURCE_LIMIT`. El cursor de reanudación existe y está en 150, pero la implementación actual puede contabilizar como avanzados correos cuya descarga falló o cuyo procesamiento se detuvo por tiempo.

## Corrección para evitar recurrencia

1. **Hacer la lectura de Hostinger verdaderamente reanudable**
   - Reducir el tamaño del lote para bajar consumo de memoria y tiempo.
   - Avanzar el cursor únicamente por correos leídos y procesados o descartados de forma concluyente.
   - No saltar correos cuya descarga falló ni los que quedaron sin procesar por el límite de tiempo.
   - Persistir progreso estable por carpeta y mensaje, evitando depender solo de una posición global que cambia cuando llegan correos nuevos.

2. **Recuperación automática de parciales y fallos**
   - Guardar el progreso después de cada lote completado.
   - Reintentar automáticamente correos fallidos en el ciclo siguiente.
   - Mantener el estado como parcial o error mientras exista backlog; nunca reportarlo como éxito completo prematuramente.

3. **Mantener la protección estricta contra duplicados**
   - Usar la Clave electrónica de 50 dígitos junto con la organización como bloqueo antes de importar.
   - Mantener la segunda validación antes de publicar y publicar solamente documentos concretos recuperados.
   - Confirmar la restricción única activa en la base de datos como última barrera.

4. **Control de completitud y alertas**
   - Conciliar en cada ciclo: correos candidatos, XML encontrados, documentos creados, duplicados omitidos y fallos pendientes.
   - Alertar cuando ocurra un límite de recursos, haya parciales repetidos o el cursor no avance.
   - Reportar “completo” únicamente cuando todo el rango haya sido recorrido sin pendientes.

5. **Validación en vivo**
   - Desplegar las funciones corregidas.
   - Drenar el backlog de Terranoa por lotes hasta completarlo.
   - Confirmar cero duplicados, cero documentos publicados sin ID real y cero parciales pendientes.
   - Revisar después las demás empresas Hostinger y Bluehost, ya que la corrección debe aplicar globalmente.

## Detalles técnicos

- Funciones principales: `hostinger-fetch-invoices` y `auto-sync-invoices`.
- El parser seguirá tomando montos, IVA y proveedor exclusivamente del XML.
- No se agregarán botones ni cambios visuales.