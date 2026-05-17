-- Add columns to organizations
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS default_account_ref text,
  ADD COLUMN IF NOT EXISTS sector text;

-- Onboarding progress table
CREATE TABLE IF NOT EXISTS public.onboarding_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE,
  current_step int NOT NULL DEFAULT 1,
  completed_steps int[] NOT NULL DEFAULT '{}',
  step_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view onboarding"
  ON public.onboarding_progress FOR SELECT
  USING (public.is_organization_member(auth.uid(), organization_id));

CREATE POLICY "Admins insert onboarding"
  ON public.onboarding_progress FOR INSERT
  WITH CHECK (public.is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins update onboarding"
  ON public.onboarding_progress FOR UPDATE
  USING (public.is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins delete onboarding"
  ON public.onboarding_progress FOR DELETE
  USING (public.is_organization_admin(auth.uid(), organization_id));

CREATE TRIGGER onboarding_progress_updated_at
  BEFORE UPDATE ON public.onboarding_progress
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();