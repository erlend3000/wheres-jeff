-- Drop unused legacy columns from profiles
-- These columns were defined in the original schema but never written to.
-- All score/wins/karma values are computed dynamically from the guesses
-- table by getSeasonLeaderboard / getMysteryLeaderboard. Verified that:
--   - No UPDATE/INSERT in the codebase ever sets them
--   - No SELECT in the codebase ever reads them by name
--   - Column-level grants in migration_profiles_lockdown.sql only allow
--     SELECT on (id, name), so they were already inaccessible
--   - No views, triggers, constraints or RPCs reference them
-- Safe to drop; no fallout expected.

ALTER TABLE public.profiles DROP COLUMN IF EXISTS total_score;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS wins;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS jeff_karma;
