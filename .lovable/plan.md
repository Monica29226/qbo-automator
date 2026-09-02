# Depurar la empresa duplicada "Sistemas de Desarrollo"

## Qué encontré

Existen dos registros creados en fechas distintas:

| Empresa | Creada | Cédula | Documentos | QuickBooks | Correo |
|---|---|---|---|---|---|
| Sistemas de Desarrollo de Costa Rica S.A | 13/05/2026 | 3-101-041049 | 326 (311 publicadas) + 299 ventas | realm 9341456995842388 (hoy desconectado) | Gmail y Siku activos |
| Sistemas de Desarrollo  De Costa Rica | 04/05/2026 | sin cédula | 1 documento de prueba, ninguna publicada | sin conexión | sin conexión |

La segunda es un registro anterior, incompleto (sin cédula ni integraciones) y con nombre con doble espacio.
Su único documento es una factura de prueba ("Proveedor Prueba SA", 13/05/2026, 1,130) que quedó en estado
de revisión. No hay riesgo de duplicidad de facturas entre ambas: no comparten ninguna clave publicada.

## Qué propongo hacer

1. Descartar la factura de prueba del registro incompleto, dejando registrado el motivo (prueba interna).
2. Desactivar el registro incompleto (`is_active = false`), de modo que desaparezca del selector de empresas
   para las cuatro personas que hoy lo ven, sin borrar historial.
3. Dejar como única empresa operativa "Sistemas de Desarrollo de Costa Rica S.A" (3-101-041049).

No se elimina ni se mueve nada de la empresa operativa, y no se toca su conexión con QuickBooks.

## Pendiente aparte

La empresa operativa sigue con QuickBooks desconectado y 13 documentos sin publicar. Eso requiere que
usted reconecte QuickBooks desde Integraciones; al hacerlo publico los pendientes validando total e IVA
contra el XML.

## Detalle técnico

- `discard_processed_documents` para el documento de prueba de `a8fbfda4-eb33-4a84-ad15-6d77d2e1a78f`.
- `update organizations set is_active = false` en ese mismo id. `AuthContext` ya filtra inactivas, así que
  no hace falta cambio de frontend.
