-- Venues added in the tool, for places that are not in the site content. A venue is a
-- name and a postal code with its center point, enough to say how far people live from it.
-- Events point at a venue by `event.site_id`, which is a content venue slug or one of these ids.
CREATE TABLE venue (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  city        TEXT,
  state       TEXT,
  postal_code TEXT NOT NULL,
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by  TEXT
);
