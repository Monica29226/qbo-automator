# Arreglar "Popup blocked" en conexión Gmail/Outlook

## Causa raíz

En `src/pages/Integrations.tsx`, los handlers OAuth llaman a la edge function `*-oauth-init` con `await` **antes** de `window.open()`. El navegador requiere que `window.open` se ejecute en el mismo tick del clic; tras un `await` ya no cuenta como gesto del usuario y se bloquea, aunque el usuario tenga popups habilitados.

Esto afecta 4 handlers: Gmail (línea 296), Outlook, y 2 más (líneas 364, 459, 557, 662).

## Solución

Patrón estándar: abrir la ventana **sincrónicamente** con `about:blank` apenas el usuario hace clic, luego asignar la URL real cuando llega la respuesta del backend.

```ts
const popup = window.open("about:blank", "gmail_oauth", "width=800,height=700");
if (!popup) {
  toast.error("Permite ventanas emergentes…");
  return;
}
popup.document.write("Cargando…");

try {
  const { data, error } = await supabase.functions.invoke("gmail-oauth-init", { body: { state } });
  if (error || !data?.authUrl) {
    popup.close();
    throw error ?? new Error("No authUrl");
  }
  popup.location.href = data.authUrl;
} catch (e) {
  popup.close();
  toast.error(...);
}
```

## Archivos a modificar

- `src/pages/Integrations.tsx` — refactorizar los 4 handlers (`handleGmailOAuth` + los otros 3 que usan `window.open` después de un `await`) al patrón "abrir primero, navegar después".

Sin cambios de backend, esquema, ni edge functions.

## Resultado esperado

- Un solo clic en "Conectar con Gmail" abre la ventana de Google sin bloqueo.
- Mismo arreglo aplica a Outlook y a las otras dos integraciones OAuth.
- Si el navegador realmente tiene popups bloqueados a nivel sitio, el `if (!popup)` lo detecta correctamente y muestra el toast (como hoy), pero deja de ser un falso positivo causado por el `await`.
