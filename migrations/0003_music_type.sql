-- Music becomes an activity type, with Singing as one of its subtypes (others
-- include Instruments and Rhythm). Existing Singing activities move under Music
-- and keep their place by getting the subtype Singing, unless they already had
-- a subtype of their own. The retired Singing type is then removed.

INSERT OR IGNORE INTO activity_type (name) VALUES ('Music');

UPDATE activity SET
  type = 'Music',
  subtype = COALESCE(NULLIF(subtype, ''), 'Singing'),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE type = 'Singing';

DELETE FROM activity_type WHERE name = 'Singing';
