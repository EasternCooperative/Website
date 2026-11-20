-- Where a person lives, at the level of a postal code: city, state, and the postal code's
-- center point. Never a street address. Used only to say how far someone is from an
-- event's venue when staffing. One row per person, replaced when a newer address arrives.
CREATE TABLE person_location (
  person_id   INTEGER PRIMARY KEY REFERENCES person (id),
  city        TEXT,
  state       TEXT,
  postal_code TEXT NOT NULL,
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  source      TEXT,
  as_of       TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
