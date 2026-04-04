-- Mystery Library & Game Scheduling migration
-- Run this in Supabase SQL Editor

-- Allow mysteries to exist without a game (library items have season_id = NULL)
ALTER TABLE mysteries ALTER COLUMN season_id DROP NOT NULL;

-- Track which mystery instances have manually overridden timing
ALTER TABLE mysteries ADD COLUMN IF NOT EXISTS override boolean NOT NULL DEFAULT false;

-- Add scheduling config to seasons (games)
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS frequency_value int;
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS frequency_unit text DEFAULT 'minutes';
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS gap_value int;
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS gap_unit text DEFAULT 'minutes';
