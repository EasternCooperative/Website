-- Leadership tracker schema (D1). Applied with `wrangler d1 migrations apply`.
-- Every table carries created_at, updated_at, and deleted_at (soft delete).
-- Timestamps are ISO 8601 UTC strings.

CREATE TABLE person (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  email       TEXT,
  leader_slug TEXT,                       -- optional link to src/data/leaders/<slug>.md
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'hiatus', 'do_not_ask', 'mentor')),
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at  TEXT
);

CREATE TABLE activity_type (
  name        TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE activity (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  scope            TEXT NOT NULL CHECK (scope IN ('class', 'activity')),
  type             TEXT NOT NULL REFERENCES activity_type (name),
  subtype          TEXT,
  site_activity_id TEXT,                  -- optional link to the /activities collection
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at       TEXT
);

CREATE TABLE event (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  event_type    TEXT NOT NULL CHECK (event_type IN ('extended', 'one_day', 'weekend')),
  year          INTEGER NOT NULL,
  site_event_id TEXT,                     -- optional link to the event content collection
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at    TEXT
);

CREATE TABLE role (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id       INTEGER NOT NULL REFERENCES person (id),
  activity_id     INTEGER NOT NULL REFERENCES activity (id),
  event_id        INTEGER NOT NULL REFERENCES event (id),
  leadership_type TEXT NOT NULL CHECK (leadership_type IN ('solo', 'partner', 'assisting')),
  how_it_went     TEXT,
  source          TEXT NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual', 'event_import', 'sheet_import')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at      TEXT
);

-- One live role per person, activity, and event.
CREATE UNIQUE INDEX role_unique_live
  ON role (person_id, activity_id, event_id) WHERE deleted_at IS NULL;
CREATE INDEX role_person ON role (person_id);
CREATE INDEX role_activity ON role (activity_id);

-- Manual readiness record: a dated, attributed note, optionally flagged "ready".
CREATE TABLE journey_note (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id   INTEGER NOT NULL REFERENCES person (id),
  kind        TEXT NOT NULL CHECK (kind IN ('note', 'ready')),
  focus       TEXT,                       -- free text, e.g. "games class"
  body        TEXT NOT NULL,
  author      TEXT NOT NULL,              -- email from the Access JWT
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at  TEXT
);
CREATE INDEX journey_note_person ON journey_note (person_id);

INSERT INTO activity_type (name) VALUES
  ('Drama'), ('Games'), ('Dancing'), ('Theory'), ('Movement'),
  ('Personal Development'), ('Other'), ('Crafts'), ('Singing'), ('Play Parties');
