-- =====================================================================
-- Sistema de Auditoría ACL — Esquema base (Fase 0)
-- Marco: NIA/ISA + NIGC 1 (ISQM 1). Jurisdicción: Costa Rica (CCPA).
-- Diseño de referencia: AUDIT_SYSTEM_DESIGN.md
--
-- AJUSTAR ANTES DE APLICAR (ver audit-acl-port/README.md):
--   * is_org_member(): alinear con el modelo de membresía de Audit ACL
--   * FK a processed_documents y profiles según existan en Audit ACL
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper de RLS: ¿el usuario actual pertenece a la firma (organización)?
-- Reescribir el cuerpo si la tabla/columnas de membresía difieren.
-- ---------------------------------------------------------------------
create or replace function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org
      and m.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
do $$ begin
  create type public.engagement_status as enum
    ('aceptacion','planeacion','ejecucion','conclusion','emitido','archivado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.audit_role as enum
    ('asistente','encargado','gerente','socio','revisor_calidad');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tb_period as enum ('actual','anterior');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.fs_area as enum (
    'efectivo','inversiones','cuentas_por_cobrar','inventarios','gastos_anticipados',
    'propiedad_planta_equipo','intangibles','otros_activos','cuentas_por_pagar',
    'prestamos','impuestos_por_pagar','provisiones','otros_pasivos','patrimonio',
    'ingresos','costos','gastos_operativos','gastos_financieros','otros');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.assertion as enum (
    'existencia','integridad','exactitud','valuacion','corte',
    'derechos_obligaciones','presentacion');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Entidad auditada y encargo
-- ---------------------------------------------------------------------
create table if not exists public.audit_clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  name text not null,
  legal_id text,
  industry text,
  fiscal_year_end date,
  reporting_framework text,           -- NIIF / NIIF para PYMES
  contact_name text,
  contact_email text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_engagements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid not null references public.audit_clients(id) on delete cascade,
  fiscal_year int not null,
  period_start date,
  period_end date,
  engagement_type text not null default 'auditoria_eeff',
  framework text,
  status public.engagement_status not null default 'aceptacion',
  partner_id uuid,
  manager_id uuid,
  opinion_type text,                  -- limpia / con_salvedades / adversa / abstencion
  report_date date,
  archived_at timestamptz,            -- bloquea edición posterior
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_engagements_client on public.audit_engagements(client_id);
create index if not exists idx_engagements_org on public.audit_engagements(organization_id);

create table if not exists public.audit_team_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  user_id uuid not null,
  role public.audit_role not null,
  created_at timestamptz not null default now(),
  unique (engagement_id, user_id, role)
);

-- ---------------------------------------------------------------------
-- Aceptación / control de calidad (NIGC 1 / ISQM 1)
-- ---------------------------------------------------------------------
create table if not exists public.audit_compliance_docs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  type text not null,                 -- carta_compromiso / independencia / aceptacion_continuidad / control_calidad / carta_representacion / comunicacion_gobierno
  status text not null default 'pendiente',
  file_url text,
  signed_at timestamptz,
  prepared_by uuid,
  reviewed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Balance de comprobación (información que carga el cliente)
-- ---------------------------------------------------------------------
create table if not exists public.trial_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  period public.tb_period not null,
  source text not null default 'excel',
  file_url text,
  status text not null default 'cargado',  -- cargado / mapeado / validado
  total_debit numeric(18,2),
  total_credit numeric(18,2),
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  unique (engagement_id, period)
);

create table if not exists public.trial_balance_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  trial_balance_id uuid not null references public.trial_balances(id) on delete cascade,
  account_code text not null,
  account_name text,
  debit numeric(18,2) default 0,
  credit numeric(18,2) default 0,
  balance numeric(18,2) default 0,
  fs_area public.fs_area,
  fs_caption text,
  created_at timestamptz not null default now()
);
create index if not exists idx_tb_lines_tb on public.trial_balance_lines(trial_balance_id);

-- Mapeo reutilizable cuenta -> área (recordado entre años por cliente)
create table if not exists public.account_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid not null references public.audit_clients(id) on delete cascade,
  account_code text not null,
  fs_area public.fs_area not null,
  fs_caption text,
  default_assertions public.assertion[] default '{}',
  created_at timestamptz not null default now(),
  unique (client_id, account_code)
);

-- ---------------------------------------------------------------------
-- Planeación (NIA 300 / 315 / 320 / 330)
-- ---------------------------------------------------------------------
create table if not exists public.audit_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  understanding_entity jsonb,
  it_environment jsonb,
  internal_control jsonb,
  going_concern jsonb,
  fraud_assessment jsonb,
  overall_strategy text,
  status text not null default 'borrador',  -- borrador / en_revision / aprobado
  agent_generated boolean not null default false,
  approved_by uuid,
  approved_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (engagement_id)
);

create table if not exists public.materiality (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  basis text,                          -- utilidad_antes_impuestos / activos_totales / ingresos / patrimonio
  benchmark_amount numeric(18,2),
  percentage numeric(6,3),
  overall_materiality numeric(18,2),
  performance_materiality numeric(18,2),
  clearly_trivial numeric(18,2),
  rationale text,
  agent_generated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (engagement_id)
);

create table if not exists public.audit_risks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  fs_area public.fs_area,
  account_code text,
  assertion public.assertion,
  risk_description text not null,
  risk_type text,                      -- inherente / control / fraude
  likelihood text,                     -- bajo / medio / alto
  magnitude text,                      -- bajo / medio / alto
  is_significant boolean not null default false,
  planned_response text,
  agent_generated boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_risks_engagement on public.audit_risks(engagement_id);

-- ---------------------------------------------------------------------
-- Programa de auditoría
-- ---------------------------------------------------------------------
create table if not exists public.audit_programs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  fs_area public.fs_area not null,
  objective text,
  agent_generated boolean not null default false,
  created_at timestamptz not null default now(),
  unique (engagement_id, fs_area)
);

create table if not exists public.audit_program_procedures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  program_id uuid not null references public.audit_programs(id) on delete cascade,
  assertion public.assertion,
  procedure text not null,
  procedure_type text,                 -- inspeccion / observacion / confirmacion / recalculo / reejecucion / analiticos / indagacion
  status text not null default 'pendiente',  -- pendiente / en_proceso / completado / no_aplica
  assigned_to uuid,
  workpaper_id uuid,                   -- FK lógica a audit_workpapers (se setea en ejecución)
  conclusion text,
  created_at timestamptz not null default now()
);
create index if not exists idx_procedures_program on public.audit_program_procedures(program_id);

-- ---------------------------------------------------------------------
-- Cédulas (papeles de trabajo)
-- ---------------------------------------------------------------------
create table if not exists public.audit_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  fs_area public.fs_area not null,
  reference text,                      -- índice de cédula (A, B, C...)
  current_balance numeric(18,2) default 0,
  prior_balance numeric(18,2) default 0,
  adjustments numeric(18,2) default 0,
  audited_balance numeric(18,2) default 0,
  variance_amount numeric(18,2) default 0,
  variance_pct numeric(8,3),
  over_materiality boolean not null default false,
  conclusion text,
  prepared_by uuid,
  reviewed_by uuid,
  prepared_at timestamptz,
  reviewed_at timestamptz,
  agent_generated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (engagement_id, fs_area)
);

create table if not exists public.summary_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  summary_id uuid not null references public.audit_summaries(id) on delete cascade,
  account_code text not null,
  account_name text,
  current_balance numeric(18,2) default 0,
  prior_balance numeric(18,2) default 0,
  variance numeric(18,2) default 0,
  variance_pct numeric(8,3),
  detail_reference text,               -- cruce a cédula de detalle (A-1...)
  created_at timestamptz not null default now()
);
create index if not exists idx_summary_lines_summary on public.summary_lines(summary_id);

create table if not exists public.audit_workpapers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  summary_id uuid references public.audit_summaries(id) on delete set null,
  reference text,                      -- A-1, B-2...
  title text,
  procedure_type text,
  objective text,
  work_performed text,
  results text,
  conclusion text,
  status text not null default 'borrador',  -- borrador / preparado / revisado
  file_url text,
  prepared_by uuid,
  reviewed_by uuid,
  agent_generated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_workpapers_engagement on public.audit_workpapers(engagement_id);

create table if not exists public.workpaper_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workpaper_id uuid not null references public.audit_workpapers(id) on delete cascade,
  processed_document_id uuid,          -- FK lógica a processed_documents (ver README)
  external_doc_url text,
  description text,
  tickmark text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Hallazgos, ajustes y conclusión (NIA 450 / 700 / 705)
-- ---------------------------------------------------------------------
create table if not exists public.audit_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  workpaper_id uuid references public.audit_workpapers(id) on delete set null,
  type text not null,                  -- ajuste / reclasificacion / deficiencia_control / observacion
  fs_area public.fs_area,
  description text,
  amount numeric(18,2),
  severity text,                       -- bajo / medio / alto
  recommendation text,
  management_response text,
  status text not null default 'abierto',  -- abierto / corregido / no_corregido
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  finding_id uuid references public.audit_findings(id) on delete set null,
  description text,
  debit_account text,
  credit_account text,
  amount numeric(18,2),
  classification text,                 -- corregido / no_corregido
  affects text,                        -- resultados / balance
  created_at timestamptz not null default now()
);

create table if not exists public.audit_conclusions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  scope text,
  conclusion text,
  signed_by uuid,
  signed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Trazabilidad de IA
-- ---------------------------------------------------------------------
create table if not exists public.audit_agent_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  agent_type text not null,            -- planificador / sumarias / organizador / revisor
  model text,
  input_ref jsonb,
  output_ref jsonb,
  status text not null default 'ok',   -- ok / error
  error text,
  tokens int,
  triggered_by uuid,
  reviewed_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_agent_runs_engagement on public.audit_agent_runs(engagement_id);

-- =====================================================================
-- RLS: acceso solo a filas de la firma a la que pertenece el usuario
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'audit_clients','audit_engagements','audit_team_members','audit_compliance_docs',
    'trial_balances','trial_balance_lines','account_mappings','audit_plans','materiality',
    'audit_risks','audit_programs','audit_program_procedures','audit_summaries',
    'summary_lines','audit_workpapers','workpaper_documents','audit_findings',
    'audit_adjustments','audit_conclusions','audit_agent_runs'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$
      drop policy if exists %1$s_rw on public.%1$I;
      create policy %1$s_rw on public.%1$I
        for all
        using (public.is_org_member(organization_id))
        with check (public.is_org_member(organization_id));
    $f$, t);
  end loop;
end $$;
