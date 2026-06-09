
-- 1. Drop the trigger that auto-creates "Mi Empresa" for every signup
DROP TRIGGER IF EXISTS on_auth_user_created_organization ON auth.users;
DROP TRIGGER IF EXISTS handle_new_user_organization_trigger ON auth.users;

-- 2. Recreate FKs with ON DELETE CASCADE for clean user deletion

-- profiles.id -> auth.users(id)
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- organization_members.user_id -> auth.users(id)
ALTER TABLE public.organization_members DROP CONSTRAINT IF EXISTS organization_members_user_id_fkey;
ALTER TABLE public.organization_members
  ADD CONSTRAINT organization_members_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- user_roles.user_id -> auth.users(id)
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_fkey;
ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- user_active_organization.user_id -> auth.users(id)
ALTER TABLE public.user_active_organization DROP CONSTRAINT IF EXISTS user_active_organization_user_id_fkey;
ALTER TABLE public.user_active_organization
  ADD CONSTRAINT user_active_organization_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- password_reset_tokens.user_id -> auth.users(id) (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='password_reset_tokens' AND column_name='user_id') THEN
    EXECUTE 'ALTER TABLE public.password_reset_tokens DROP CONSTRAINT IF EXISTS password_reset_tokens_user_id_fkey';
    EXECUTE 'ALTER TABLE public.password_reset_tokens ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE';
  END IF;
END $$;

-- organization_invitations.invited_by -> auth.users(id) SET NULL (keep history)
ALTER TABLE public.organization_invitations DROP CONSTRAINT IF EXISTS organization_invitations_invited_by_fkey;
ALTER TABLE public.organization_invitations
  ADD CONSTRAINT organization_invitations_invited_by_fkey
  FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- audit_log.user_id -> auth.users(id) SET NULL (keep history)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='audit_log' AND column_name='user_id') THEN
    EXECUTE 'ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_user_id_fkey';
    EXECUTE 'ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL';
  END IF;
END $$;
