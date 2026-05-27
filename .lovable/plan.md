## Objetivo

Aplicar los mismos arreglos del buscador manual al **sync automático diario** de Hostinger y Bluehost, para que las facturas entren solas sin tener que buscarlas una por una por clave.

## Problema actual

El cron de `email-sync` (Hostinger/Bluehost) no captura ciertos correos con XML adjunto porque:

1. **Filtro IMAP muy estrecho** — busca por palabras clave en SUBJECT/BODY (ej. "factura", "comprobante"). Correos cuyo asunto no contiene esas palabras quedan fuera, aunque traigan el XML adjunto.
2. **Parser de adjuntos frágil** — el `BODYSTRUCTURE` no detecta XML cuando viene con nombres en formato IMAP `("name" "file.xml")`, anidado en `multipart/mixed` profundo, o dentro de un ZIP.
3. **Extracción base64 con basura** — caracteres no-base64 mezclados hacen fallar `atob()`, descartando silenciosamente el adjunto.
4. **Re-selección de carpeta** — al recorrer INBOX + Junk, no re-selecciona la carpeta original antes del FETCH, perdiendo mensajes.

Estos son los mismos 4 bugs que ya arreglamos en `search-import-invoice`. Falta portarlos al sync automático.

## Cambios

### 1. `supabase/functions/email-sync-hostinger/index.ts`
- Reemplazar el filtro IMAP SEARCH actual por una estrategia ampliada: en lugar de solo buscar por keywords del asunto, hacer `SEARCH SINCE <fecha>` y luego pre-filtrar por `BODYSTRUCTURE` para quedarse solo con mensajes que tengan adjuntos `.xml` o `.zip`.
- Portar el parser robusto de `BODYSTRUCTURE` desde `search-import-invoice` (maneja formato `("name" "file.xml")`, hasta 40 adjuntos candidatos, profundidad MIME hasta 10).
- Portar la extracción base64 limpia (usar marker de tamaño IMAP `{size}\r\n`, filtrar caracteres no-base64 antes de `atob()`).
- Asegurar re-selección de carpeta antes de cada FETCH al alternar INBOX/Junk.

### 2. `supabase/functions/email-sync-bluehost/index.ts`
- Aplicar exactamente los mismos 4 arreglos. El código IMAP es prácticamente idéntico al de Hostinger.

### 3. Extraer helpers compartidos (opcional pero recomendado)
- Mover `parseBodyStructure()`, `extractBase64Attachment()` y `selectFolderAndFetch()` a `supabase/functions/_shared/imap-utils.ts` para que `email-sync-hostinger`, `email-sync-bluehost` y `search-import-invoice` los compartan. Evita que el bug se repita en una de las 3 funciones.

### 4. Sin cambios en
- Lógica de cursor / `skip_count` en `system_settings` (sigue igual).
- Límite de 50 mensajes y timeout de 25s por corrida (sigue igual — el cron drena lote por lote).
- Gmail / Outlook (rutas distintas, no afectadas por este bug IMAP).
- Esquema de BD, RLS, frontend.

## Verificación post-deploy

1. Revisar `sync_logs` de las próximas 2-3 corridas de Terranoa y comparar `gmail_fetched` vs corridas previas — debería subir.
2. Confirmar que el proveedor `3101338733` (los 4 claves que faltaban) aparece en `processed_documents` sin haber usado el buscador manual.
3. Revisar 2-3 organizaciones adicionales (ej. Centro Médico Terranoa, Café Luna América) buscando huecos consecutivos en `qbo_publish_tracking` y confirmar que se cierran solos en las siguientes corridas.

## Alcance global

Aplica a **todas las organizaciones** con integración Hostinger o Bluehost activa. No hay lógica condicional por org. Gmail/Outlook quedan fuera (no tienen este bug).
