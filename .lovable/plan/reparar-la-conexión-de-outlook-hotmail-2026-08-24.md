# Reparar la conexión de Outlook / Hotmail

## Diagnóstico confirmado

- El botón sí recibe el clic y llama a `outlook-oauth-init`.
- La función responde correctamente y genera una URL válida de Microsoft con `prompt=select_account`.
- Microsoft acepta esa URL y devuelve su pantalla de inicio de sesión.
- No existe ninguna llamada reciente a `outlook-oauth-callback`; por tanto, el flujo se detiene antes de que Microsoft regrese al sistema. El punto a corregir es la navegación de la ventana emergente creada inicialmente como `about:blank`.

## Cambios

1. **Hacer confiable la apertura de Microsoft**
   - Mantener la apertura iniciada directamente por el clic para evitar bloqueadores del navegador.
   - Reemplazar la navegación frágil de la ventana vacía por una entrega explícita de la URL y comprobar que la ventana realmente salió de `about:blank`.
   - Si el navegador impide esa navegación, mostrar inmediatamente un enlace funcional para continuar en una pestaña nueva, sin crear botones permanentes adicionales en la pantalla.

2. **Manejar todos los estados del flujo**
   - Mostrar “Conectando…” mientras se solicita y abre Microsoft.
   - Detectar ventana bloqueada, cerrada antes de autorizar, respuesta inválida y tiempo de espera.
   - No cerrar el diálogo ni aparentar éxito si el callback no confirmó la cuenta.
   - Eliminar el registro temporal de depuración visible en consola.

3. **Confirmar correctamente el regreso de Microsoft**
   - Conservar el callback actual para guardar la cuenta solo después de validar el token con Microsoft.
   - Verificar el mensaje de éxito o error enviado a la ventana principal y refrescar Integraciones únicamente cuando haya confirmación real.
   - Mostrar el código y motivo concreto si Microsoft rechaza la cuenta.

4. **Validación de punta a punta**
   - Probar desde Integraciones que el clic abre la pantalla de Microsoft.
   - Completar la conexión de `haciendaelplanton@hotmail.com`.
   - Confirmar que el callback se ejecuta, que la cuenta queda activa para la empresa seleccionada y que la interfaz muestra “Conectado”.

## Archivos previstos

- `src/pages/Integrations.tsx`
- `supabase/functions/outlook-oauth-init/index.ts` solo si la apertura directa requiere que la función entregue una redirección compatible con el navegador.
- `supabase/functions/outlook-oauth-callback/index.ts` únicamente si la prueba revela que el mensaje de regreso necesita ajuste.
