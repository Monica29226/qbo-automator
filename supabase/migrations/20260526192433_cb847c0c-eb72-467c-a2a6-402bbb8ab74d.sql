
-- 1. Allowed emails table
CREATE TABLE public.allowed_emails (
  email text PRIMARY KEY,
  default_role app_role NOT NULL DEFAULT 'user',
  note text,
  added_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Force lowercase
CREATE OR REPLACE FUNCTION public.allowed_emails_lowercase()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.email := lower(trim(NEW.email));
  RETURN NEW;
END;
$$;

CREATE TRIGGER allowed_emails_lowercase_trg
BEFORE INSERT OR UPDATE ON public.allowed_emails
FOR EACH ROW EXECUTE FUNCTION public.allowed_emails_lowercase();

-- Grants (admin-only via RLS; service_role for edge functions)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.allowed_emails TO authenticated;
GRANT ALL ON public.allowed_emails TO service_role;

ALTER TABLE public.allowed_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view allowed emails"
ON public.allowed_emails FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert allowed emails"
ON public.allowed_emails FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update allowed emails"
ON public.allowed_emails FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete allowed emails"
ON public.allowed_emails FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 2. Replace handle_new_user to enforce whitelist
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _allowed_role app_role;
  _email text := lower(NEW.email);
BEGIN
  SELECT default_role INTO _allowed_role
  FROM public.allowed_emails
  WHERE email = _email;

  IF _allowed_role IS NULL THEN
    RAISE EXCEPTION 'email_not_allowed';
  END IF;

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, _allowed_role);

  RETURN NEW;
END;
$$;

-- 3. Preload admin
INSERT INTO public.allowed_emails (email, default_role, note)
VALUES ('monica@aclcostarica.com', 'admin', 'Initial admin')
ON CONFLICT (email) DO UPDATE SET default_role = EXCLUDED.default_role;
