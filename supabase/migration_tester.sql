-- Where's Jeff? — Tester Role
-- Run this in Supabase SQL Editor.
-- Adds a per-season role column so members can be 'player' (default) or 'tester'.
-- Testers play normally but are invisible to other players in all game views.

ALTER TABLE season_members ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'player';
