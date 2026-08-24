# Error AADSTS90023 al conectar Outlook / Hotmail

## Causa confirmada

La función `outlook-oauth-init` envía dos valores juntos en el parámetro `prompt`:

```text
prompt = "select_account consent"
```

Microsoft acepta **un solo** valor (`login`, `none`, `consent` o `select_account`). Al recibir dos, devuelve `AADSTS90023: Unsupported 'prompt' value` y ni siquiera muestra la pantalla de inicio de sesión.

## Cambio propuesto

- En `supabase/functions/outlook-oauth-init/index.ts`, dejar `prompt = "select_account"`, que sí permite escoger la cuenta (hotmail.com, outlook.com o Microsoft 365). Microsoft pide el consentimiento por sí solo cuando los permisos aún no están otorgados, así que no se pierde nada.
- Volver a desplegar la función.
- Verificar el enlace de autorización generado para confirmar que ya no lleva el valor doble.

Después de eso puede reintentar «Conectar con Microsoft (OAuth)» con `haciendaelplanton@hotmail.com`; si aparece otro código `AADSTS`, mándemelo y lo reviso.
