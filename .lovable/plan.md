# Reporte de compras: solo la empresa activa (y por qué Doral salía en 0)

## Qué pasa hoy

El reporte se genera para **todas** las empresas a las que usted tiene acceso y descarga un zip con
un archivo por empresa. Además, la consulta del navegador solo puede traer **1.000 documentos por
llamada**, y en agosto sus empresas suman cerca de 1.527 documentos. Los resultados vienen ordenados
por nombre de empresa, así que el corte cae dentro de «Cafe Luna America» (635 documentos) y todas las
empresas siguientes en el alfabeto quedan fuera.

Doral Overseas sí tiene documentos: 15 en agosto de 2026, todos aceptados y con datos de IVA
completos. Aparecía en 0 únicamente porque quedó después del corte de 1.000 y el reporte la clasificó
como «sin documentos». No es un problema de datos ni de facturas perdidas.

## Qué se va a cambiar

1. **El reporte se genera solo para la empresa en la que usted está.**
   - Se muestra el nombre de la empresa activa en pantalla, antes del botón.
   - Se descarga **un solo archivo Excel** (ya no un zip): `FUENTE - Compras FacturaFlow MM-AAAA EMPRESA.xlsx`,
     con las mismas cuatro hojas de siempre (detalle, resumen, conciliación cuando se suba el reporte
     de GTI, y notas).
   - Si esa empresa no tuvo compras en el mes, no se descarga nada y se avisa en pantalla.
   - El resumen en pantalla queda con una sola fila: documentos, IVA total, total de gasto, diferencia
     contra GTI si corresponde, y el aviso ámbar cuando hay documentos por revisar.

2. **Se elimina el corte de 1.000 documentos.** La consulta se pedirá por bloques hasta traer todo el
   mes, así que ninguna empresa puede volver a salir en 0 por volumen. Esto se aplica también si una
   sola empresa pasa de 1.000 documentos en el mes.

3. **Se conserva el control de acceso en la base de datos**: la consulta sigue devolviendo únicamente
   empresas a las que usted tiene acceso, y se valida que la empresa pedida sea una de ellas.

Si más adelante quiere volver a descargar varias empresas de una vez, se puede agregar una casilla
«todas mis empresas» aparte; por ahora queda solo la empresa activa, como pidió.

## Detalle técnico

- `public.compras_formato_gti(p_desde date, p_hasta date)` se amplía a
  `compras_formato_gti(p_desde date, p_hasta date, p_org uuid default null)`: cuando `p_org` viene,
  se filtra por esa organización manteniendo el chequeo
  `has_role(auth.uid(),'admin') OR is_organization_member(auth.uid(), organization_id)`.
  La lógica de IVA, signo de notas de crédito, tipo de cambio, exclusión de tiquetes/no aceptados y
  exento por cuadre no se toca.
- `src/pages/PurchaseReportGTI.tsx`: se llama la función con `p_org = activeOrganization` (de
  `useAuth`) y se pagina con `.range()` en bucle hasta agotar filas. Se quita `JSZip` y el listado de
  empresas sin documentos, y se descarga el `.xlsx` directo con `buildWorkbook` sin cambios.
- No se toca ingesta ni publicación a QuickBooks; no se crean funciones edge ni dependencias.
