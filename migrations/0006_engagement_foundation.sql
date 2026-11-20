-- Engagement foundation: more ways to find a person, and more kinds of record about
-- them. Leadership (role, journey_note) stays as it is and is one more record type.
--
-- Rules this schema follows:
--   * Money lives in `donation` and nowhere else. Registrations hold no amounts, so
--     nothing outside the finance-only view can leak a figure.
--   * One registration row is one adult at one event. A party's children are not
--     people here: they are counted on the party and, if recorded at all, kept as a
--     keyed hash in `child_attendance`.
--   * No CHECK lists on columns that will grow (source, goal, status, body). The data
--     layer validates those, because SQLite cannot alter a CHECK later.
--   * Every table carries created/updated/deleted timestamps and who made the change.
--   * Imported rows point at an `import_batch`, so a bad import is undone as a unit.

-- A person who has been erased keeps a row, so ids and counts stay intact, but every
-- identifying field is cleared (see the erase action in functions/_lib/engagement.js).
ALTER TABLE person ADD COLUMN erased_at TEXT;

CREATE TABLE import_batch (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source       TEXT NOT NULL,
  label        TEXT,
  file_sha256  TEXT,
  rows_in      INTEGER NOT NULL DEFAULT 0,
  rows_new     INTEGER NOT NULL DEFAULT 0,
  rows_matched INTEGER NOT NULL DEFAULT 0,
  rows_review  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at   TEXT,
  created_by   TEXT,
  updated_by   TEXT
);

-- Several addresses per person. A shared address (a couple) is flagged and never
-- used to match someone automatically.
CREATE TABLE person_email (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id   INTEGER NOT NULL REFERENCES person (id),
  email_lower TEXT NOT NULL,
  is_primary  INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  shared      INTEGER NOT NULL DEFAULT 0 CHECK (shared IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at  TEXT,
  created_by  TEXT,
  updated_by  TEXT
);
CREATE UNIQUE INDEX person_email_unique ON person_email (person_id, email_lower) WHERE deleted_at IS NULL;
CREATE INDEX person_email_lookup ON person_email (email_lower);

-- Nicknames and other names a person goes by, normalized. Private data: former names
-- live here and in private files, never in the repository.
CREATE TABLE person_alias (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id   INTEGER NOT NULL REFERENCES person (id),
  alias_norm  TEXT NOT NULL,
  kind        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at  TEXT,
  created_by  TEXT,
  updated_by  TEXT
);
CREATE UNIQUE INDEX person_alias_unique ON person_alias (person_id, alias_norm) WHERE deleted_at IS NULL;
CREATE INDEX person_alias_lookup ON person_alias (alias_norm);

-- One adult at one event. A single form entry can hold several adults, so the key is
-- the source, the entry, and the attendee within it (attendee_ref is '' when the
-- source has one person per entry). `attended` is NULL unless a source says so: a
-- registration is not proof of attendance.
CREATE TABLE registration (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id       INTEGER NOT NULL REFERENCES person (id),
  event_id        INTEGER NOT NULL REFERENCES event (id),
  source          TEXT NOT NULL,
  entry_ref       TEXT NOT NULL,
  attendee_ref    TEXT NOT NULL DEFAULT '',
  form_ref        TEXT,
  registered_at   TEXT,
  status          TEXT NOT NULL DEFAULT 'registered',
  attended        INTEGER CHECK (attended IN (0, 1)),
  party_adults    INTEGER,
  party_children  INTEGER,
  batch_id        INTEGER REFERENCES import_batch (id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at      TEXT,
  created_by      TEXT,
  updated_by      TEXT
);
CREATE UNIQUE INDEX registration_unique ON registration (source, entry_ref, attendee_ref) WHERE deleted_at IS NULL;
CREATE INDEX registration_person ON registration (person_id);
CREATE INDEX registration_event ON registration (event_id);

-- A child's attendance, kept only as a keyed hash of their name (HMAC-SHA256, key held
-- outside the database) and a coarse age band. No names, no birth dates, no link to a
-- person row, and never shown in lists, search, scores, or exports.
CREATE TABLE child_attendance (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL REFERENCES event (id),
  source     TEXT NOT NULL,
  entry_ref  TEXT NOT NULL,
  token      TEXT NOT NULL,
  age_band   TEXT,
  batch_id   INTEGER REFERENCES import_batch (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT,
  created_by TEXT,
  updated_by TEXT
);
CREATE UNIQUE INDEX child_attendance_unique ON child_attendance (source, entry_ref, token) WHERE deleted_at IS NULL;
CREATE INDEX child_attendance_token ON child_attendance (token);

-- Every gift, including the donation lines inside a ticket purchase ("Additional
-- donation", "Help us break even"). Finance-only: see person_giving below.
-- person_id may be NULL for an anonymous gift.
CREATE TABLE donation (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id    INTEGER REFERENCES person (id),
  source       TEXT NOT NULL,
  source_ref   TEXT NOT NULL,
  line_ref     TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL,
  donated_at   TEXT NOT NULL,
  campaign     TEXT,
  kind         TEXT NOT NULL DEFAULT 'gift',
  recurring    INTEGER NOT NULL DEFAULT 0 CHECK (recurring IN (0, 1)),
  event_id     INTEGER REFERENCES event (id),
  batch_id     INTEGER REFERENCES import_batch (id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at   TEXT,
  created_by   TEXT,
  updated_by   TEXT
);
CREATE UNIQUE INDEX donation_unique ON donation (source, source_ref, line_ref) WHERE deleted_at IS NULL;
CREATE INDEX donation_person ON donation (person_id);

CREATE TABLE membership (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id  INTEGER NOT NULL REFERENCES person (id),
  kind       TEXT NOT NULL,
  starts_on  TEXT,
  ends_on    TEXT,
  source     TEXT,
  source_ref TEXT,
  batch_id   INTEGER REFERENCES import_batch (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT,
  created_by TEXT,
  updated_by TEXT
);
CREATE INDEX membership_person ON membership (person_id);

-- Recorded going forward, by hand: who helped and with what.
CREATE TABLE volunteer (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id  INTEGER NOT NULL REFERENCES person (id),
  event_id   INTEGER REFERENCES event (id),
  task       TEXT NOT NULL,
  hours      REAL,
  note       TEXT,
  batch_id   INTEGER REFERENCES import_batch (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT,
  created_by TEXT,
  updated_by TEXT
);
CREATE INDEX volunteer_person ON volunteer (person_id);

-- Board and committee service, with dates where they are known.
CREATE TABLE service (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id  INTEGER NOT NULL REFERENCES person (id),
  body       TEXT NOT NULL,
  title      TEXT,
  started_on TEXT,
  ended_on   TEXT,
  note       TEXT,
  source     TEXT,
  batch_id   INTEGER REFERENCES import_batch (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT,
  created_by TEXT,
  updated_by TEXT
);
CREATE INDEX service_person ON service (person_id);

-- The pipeline: who we have thought about inviting, for what, and where that stands.
CREATE TABLE outreach (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id    INTEGER NOT NULL REFERENCES person (id),
  goal         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'suggested',
  contacted_on TEXT,
  snooze_until TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at   TEXT,
  created_by   TEXT,
  updated_by   TEXT
);
CREATE INDEX outreach_person ON outreach (person_id);

-- Which Cognito form or Zeffy campaign belongs to which event.
CREATE TABLE event_source (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL REFERENCES event (id),
  source     TEXT NOT NULL,
  form_ref   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT,
  created_by TEXT,
  updated_by TEXT
);
CREATE UNIQUE INDEX event_source_unique ON event_source (source, form_ref) WHERE deleted_at IS NULL;

-- Append-only record of two people being recognized as one.
CREATE TABLE person_merge (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  from_person_id INTEGER NOT NULL,
  into_person_id INTEGER NOT NULL,
  summary        TEXT,
  at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  merged_by      TEXT NOT NULL
);

-- The broad giving bands everyone sees instead of amounts. Each row starts at its
-- min_cents. These cutoffs are PLACEHOLDERS for the board to set before any real gifts
-- are loaded.
CREATE TABLE giving_tier (
  rank      INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  min_cents INTEGER NOT NULL
);
INSERT INTO giving_tier (rank, name, min_cents) VALUES
  (0, 'No gifts', 0),
  (1, 'Small', 1),
  (2, 'Medium', 10000),
  (3, 'Large', 50000);

-- FINANCE ONLY. Totals and dates per person. The API reads this view only for people
-- at the finance level, and never selects from it for anyone else.
CREATE VIEW person_giving AS
SELECT
  p.id AS person_id,
  COALESCE(SUM(d.amount_cents), 0) AS total_cents,
  COUNT(d.id) AS gift_count,
  MIN(d.donated_at) AS first_gift_at,
  MAX(d.donated_at) AS last_gift_at
FROM person p
LEFT JOIN donation d ON d.person_id = p.id AND d.deleted_at IS NULL
WHERE p.deleted_at IS NULL
GROUP BY p.id;

-- Everything the standard level may see about a person: facts and counts, with giving
-- reduced to a tier. No amount, total, or per-gift date leaves this view.
CREATE VIEW person_engagement AS
SELECT
  p.id AS person_id,
  p.name,
  p.status,
  p.mentor,
  (SELECT COUNT(DISTINCT r.event_id) FROM registration r
     WHERE r.person_id = p.id AND r.deleted_at IS NULL AND r.status != 'cancelled') AS events_registered,
  (SELECT COUNT(DISTINCT r.event_id) FROM registration r
     WHERE r.person_id = p.id AND r.deleted_at IS NULL AND r.attended = 1) AS events_attended,
  (SELECT MAX(e.year) FROM registration r JOIN event e ON e.id = r.event_id
     WHERE r.person_id = p.id AND r.deleted_at IS NULL AND r.status != 'cancelled') AS last_event_year,
  (SELECT COUNT(*) FROM role l WHERE l.person_id = p.id AND l.deleted_at IS NULL
     AND l.leadership_type IN ('solo', 'partner')) AS roles_led,
  (SELECT COUNT(*) FROM role l WHERE l.person_id = p.id AND l.deleted_at IS NULL) AS roles_total,
  (SELECT MAX(e.year) FROM role l JOIN event e ON e.id = l.event_id
     WHERE l.person_id = p.id AND l.deleted_at IS NULL) AS last_led_year,
  (SELECT COUNT(*) FROM volunteer v WHERE v.person_id = p.id AND v.deleted_at IS NULL) AS volunteer_count,
  EXISTS (SELECT 1 FROM membership m WHERE m.person_id = p.id AND m.deleted_at IS NULL
     AND (m.kind = 'life' OR m.ends_on >= date('now'))) AS member_now,
  (SELECT COUNT(*) FROM service s WHERE s.person_id = p.id AND s.deleted_at IS NULL
     AND (s.ended_on IS NULL OR s.ended_on >= date('now'))) AS serving_now,
  (SELECT COUNT(*) FROM donation d WHERE d.person_id = p.id AND d.deleted_at IS NULL) AS gift_count,
  COALESCE((SELECT t.rank FROM giving_tier t
     WHERE t.min_cents <= COALESCE((SELECT SUM(d.amount_cents) FROM donation d
       WHERE d.person_id = p.id AND d.deleted_at IS NULL), 0)
     ORDER BY t.min_cents DESC LIMIT 1), 0) AS giving_tier_rank,
  (SELECT MAX(o.contacted_on) FROM outreach o WHERE o.person_id = p.id AND o.deleted_at IS NULL) AS last_contacted_on,
  EXISTS (SELECT 1 FROM outreach o WHERE o.person_id = p.id AND o.deleted_at IS NULL
     AND o.status = 'do_not_contact') AS do_not_contact
FROM person p
WHERE p.deleted_at IS NULL AND p.erased_at IS NULL;
