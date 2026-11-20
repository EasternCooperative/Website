-- Who may use the tool, and what they may see. Cloudflare Access proves who signed
-- in; this table says what they can do. A person who passes Access but is not here
-- is refused (fail closed).
--
--   level     'finance'  sees everything, including donation amounts (board, treasurer)
--             'standard' sees everything except amounts, which show as broad tiers
--   is_admin  may manage this list. Separate from level, so it does not reveal amounts.
--   protected 1 marks an owner. A protected person is always a finance admin, and the
--             database itself refuses to remove or downgrade them (see the triggers), so
--             neither a bug nor a stray edit can lock the owners out. It can only be set
--             by hand with `wrangler d1 execute`, never through the app.
--
-- No people are seeded here: the first admin is added by hand with `wrangler d1
-- execute`, so no email addresses land in the repository.

CREATE TABLE app_user (
  email_lower TEXT PRIMARY KEY,
  level       TEXT NOT NULL CHECK (level IN ('finance', 'standard')),
  is_admin    INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  protected   INTEGER NOT NULL DEFAULT 0 CHECK (protected IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at  TEXT,
  created_by  TEXT,
  updated_by  TEXT
);

CREATE TRIGGER app_user_protect_update BEFORE UPDATE ON app_user
WHEN OLD.protected = 1
  AND (NEW.deleted_at IS NOT NULL OR NEW.is_admin != 1 OR NEW.level != 'finance' OR NEW.protected != 1)
BEGIN
  SELECT RAISE(ABORT, 'protected user');
END;

CREATE TRIGGER app_user_protect_delete BEFORE DELETE ON app_user
WHEN OLD.protected = 1
BEGIN
  SELECT RAISE(ABORT, 'protected user');
END;

-- Append-only record of access changes and exports.
CREATE TABLE audit_log (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actor  TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);
