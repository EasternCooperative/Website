-- Someone the team knows is an expert in a type of class or activity, set by hand. The
-- staffing fit counts the records, which can undersell a long-standing expert (roles were
-- never all entered). This lets a person fill the experience bar for a type.
CREATE TABLE expertise (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id  INTEGER NOT NULL REFERENCES person (id),
  type       TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT,
  created_by TEXT,
  updated_by TEXT
);
CREATE UNIQUE INDEX expertise_unique ON expertise (person_id, type) WHERE deleted_at IS NULL;
