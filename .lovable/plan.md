## Diagnóstico

- Usuario `monica@calderon.cr` (Luis Cartin) **ya es `owner` activo** de Tree of Life (`0de5d1f3-b838-4bcf-9c66-b24990a09265`).
- En la base de datos, `system_settings.default_uses_tax = 'false'` para Tree of Life → **el modo "IVA como Gasto" ya está guardado**.
- El toggle se ve apagado (gris) en la captura, lo cual es consistente con el valor real.

Entonces no es un problema de permisos. Lo que probablemente pasa:
1. El fix anterior (cambio de `update` a `upsert` en `Settings.tsx`) **aún no se aplicó** porque seguimos en modo plan.
2. O al darle "Guardar Cambios", otro campo (ej. `email_sender_address`) está rompiendo el batch update por permisos parciales, dejando un toast de error que tapa el resultado.

## Plan

1. Pasar a build mode y aplicar el cambio de `upsert` en `src/pages/Settings.tsx` (ya estaba escrito pero necesita confirmarse).
2. Refrescar la página de Settings y verificar que el toggle aparece apagado al cargar (refleja el valor real `false`).
3. Probar mover el toggle y guardar; confirmar que el toast dice "Configuración guardada exitosamente" sin error.
4. Si aún sale error, capturar el mensaje exacto del toast y revisar logs de red para identificar qué campo específico está siendo rechazado por RLS.

No se requieren cambios de base de datos: tu rol ya es `owner` y el valor ya está correcto.