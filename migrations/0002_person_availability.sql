-- Leading availability becomes three states (active, hiatus, inactive), and
-- mentoring becomes its own yes/no, because someone can mentor without leading,
-- or do both.
--
-- SQLite cannot edit a CHECK constraint, and rebuilding person would mean
-- dropping a table that role and journey_note reference. So the old column is
-- renamed aside, the new ones are added, the values are copied across, and the
-- old column (and its old CHECK) is dropped. Ids never change.
--
-- Old values: 'mentor' becomes active + mentor, 'do_not_ask' becomes inactive.

ALTER TABLE person RENAME COLUMN status TO old_status;

ALTER TABLE person ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'hiatus', 'inactive'));
ALTER TABLE person ADD COLUMN mentor INTEGER NOT NULL DEFAULT 0
  CHECK (mentor IN (0, 1));

UPDATE person SET
  status = CASE old_status WHEN 'hiatus' THEN 'hiatus' WHEN 'do_not_ask' THEN 'inactive' ELSE 'active' END,
  mentor = CASE WHEN old_status = 'mentor' THEN 1 ELSE 0 END;

ALTER TABLE person DROP COLUMN old_status;
