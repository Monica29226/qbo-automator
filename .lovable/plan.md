# Plan de acción

## Diagnóstico inicial
Hoy el dashboard está mezclando señales y por eso no se entiende qué está pasando:

- **El estado de QuickBooks es inconsistente**: en una parte aparece “desconectado” y en otra “conectado”.
- **Las alertas no dicen con claridad qué bloquea el envío** ni cuál es el siguiente paso correcto.
- **El usuario no tiene una ruta simple** para responder a la pregunta clave: “¿qué debo hacer para que las facturas sí lleguen a QuickBooks?”.
- **Hay métricas de publicación/éxito que pueden inducir a error** si no distinguen entre publicación local, espera, revisión y confirmación real.

## Qué vamos a hacer

### 1) Unificar la fuente de verdad de QuickBooks
Voy a hacer que sidebar, tarjetas de conexión, alertas y acciones del dashboard lean **el mismo estado operativo**.

Estados claros:
- Conectado y listo
- Requiere reconexión
- Token por vencer
- Esperando respuesta de QuickBooks
- Bloqueado / requiere revisión

**Resultado esperado:** ya no habrá un lugar diciendo “desconectado” y otro “conectado” al mismo tiempo.

### 2) Hacer que las alertas expliquen qué hacer
Las alertas pasarán de ser mensajes ambiguos a mensajes operativos.

Cada alerta dirá:
- qué problema existe,
- qué impacto tiene sobre las facturas,
- qué botón usar,
- y qué ocurrirá después.

Ejemplos:
- “QuickBooks está desconectado: las facturas no pueden enviarse.”
- “El token expiró o está por expirar: reconectar desbloquea la publicación.”
- “Hay facturas esperando respuesta de QuickBooks: reintentar ahora.”
- “Hay facturas en revisión: no se enviarán hasta resolver clasificación o IVA.”

### 3) Crear una guía visible de operación en el dashboard
Voy a agregar un bloque principal que explique el flujo correcto:

```text
1. Confirmar conexión de QuickBooks
2. Confirmar token válido
3. Revisar si las facturas están listas, en revisión o esperando QBO
4. Ejecutar publicación
5. Verificar resultado real
```

**Resultado esperado:** cualquier usuario podrá entender el flujo sin interpretar varias tarjetas distintas.

### 4) Corregir mensajes falsamente optimistas
Voy a ajustar toasts, contadores y tarjetas para que **no sugieran éxito** cuando en realidad ocurrió alguno de estos casos:
- no hay conexión,
- el token está vencido,
- la factura quedó en revisión,
- la factura quedó esperando respuesta de QuickBooks,
- o no existe confirmación suficiente.

**Regla:** solo se comunica como éxito lo que esté realmente confirmado.

### 5) Mostrar por qué una factura no llegó
En los paneles de publicación y diagnóstico voy a separar claramente estas causas:
- QuickBooks desconectado
- token vencido o crítico
- esperando respuesta de QuickBooks
- error de publicación
- revisión pendiente
- publicada y verificada

**Resultado esperado:** el usuario sabrá si debe reconectar, reintentar o corregir la factura.

### 6) Alinear el botón de publicar con el estado real
El flujo de “publicar a QuickBooks” va a indicar claramente:
- cuántas facturas sí están listas,
- cuántas no pueden enviarse todavía,
- cuántas están bloqueadas por conexión/token,
- y qué paso previo falta.

## Qué observé antes del cambio
- En el navegador aparece el mensaje: **“QuickBooks not connected, skipping account fetch”**.
- Al mismo tiempo, la pantalla muestra un estado contradictorio de conexión.
- Eso confirma que el problema no es solo operativo: **también es de UX y de consistencia de estado**.

## Resultado esperado para el usuario
Después de estos cambios, al entrar al dashboard quedará claro:
- si QuickBooks realmente está usable,
- si hay que reconectar o solo reintentar,
- si las facturas están listas o bloqueadas,
- y qué paso exacto hacer para que sí lleguen al sistema contable.

## Alcance técnico
Voy a alinear la lógica y mensajes en estos puntos clave:
- estado de QuickBooks en sidebar/dashboard,
- panel de alertas,
- métricas de publicación,
- panel de espera/reintento,
- y modal/acción de publicar.

## Validación
Antes de darlo por terminado validaré que:
- no haya estados contradictorios,
- las alertas indiquen acciones comprensibles,
- el flujo para publicar sea claro,
- y los mensajes de éxito no exageren el resultado real.