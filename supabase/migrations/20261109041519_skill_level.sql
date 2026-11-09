-- Player skill level: an optional self-declared level on the player's own profile, shown to staff in open play.
-- Players may update it on their own row (same column-level grant as full_name and phone; the existing
-- profiles update policy still limits them to their own row).
-- Rollback: supabase/rollback_skill_level.sql

BEGIN;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS skill_level text;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_skill_level_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_skill_level_check
  CHECK (skill_level IN ('beginner', 'intermediate', 'advanced'));

GRANT UPDATE (skill_level) ON public.profiles TO authenticated;

COMMIT;
