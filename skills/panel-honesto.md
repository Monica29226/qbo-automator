# Skill: Panel honesto (sin indicadores falsos)

## Cuándo usar este skill
Al crear o modificar cualquier dashboard, KPI, badge de estado, tasa de éxito, alerta o componente de "salud del sistema".

## Reglas (OBLIGATORIAS)
1. **Nada hardcodeado.** Prohibido inventar métricas o tendencias (ej. `change="+12%"`). Si no hay un dato real calculado, no muestres la métrica.
2. **Tasas honestas.** Una "tasa de éxito" debe incluir TODO lo intentado (incluidos pendientes). Mostrar "—" cuando no hay datos; NUNCA mostrar 100% por defecto ni cuando el denominador es 0.
3. **Verde solo si se verifica.** Un estado "Sistema saludable / todo funcionando" debe basarse en verificaciones REALES (QBO conectado, 0 errores, 0 backlog), no en "no hay filas en alert_history". Si algo está mal, listá qué.
4. **Errores visibles.** Si una consulta/integración falla, mostrar estado de error claro. PROHIBIDO: `catch {}` vacío, componentes que desaparecen en error, o badges atascados en "Comprobando…".
5. **Éxito solo confirmado.** Toasts/mensajes de éxito únicamente cuando el servidor confirmó la operación.
6. **Detectar lo que NO entró.** Las alertas deben cubrir facturas faltantes (brecha esperado-vs-recibido y huérfanos), no solo errores de lo que ya entró.

## Antipatrones detectados en este proyecto (no repetir)
- `change="+12%"`/"+18%" hardcodeados en StatsCard.
- `successRate` que excluía pendientes y caía a "100".
- "Sistema saludable — todo funcionando" mostrado por ausencia de alertas, sin validar nada.
- `GmailTokenAlert`/`AutoUpdateStatusBadge` que se ocultaban o quedaban "Comprobando…" al fallar.
- Lecturas directas de `integration_accounts` desde el frontend (RLS → null → estado falso). Usar RPC `has_active_integration`.
