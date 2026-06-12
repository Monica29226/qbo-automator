## Objetivo
Corregir el caso de **Centro Médico Terranoa** donde el sistema muestra facturas como “publicadas” aunque no existen en QuickBooks, y eliminar los mensajes de éxito falsos que hoy dañan la confianza.

## Hallazgos ya confirmados
- La organización **CENTRO MEDICO TERRANOA SOCIEDAD ANONIMA** sí tiene la integración de QuickBooks activa.
- Tiene **221 documentos marcados como `published`** en la base.
- La auditoría real contra QuickBooks ya devolvió **facturas huérfanas**: documentos marcados como publicados pero que QuickBooks responde como “Objeto no encontrado”.
- Ejemplos detectados en la auditoría: documentos con números **06600001010000002842**, **00100001010000000197**, **00500001010000093894**, entre otros.
- Además, todavía hay lógica que puede inflar el éxito:
  - un componente de UI sigue tratando `processed` como éxito del paso de publicación,
  - y el flujo de publicación backend todavía puede asumir que una factura “sí existe” cuando la verificación con QuickBooks falla por error transitorio.

## Plan
### 1. Endurecer la verdad de publicación
- Ajustar el backend de publicación para que **no dé por existente** una factura en QuickBooks si la verificación falla por timeout, 5xx o error transitorio.
- Mantener como “publicada” solo lo realmente confirmado por QuickBooks o por tracking válido.
- Si no se puede verificar, dejar el documento en un estado honesto de espera/revisión/error, no en `published`.

### 2. Corregir todos los contadores y mensajes engañosos
- Corregir los componentes del dashboard que aún muestran éxito usando estados intermedios en vez de confirmación real.
- Cambiar el cálculo de éxito para que el usuario vea solo:
  - confirmadas en QuickBooks,
  - en revisión,
  - esperando respuesta,
  - con error,
  - huérfanas detectadas por auditoría.
- Eliminar cualquier “100% de éxito” si no hubo confirmación real en QuickBooks.

### 3. Dejar una recuperación clara para Terranoa
- Aprovechar la auditoría existente para listar las facturas huérfanas de Terranoa de forma clara.
- Usar el flujo de **republicación controlada** para reenviar solo las que faltan realmente en QuickBooks.
- Mantener visible cuáles se recuperaron, cuáles siguen fallando y cuáles requieren revisión manual.

### 4. Validar al final con una auditoría real
- Ejecutar nuevamente la verificación contra QuickBooks después de los cambios.
- Confirmar que las facturas recuperadas ya existen en QuickBooks.
- Confirmar que el dashboard ya no las cuenta como éxito si no están realmente allá.

## Resultado esperado
- Si una factura no existe en QuickBooks, **no volverá a verse como publicada exitosa**.
- El porcentaje y los toasts dejarán de exagerar el resultado.
- Para Terranoa quedará un flujo confiable: **auditar → detectar faltantes → republicar faltantes → verificar de nuevo**.

## Detalles técnicos
- Archivos probables a tocar:
  - `supabase/functions/publish-to-quickbooks/index.ts`
  - `src/components/dashboard/ProcessingFlow.tsx`
  - `src/components/dashboard/AuditPublishedVsQBO.tsx`
  - componentes del dashboard que aún calculen “éxito” con estados no confirmados
- La recuperación se apoyará en las funciones ya existentes de auditoría y republicación, no en un flujo nuevo paralelo.