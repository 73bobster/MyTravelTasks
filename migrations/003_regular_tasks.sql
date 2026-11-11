-- 003: a person's regular tasks (added to every trip of a chosen type). Stored as a small json list on the user.
-- Safe to re-run.
ALTER TABLE users ADD COLUMN IF NOT EXISTS regular jsonb NOT NULL DEFAULT '[]'::jsonb;
