# Sistema de Auditoría ACL — Documento de Diseño

> Estado: **Borrador para revisión** · Fase: **Diseño del esquema** · Marco: **NIA/ISA + NIGC 1 (ISQM 1)** · Jurisdicción: **Costa Rica — Colegio de Contadores Públicos (CCPA)**

Este documento define el diseño completo de un sistema que permite a la firma **planear, ejecutar, documentar y archivar** una auditoría de estados financieros de forma que el expediente quede **completo y defendible ante el Colegio de Contadores Públicos**. El sistema usa **agentes de IA** para redactar borradores (plan, cédulas, organización del soporte) que el equipo de auditoría **revisa y aprueba** — la IA nunca firma ni concluye sola.

---

## 1. Objetivos y principios

1. **Cumplimiento NIA**: el expediente cubre las fases de aceptación, planeación (NIA 300/315/320/330), ejecución (NIA 500 y serie 5xx) y conclusión (NIA 450/700/705/720).
2. **Documentación suficiente y apropiada (NIA 230)**: cada conclusión tiene un papel de trabajo que la respalda, con preparador, revisor, fecha y referencias cruzadas.
3. **La IA asiste, el humano responde**: todo producto de un agente nace como *borrador* (`agent_generated = true`, `status = 'borrador'`) y requiere aprobación humana antes de formar parte del expediente. Se guarda trazabilidad completa de cada corrida de IA.
4. **Escepticismo profesional**: el sistema resalta variaciones, partidas sobre materialidad y faltantes de soporte para que el auditor las desafíe.
5. **Aislamiento por firma y por encargo**: RLS por `organization_id` (la firma) reutilizando el modelo multi-tenant existente.
6. **Archivo y retención**: cierre del expediente dentro de los plazos (NIA 230: 60 días) y bloqueo de edición posterior al archivado.

---

## 2. Encaje con lo que ya existe

| Activo existente | Uso en el sistema de auditoría |
|---|---|
| Gateway de IA (`ai.gateway.lovable.dev`) usado en `extract-invoice-data`, `classify-vendor` | Mismo patrón para los nuevos agentes (edge functions) |
| Multi-tenant + RLS (`organizations`, `organization_members`, `user_roles`) | La firma es el tenant; el equipo de auditoría son miembros con roles |
| `processed_documents` (facturas con XML/PDF, proveedor, monto, cuenta) | Soporte que el **Agente Organizador** cruza contra las cédulas |
| Conexión QuickBooks | Fuente opcional futura de balance de comprobación / mayor |
| Storage de Supabase + SharePoint/Drive | Almacenamiento de cédulas exportadas y archivo permanente |

> **Nota de integración:** hoy la carga de información del cliente vive en el sistema aparte **"Audit ACL"**. Decisión pendiente (ver §10): construir este módulo *dentro* de `qbo-automator`, *dentro* de Audit ACL, o como módulo compartido que ambos consuman. El esquema de abajo es portable a cualquiera de las tres opciones.

---

## 3. Modelo de datos

Convenciones: todas las tablas llevan `id uuid pk default gen_random_uuid()`, `organization_id uuid` (firma, para RLS), `created_at`/`updated_at timestamptz`, y donde aplica `created_by uuid`. RLS: acceso solo a filas cuya `organization_id` esté entre las organizaciones del usuario (mismo patrón actual).

### 3.1 Entidad auditada y encargo

**`audit_clients`** — empresas que la firma audita.
| Columna | Tipo | Notas |
|---|---|---|
| name | text | Razón social |
| legal_id | text | Cédula jurídica |
| industry | text | Sector / actividad |
| fiscal_year_end | date | Cierre fiscal |
| reporting_framework | text | NIIF / NIIF para PYMES |
| contact_name, contact_email | text | Contraparte |

**`audit_engagements`** — un encargo = una auditoría de un período.
| Columna | Tipo | Notas |
|---|---|---|
| client_id | uuid → audit_clients | |
| fiscal_year | int | Ej. 2025 |
| period_start, period_end | date | |
| engagement_type | text | `auditoria_eeff`, `revision`, etc. |
| framework | text | NIIF / NIIF PYMES |
| status | enum `engagement_status` | `aceptacion`, `planeacion`, `ejecucion`, `conclusion`, `emitido`, `archivado` |
| partner_id, manager_id | uuid → profiles | Socio y gerente |
| opinion_type | text | `limpia`, `con_salvedades`, `adversa`, `abstencion` (NIA 700/705) |
| report_date | date | Fecha del dictamen |
| archived_at | timestamptz | Bloquea edición posterior |

**`audit_team_members`** — equipo y roles del encargo.
| engagement_id | uuid | |
| user_id | uuid → profiles | |
| role | enum `audit_role` | `socio`, `gerente`, `encargado`, `asistente`, `revisor_calidad` (EQCR) |

### 3.2 Aceptación y control de calidad (NIGC 1 / ISQM 1)

**`audit_compliance_docs`** — documentos de cumplimiento del encargo.
| engagement_id | uuid | |
| type | text | `carta_compromiso`, `independencia`, `aceptacion_continuidad`, `control_calidad`, `carta_representacion`, `comunicacion_gobierno` |
| status | text | `pendiente`, `firmado` |
| file_url | text | |
| signed_at | timestamptz | |
| prepared_by, reviewed_by | uuid | |

### 3.3 Balance de comprobación (información que carga el cliente)

**`trial_balances`** — un balance cargado (período actual o anterior).
| engagement_id | uuid | |
| period | enum | `actual`, `anterior` |
| source | text | `excel`, `csv`, `qbo`, `manual` |
| file_url | text | Archivo original cargado |
| status | text | `cargado`, `mapeado`, `validado` |
| total_debit, total_credit | numeric | Para chequeo de cuadre |
| uploaded_by | uuid | |

**`trial_balance_lines`** — líneas del balance.
| trial_balance_id | uuid | |
| account_code | text | |
| account_name | text | |
| debit, credit | numeric | |
| balance | numeric | Saldo neto |
| fs_area | enum `fs_area` | Área de EEFF asignada (ver §3.4) |
| fs_caption | text | Rubro de presentación |

### 3.4 Mapeo a áreas de estados financieros

**Enum `fs_area`** (cédulas/áreas estándar):
`efectivo`, `inversiones`, `cuentas_por_cobrar`, `inventarios`, `gastos_anticipados`, `propiedad_planta_equipo`, `intangibles`, `otros_activos`, `cuentas_por_pagar`, `prestamos`, `impuestos_por_pagar`, `provisiones`, `otros_pasivos`, `patrimonio`, `ingresos`, `costos`, `gastos_operativos`, `gastos_financieros`, `otros`.

**`account_mappings`** — mapeo reutilizable cuenta → área (por cliente, recordado entre años).
| client_id | uuid | |
| account_code | text | |
| fs_area | enum fs_area | |
| fs_caption | text | |
| default_assertions | text[] | Aseveraciones típicas del área |

### 3.5 Planeación (NIA 300/315/320)

**`audit_plans`** — estrategia y plan general (uno por encargo).
| engagement_id | uuid | |
| understanding_entity | jsonb | Entendimiento de la entidad y su entorno |
| it_environment | jsonb | Entorno de TI y controles generales |
| internal_control | jsonb | Componentes de control interno (COSO) |
| going_concern | jsonb | Evaluación de negocio en marcha |
| fraud_assessment | jsonb | Riesgos de fraude (NIA 240) |
| overall_strategy | text | Estrategia general |
| status | text | `borrador`, `en_revision`, `aprobado` |
| agent_generated | bool | Si lo redactó el Agente Planificador |
| approved_by, approved_at | uuid / ts | |

**`materiality`** — materialidad (NIA 320).
| engagement_id | uuid | |
| basis | text | `utilidad_antes_impuestos`, `activos_totales`, `ingresos`, `patrimonio` |
| benchmark_amount | numeric | Base elegida |
| percentage | numeric | % aplicado |
| overall_materiality | numeric | Materialidad global |
| performance_materiality | numeric | Materialidad de desempeño |
| clearly_trivial | numeric | Umbral de error claramente trivial |
| rationale | text | Justificación |

**`audit_risks`** — matriz de riesgos (NIA 315) → respuesta (NIA 330).
| engagement_id | uuid | |
| fs_area | enum fs_area | Área afectada |
| account_code | text | Cuenta específica (opcional) |
| assertion | enum `assertion` | `existencia`, `integridad`, `exactitud`, `valuacion`, `corte`, `derechos_obligaciones`, `presentacion` |
| risk_description | text | |
| risk_type | text | `inherente`, `control`, `fraude` |
| likelihood | text | `bajo`, `medio`, `alto` |
| magnitude | text | `bajo`, `medio`, `alto` |
| is_significant | bool | Riesgo significativo |
| planned_response | text | Naturaleza/alcance/oportunidad de la respuesta |
| agent_generated | bool | |

### 3.6 Programa de auditoría (procedimientos por área)

**`audit_programs`** — un programa por área de EEFF.
| engagement_id | uuid | |
| fs_area | enum fs_area | |
| objective | text | Objetivos de auditoría del área |

**`audit_program_procedures`** — procedimientos planificados.
| program_id | uuid | |
| assertion | enum assertion | |
| procedure | text | Descripción del procedimiento |
| procedure_type | text | `inspeccion`, `observacion`, `confirmacion`, `recalculo`, `reejecucion`, `analiticos`, `indagacion` |
| status | text | `pendiente`, `en_proceso`, `completado`, `no_aplica` |
| assigned_to | uuid | |
| workpaper_id | uuid → audit_workpapers | Papel donde se ejecutó |
| conclusion | text | |

### 3.7 Cédulas (papeles de trabajo)

**`audit_summaries`** — **cédulas sumarias / lead schedules** (una por área).
| engagement_id | uuid | |
| fs_area | enum fs_area | |
| reference | text | Índice de cédula (ej. `A` efectivo, `B` CxC) |
| current_balance | numeric | Saldo año actual |
| prior_balance | numeric | Saldo año anterior |
| adjustments | numeric | Ajustes propuestos |
| audited_balance | numeric | Saldo auditado |
| variance_amount | numeric | Variación |
| variance_pct | numeric | Variación % |
| over_materiality | bool | Supera materialidad de desempeño |
| conclusion | text | Conclusión del área |
| prepared_by, reviewed_by | uuid | |
| prepared_at, reviewed_at | ts | |
| agent_generated | bool | |

**`summary_lines`** — detalle de cuentas dentro de la sumaria, con cruce a cédula de detalle.
| summary_id | uuid | |
| account_code, account_name | text | |
| current_balance, prior_balance | numeric | |
| variance, variance_pct | numeric | |
| detail_reference | text | Cruce a cédula de detalle (ej. `A-1`) |

**`audit_workpapers`** — **cédulas de detalle y de procedimientos**.
| engagement_id | uuid | |
| summary_id | uuid → audit_summaries | Sumaria padre (opcional) |
| reference | text | Índice (ej. `A-1`, `B-2`) |
| title | text | |
| procedure_type | text | Tipo de prueba |
| objective | text | Objetivo |
| work_performed | text | Trabajo realizado |
| results | text | Resultados |
| conclusion | text | Conclusión |
| status | text | `borrador`, `preparado`, `revisado` |
| file_url | text | Excel/PDF exportado |
| prepared_by, reviewed_by | uuid | |
| agent_generated | bool | |

**`workpaper_documents`** — cruce de soporte (liga a las facturas existentes).
| workpaper_id | uuid | |
| processed_document_id | uuid → processed_documents | Soporte ya en el sistema |
| external_doc_url | text | Soporte externo |
| description | text | |
| tickmark | text | Marca de auditoría (✓, ©, etc.) |

### 3.8 Hallazgos, ajustes y conclusión

**`audit_findings`** — hallazgos.
| engagement_id | uuid | |
| workpaper_id | uuid | Origen |
| type | text | `ajuste`, `reclasificacion`, `deficiencia_control`, `observacion` |
| fs_area | enum fs_area | |
| description | text | |
| amount | numeric | |
| severity | text | `bajo`, `medio`, `alto` |
| recommendation | text | |
| management_response | text | |
| status | text | `abierto`, `corregido`, `no_corregido` |

**`audit_adjustments`** — asientos de ajuste / sumario de diferencias no corregidas (NIA 450).
| engagement_id | uuid | |
| finding_id | uuid | |
| description | text | |
| debit_account, credit_account | text | |
| amount | numeric | |
| classification | text | `corregido`, `no_corregido` |
| affects | text | `resultados`, `balance` |

**`audit_conclusions`** — conclusiones y firmas finales.
| engagement_id | uuid | |
| scope | text | Área o global |
| conclusion | text | |
| signed_by | uuid | |
| signed_at | ts | |

### 3.9 Trazabilidad de IA (clave para defender el expediente)

**`audit_agent_runs`** — cada corrida de un agente.
| engagement_id | uuid | |
| agent_type | text | `planificador`, `sumarias`, `organizador`, `revisor` |
| model | text | Modelo usado |
| input_ref | jsonb | Resumen de la entrada |
| output_ref | jsonb | Producto generado / IDs creados |
| status | text | `ok`, `error` |
| error | text | |
| tokens | int | |
| triggered_by | uuid | Quién la disparó |
| reviewed_by | uuid | Quién revisó/aprobó el borrador |

---

## 4. Los agentes

Todos son **edge functions** que llaman al gateway de IA (mismo patrón que `extract-invoice-data`). Cada uno: (a) lee datos del encargo, (b) llama al LLM con prompt estructurado y *salida JSON validada*, (c) escribe **borradores** en las tablas, (d) registra la corrida en `audit_agent_runs`. **Ningún agente marca algo como aprobado.**

### 🧭 Agente Planificador — `audit-agent-planner`
- **Entrada:** datos de `audit_clients`, `trial_balances` (actual/anterior), sector, framework.
- **Produce (borradores):** `audit_plans` (entendimiento, control interno, fraude, negocio en marcha), `materiality` (propuesta de base/%, con justificación), `audit_risks` (matriz por área/aseveración), y `audit_programs` + `audit_program_procedures` (programa por área).
- **Lógica clave:** identifica áreas significativas comparando saldos contra materialidad y variaciones interanuales; sugiere riesgos por aseveración; propone respuesta NIA 330.

### 📊 Agente de Sumarias — `audit-agent-summaries`
- **Entrada:** `trial_balance_lines` (con `fs_area` mapeada) de ambos períodos + `materiality`.
- **Produce (borradores):** una `audit_summaries` por área con `summary_lines`, calculando saldo actual vs. anterior, variación $ y %, marcando `over_materiality`, y redactando una conclusión preliminar por área. Crea esqueletos de `audit_workpapers` (cédulas de detalle) referenciados desde cada línea.
- **Determinístico + IA:** los cálculos (saldos, variaciones) se hacen en código; la IA solo redacta narrativa, comentarios de variación y conclusiones.

### 🗂️ Agente Organizador — `audit-agent-organizer`
- **Entrada:** `processed_documents` (facturas/PDFs), `audit_workpapers`, `summary_lines`.
- **Produce:** liga soportes a cédulas en `workpaper_documents`, propone tickmarks, y genera un reporte de **faltantes de soporte** (cuentas/partidas sobre materialidad sin documentación). Ordena el expediente por índice de cédula.

### 🔍 Agente Revisor (opcional, fase 2) — `audit-agent-reviewer`
- Revisa completitud: ¿cada riesgo significativo tiene procedimiento y cédula? ¿cada área material tiene conclusión? ¿hay diferencias no corregidas sin evaluar (NIA 450)? Emite checklist de cierre estilo *EQCR* para el socio.

---

## 5. Flujo de trabajo (fases NIA)

```
1. Aceptación        → audit_clients, audit_engagements, audit_compliance_docs
   (carta compromiso, independencia, continuidad)
2. Carga de info     → trial_balances + trial_balance_lines (cliente sube Excel)
   Mapeo a áreas     → account_mappings (recordado entre años)
3. Planeación        → [Agente Planificador] plan + materialidad + riesgos + programa
   Revisión humana   → gerente/socio aprueban
4. Ejecución         → [Agente Sumarias] sumarias + cédulas
                       [Agente Organizador] cruce de soporte
   Trabajo de campo  → equipo completa procedimientos, registra hallazgos
5. Conclusión        → audit_findings, audit_adjustments (NIA 450), conclusiones
   Dictamen          → opinion_type, report_date (NIA 700/705)
6. Archivo           → [Agente Revisor] checklist de cierre → archived_at (bloqueo)
```

---

## 6. Cumplimiento ante el Colegio de Contadores Públicos

| Requisito | Cómo lo cubre el sistema |
|---|---|
| NIGC 1 / ISQM 1 — control de calidad | `audit_compliance_docs` (independencia, aceptación, control de calidad); rol `revisor_calidad` (EQCR) |
| NIA 230 — documentación | Preparador/revisor/fecha en cada cédula; referencias cruzadas; archivo en ≤60 días con bloqueo `archived_at` |
| NIA 240 — fraude | `audit_plans.fraud_assessment` + riesgos `risk_type='fraude'` |
| NIA 300/315/320/330 — planeación y respuesta | `audit_plans`, `materiality`, `audit_risks`, `audit_programs` |
| NIA 450 — evaluación de errores | `audit_adjustments` (corregidos/no corregidos) |
| NIA 500–580 — evidencia | `audit_workpapers`, `workpaper_documents`, confirmaciones |
| NIA 700/705/720 — informe | `audit_engagements.opinion_type`, conclusiones |
| Trazabilidad del uso de IA | `audit_agent_runs` + estado borrador/aprobado en cada producto |

---

## 7. Permisos (RLS y roles)

- RLS por `organization_id` (firma) en todas las tablas, reutilizando los helpers actuales.
- Roles de encargo (`audit_team_members.role`): `asistente` (prepara), `encargado` (prepara/revisa), `gerente` (revisa/aprueba), `socio` (aprueba/firma), `revisor_calidad` (EQCR).
- Reglas: solo `gerente`/`socio` aprueban borradores de IA; tras `archived_at` el encargo es de **solo lectura**.

---

## 8. Interfaz (páginas nuevas, en el patrón shadcn actual)

- `/audit/clients` — clientes auditados.
- `/audit/engagements` — lista de encargos por año/estado.
- `/audit/:id/planning` — plan, materialidad, matriz de riesgos (con botón "Generar con IA").
- `/audit/:id/trial-balance` — carga y mapeo del balance.
- `/audit/:id/summaries` — cédulas sumarias por área (lead schedules).
- `/audit/:id/workpapers/:ref` — cédula de detalle con soporte cruzado.
- `/audit/:id/findings` — hallazgos y ajustes.
- `/audit/:id/completion` — checklist de cierre y archivo.

---

## 9. Plan de implementación por fases

1. **Fase 0 — Esquema (este doc):** aprobar modelo de datos. → migración SQL con tablas, enums y RLS.
2. **Fase 1 — Encargos y carga:** CRUD de clientes/encargos + carga y mapeo del balance.
3. **Fase 2 — Agente Sumarias:** generar sumarias y cédulas (el "quick win" más visible).
4. **Fase 3 — Agente Planificador:** plan, materialidad, riesgos, programa.
5. **Fase 4 — Agente Organizador:** cruce de soporte y faltantes.
6. **Fase 5 — Conclusión y archivo:** hallazgos, ajustes, dictamen, cierre con bloqueo.
7. **Fase 6 — Agente Revisor + exportación** del expediente (PDF/Excel) para el Colegio.

---

## 10. Decisiones pendientes (para definir juntos)

1. **¿Dónde vive el módulo?** Dentro de `qbo-automator`, dentro de "Audit ACL", o como esquema compartido en la misma base Supabase que ambos consuman. (Afecta cómo se reutiliza `processed_documents` y la autenticación.)
2. **Modelo de cliente:** ¿`audit_clients` como tabla nueva (recomendado), o reutilizar `organizations` como entidad auditada?
3. **Catálogo de cédulas:** ¿usamos un set estándar de índices (A, B, C…) y áreas, o lo configuramos por firma?
4. **Origen del balance:** confirmamos Excel/CSV cargado por el contador como fuente principal (QBO queda como futuro).
5. **Modelo de IA:** ¿seguimos con el gateway de Lovable (Gemini) o preferimos otro modelo para la redacción de cédulas?

---

*Siguiente paso sugerido:* revisar §3 (modelo de datos) y §10 (decisiones). Al aprobarlas, genero la **migración SQL** de la Fase 0 y arrancamos con la Fase 2 (Agente de Sumarias) como primer entregable funcional.
