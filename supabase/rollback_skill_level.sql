-- Rollback for *_skill_level.sql: drops profiles.skill_level (players' levels are lost).
BEGIN;
REVOKE UPDATE (skill_level) ON public.profiles FROM authenticated;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_skill_level_check;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS skill_level;
COMMIT;
