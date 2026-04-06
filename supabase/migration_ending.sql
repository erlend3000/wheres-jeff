-- Add 'ending' flag to seasons (admin clicked End but waiting for active mystery to reveal)
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS ending boolean NOT NULL DEFAULT false;
