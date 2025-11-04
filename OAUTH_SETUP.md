# Configuración OAuth para Gmail y QuickBooks

Este documento describe cómo configurar las credenciales OAuth para Gmail y QuickBooks.

## Gmail OAuth Setup

### 1. Ir a Google Cloud Console
https://console.cloud.google.com/

### 2. Crear o seleccionar un proyecto

### 3. Habilitar Gmail API
- Ir a "APIs & Services" > "Library"
- Buscar "Gmail API"
- Click en "Enable"

### 4. Configurar OAuth Consent Screen
- Ir a "APIs & Services" > "OAuth consent screen"
- Seleccionar "External" y crear
- Llenar información básica:
  - App name: FacturaFlow CR
  - User support email: tu email
  - Developer contact: tu email
- Agregar scopes:
  - `https://www.googleapis.com/auth/gmail.readonly`
- Guardar y continuar

### 5. Crear credenciales OAuth 2.0
- Ir a "APIs & Services" > "Credentials"
- Click "Create Credentials" > "OAuth client ID"
- Tipo: Web application
- Nombre: FacturaFlow CR
- **Authorized JavaScript origins:**
  - `https://lqirqvvkjpunhtsvebot.supabase.co`
- **Authorized redirect URIs:**
  - `https://lqirqvvkjpunhtsvebot.supabase.co/functions/v1/gmail-oauth-callback`
- Click "Create"
- Copiar el **Client ID** y **Client Secret**

### 6. Configurar en Lovable
Ya has configurado estos valores como secrets:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

---

## QuickBooks OAuth Setup

### 1. Ir a Intuit Developer Portal
https://developer.intuit.com/

### 2. Crear una aplicación
- Click "Create an app"
- Seleccionar "QuickBooks Online and Payments"
- Llenar información básica

### 3. Configurar Keys & OAuth
- Ir a la pestaña "Keys & OAuth"
- En **Redirect URIs** agregar:
  - `https://lqirqvvkjpunhtsvebot.supabase.co/functions/v1/quickbooks-oauth-callback`
- Copiar el **Client ID** y **Client Secret**

### 4. Configurar scopes
Asegurar que los siguientes scopes están habilitados:
- `com.intuit.quickbooks.accounting`

### 5. Configurar en Lovable
Ya has configurado estos valores como secrets:
- `QBO_CLIENT_ID`
- `QBO_CLIENT_SECRET`

---

## Verificación

Para verificar que todo está configurado correctamente:

1. **Gmail**: 
   - Ve a Integraciones en el dashboard
   - Click en "Agregar cuenta" para Gmail
   - Debe abrir la ventana de autorización de Google
   - Acepta los permisos
   - Debe regresar con éxito

2. **QuickBooks**:
   - Ve a Integraciones en el dashboard
   - Click en "Agregar cuenta" para QuickBooks
   - Debe abrir la ventana de autorización de Intuit
   - Acepta los permisos
   - Debe regresar con éxito

## URLs importantes

- **Gmail OAuth Callback**: `https://lqirqvvkjpunhtsvebot.supabase.co/functions/v1/gmail-oauth-callback`
- **QuickBooks OAuth Callback**: `https://lqirqvvkjpunhtsvebot.supabase.co/functions/v1/quickbooks-oauth-callback`

## Solución de problemas

### Error: "redirect_uri_mismatch"
- Verifica que la URL de callback esté exactamente igual en Google/Intuit
- No debe tener espacios ni caracteres extras
- Debe incluir el protocolo https://

### Error: "invalid_client"
- Verifica que el Client ID y Secret sean correctos
- Asegúrate de que los secrets estén configurados en Lovable

### Token expirado
- Los tokens de Gmail se renuevan automáticamente
- Los tokens de QuickBooks duran 100 días y deben renovarse manualmente
