# Configuración del Webhook GTI para Ingresos

Este documento explica cómo configurar el webhook de GTI para recibir automáticamente las facturas de venta emitidas y publicarlas en QuickBooks.

## URL del Webhook

La URL del webhook para recibir facturas desde GTI es:

```
https://lqirqvvkjpunhtsvebot.supabase.co/functions/v1/gti-webhook-receiver
```

## Configuración en GTI

1. **Acceder a la configuración de webhooks** en su panel de GTI
2. **Crear nuevo webhook** con los siguientes datos:
   - **URL**: `https://lqirqvvkjpunhtsvebot.supabase.co/functions/v1/gti-webhook-receiver`
   - **Método**: POST
   - **Evento**: Factura Emitida / Invoice Created
   - **Headers**: `Content-Type: application/json`

3. **Formato del Payload** que GTI debe enviar:

```json
{
  "clave": "50618092400001072008500100001050000000051110048024",
  "numero": "00100001050000000051",
  "tipo": "FE",
  "fecha": "2024-12-01",
  "emisor": {
    "nombre": "Cliente Ejemplo S.A.",
    "identificacion": "3-101-123456",
    "correo": "cliente@example.com"
  },
  "receptor": {
    "nombre": "Mi Empresa",
    "identificacion": "3-101-654321"
  },
  "resumen": {
    "moneda": "CRC",
    "tipo_cambio": 1.0,
    "total_gravado": 100000,
    "total_exento": 0,
    "total_impuesto": 13000,
    "total_descuentos": 0,
    "total_comprobante": 113000
  },
  "detalles": [
    {
      "detalle": "Servicio profesional",
      "cantidad": 1,
      "precio_unitario": 100000,
      "monto_total": 100000,
      "impuesto": 13000
    }
  ],
  "xml_data": {},
  "xml_url": "https://gti.com/xml/invoice.xml",
  "pdf_url": "https://gti.com/pdf/invoice.pdf"
}
```

## Flujo de Procesamiento

1. **GTI envía webhook** cuando se emite una factura
2. **Sistema valida** que la factura sea para su organización (por cédula jurídica)
3. **Sistema busca** configuración del cliente:
   - Si el cliente tiene cuenta de ingreso configurada → **Publica automáticamente a QuickBooks**
   - Si el cliente NO tiene configuración → Marca como `pending_config` para configuración manual

4. **Usuario configura clientes** en "Facturas de Venta" si es necesario
5. **Sistema auto-publica** una vez configurado

## Configuración de Clientes

Para que las facturas se publiquen automáticamente, configure cada cliente con:

- **Cuenta de Ingreso** (ej: "4101 - Ventas")
- **Centro de Costo / Clase** (opcional)
- **Términos de Pago** (opcional, ej: Net 30)

## Seguridad

- El webhook valida que la cédula jurídica del **receptor** coincida con la de su organización
- Solo se procesan facturas dirigidas a su empresa
- Las facturas de otros receptores son rechazadas automáticamente

## Verificación

Después de configurar el webhook en GTI:

1. Emita una factura de prueba desde GTI
2. Verifique en "Facturas de Venta" que llegó correctamente
3. Si el cliente está configurado, debería publicarse automáticamente a QuickBooks
4. Si no, configure la cuenta de ingreso para ese cliente

## Soporte

Para soporte técnico o preguntas sobre la configuración:
- Revisar logs en el dashboard de Lovable Cloud
- Verificar que la cédula jurídica en "Mi Empresa" coincida con la del sistema
