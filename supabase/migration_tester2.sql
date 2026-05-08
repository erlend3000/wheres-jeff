-- Where's Jeff? — Move role to profiles (user-level)
-- Run this in Supabase SQL Editor.
-- Moves the tester/admin role from season_members to profiles.

-- 1. Add role column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'player';

-- 2. Backfill: existing admins get 'admin' role
UPDATE profiles SET role = 'admin' WHERE is_admin = true;

-- 3. Drop the per-season role column (no longer needed)
ALTER TABLE season_members DROP COLUMN IF EXISTS role;
