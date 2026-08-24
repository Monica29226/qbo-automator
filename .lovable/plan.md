# Corregir el redirect URI de Outlook / Hotmail

## Diagnóstico confirmado

- `outlook-oauth-init` respondió correctamente y Microsoft recibió la solicitud.
- La URL generada usa este callback exacto:

```text
https://lqirqvvkjpunhtsvebot.supabase.co/functions/v1/outlook-oauth-callback
```

- Microsoft devuelve `invalid_request` porque esa URI no coincide exactamente con una **Redirect URI de tipo Web** registrada en la aplicación Microsoft cuyo Client ID termina usando el sistema.
- No hay llamadas recientes a `outlook-oauth-callback`, lo cual confirma que Microsoft detiene el flujo antes de regresar a FacturaFlow.
- Los secretos `MICROSOFT_CLIENT_ID` y `MICROSOFT_CLIENT_SECRET` sí existen; el problema no es que falten credenciales.

## Corrección

1. En Microsoft Entra, abrir la aplicación correspondiente al Client ID configurado para FacturaFlow.
2. En **Authentication → Web → Redirect URIs**, agregar exactamente el callback anterior:
   - protocolo `https`
   - sin barra final
   - respetando toda la ruta `/functions/v1/outlook-oauth-callback`
3. Confirmar que la aplicación acepte cuentas personales de Microsoft además de cuentas empresariales, para permitir `hotmail.com` y `outlook.com` mediante el endpoint `/common` que ya usa el sistema.
4. Guardar la configuración de Microsoft y esperar unos minutos para su propagación.
5. Reintentar desde **Integraciones → Outlook / Hotmail / Microsoft 365**.

## Validación

- Confirmar que Microsoft ya muestra selección/inicio de sesión en vez del error `invalid_request`.
- Completar el consentimiento con `haciendaelplanton@hotmail.com`.
- Verificar en los registros que `outlook-oauth-callback` recibe la respuesta.
- Confirmar que la cuenta queda activa para la empresa elegida y que la interfaz muestra “Conectado”.

## Alcance técnico

No hace falta cambiar el callback en el código: las funciones de inicio y retorno ya usan la misma URI. La corrección principal está en el registro de la aplicación Microsoft. Solo se ajustará código si la prueba posterior revela una discrepancia adicional.
