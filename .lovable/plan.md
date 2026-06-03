# Arreglar error "Safari Can't Open the Page" al conectar Google Drive

## Diagnóstico
El error que ves es Google rechazando la solicitud OAuth antes de mostrar el consentimiento. El mensaje de COOP de Safari es solo el síntoma visual de su página de error interna. El `client_id` usado es:

```
132562544528-mdkq1fdp5o01f26d4emq69f1a51sjkb3.apps.googleusercontent.com
```

No es un bug del código — la función `google-drive-oauth-init` genera la URL correctamente. El problema está en **Google Cloud Console**.

## Pasos (no requieren cambios de código)

### 1. Verificar Redirect URI autorizado
En [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials), abrir el OAuth Client ID `132562544528-mdkq1...` y confirmar que esta URL **exacta** está en "Authorized redirect URIs":

```
https://lqirqvvkjpunhtsvebot.supabase.co/functions/v1/google-drive-oauth-callback
```

Sin `/` al final, sin diferencias de mayúsculas.

### 2. Verificar OAuth Consent Screen
En [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent):

- Si el estado es **"Testing"**: agregar la cuenta de Google que estás usando (la del `/u/6/` que tiene acceso a la carpeta `1qrDYnf...`) en "Test users".
- O mejor: publicar la app en modo "In production" (el scope `drive.file` no es sensible y no requiere verificación adicional).

### 3. Verificar que la Google Drive API esté habilitada
En [API Library](https://console.cloud.google.com/apis/library/drive.googleapis.com), confirmar que "Google Drive API" está **Enabled** en el mismo proyecto donde está el client ID.

### 4. Reintentar
Después de aplicar lo anterior, en `/integrations` con Agricola Lloronal activa → "Conectar Google Drive" → seleccionar la cuenta que tiene acceso a la carpeta.

## Si después de esto sigue fallando
Decime el resultado y reviso logs de la edge function `google-drive-oauth-callback` para ver qué error específico devuelve Google al intercambiar el código.

## Sin cambios de código en esta tarea
No se modificará nada del repo. Si tras verificar los 3 puntos sigues bloqueada, la siguiente iteración puede:
- Agregar logging extra al callback para capturar el error específico de Google.
- O cambiar el flujo de popup a redirect completo (evita la página de error visible de Safari).
