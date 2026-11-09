-- 002: guidance text on generated tasks, and a flag so re-planning a trip keeps manual edits.
-- Already applied to the Neon project "mytraveltasks". Safe to re-run.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS hint text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS user_edited boolean NOT NULL DEFAULT false;
