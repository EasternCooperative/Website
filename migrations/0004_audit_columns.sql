-- Who made each change. created_by and updated_by hold the signed-in email from
-- the Cloudflare Access login (journey_note already has `author`). Rows loaded
-- before this migration have no recorded author, so they stay NULL: unknown,
-- not guessed. Plain ADD COLUMN, so ids and existing data are untouched.

ALTER TABLE person ADD COLUMN created_by TEXT;
ALTER TABLE person ADD COLUMN updated_by TEXT;
ALTER TABLE activity ADD COLUMN created_by TEXT;
ALTER TABLE activity ADD COLUMN updated_by TEXT;
ALTER TABLE event ADD COLUMN created_by TEXT;
ALTER TABLE event ADD COLUMN updated_by TEXT;
ALTER TABLE role ADD COLUMN created_by TEXT;
ALTER TABLE role ADD COLUMN updated_by TEXT;
