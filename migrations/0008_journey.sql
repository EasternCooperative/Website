-- The engagement journey. A person's stage is DERIVED from records so it is never stale:
--   supporter  member or donor only
--   attendee   registered for an event
--   volunteer  helped (volunteered, or assisted a leader)
--   activity   led an activity (solo or partner)
--   class      led a class (solo or partner)
-- Serving on a committee or the board is a separate lane, reachable from any stage.
-- Nothing here carries money: giving only counts toward "supporter".
CREATE VIEW person_journey AS
SELECT
  p.id AS person_id,
  p.name,
  p.status,
  p.mentor,
  (SELECT MIN(e.year) FROM registration r JOIN event e ON e.id = r.event_id
     WHERE r.person_id = p.id AND r.deleted_at IS NULL AND r.status != 'cancelled') AS first_attended_year,
  (SELECT MIN(y) FROM (
     SELECT COALESCE(e.year, CAST(substr(v.created_at, 1, 4) AS INTEGER)) AS y
       FROM volunteer v LEFT JOIN event e ON e.id = v.event_id
      WHERE v.person_id = p.id AND v.deleted_at IS NULL
     UNION ALL
     SELECT e.year FROM role l JOIN event e ON e.id = l.event_id
      WHERE l.person_id = p.id AND l.deleted_at IS NULL AND l.leadership_type = 'assisting')) AS first_volunteer_year,
  (SELECT MIN(e.year) FROM role l JOIN event e ON e.id = l.event_id JOIN activity a ON a.id = l.activity_id
     WHERE l.person_id = p.id AND l.deleted_at IS NULL AND l.leadership_type IN ('solo', 'partner')
       AND a.scope = 'activity') AS first_activity_year,
  (SELECT MIN(e.year) FROM role l JOIN event e ON e.id = l.event_id JOIN activity a ON a.id = l.activity_id
     WHERE l.person_id = p.id AND l.deleted_at IS NULL AND l.leadership_type IN ('solo', 'partner')
       AND a.scope = 'class') AS first_class_year,
  (SELECT COUNT(*) FROM role l JOIN activity a ON a.id = l.activity_id
     WHERE l.person_id = p.id AND l.deleted_at IS NULL AND l.leadership_type IN ('solo', 'partner')
       AND a.scope = 'activity') AS activities_led,
  (SELECT COUNT(*) FROM role l JOIN activity a ON a.id = l.activity_id
     WHERE l.person_id = p.id AND l.deleted_at IS NULL AND l.leadership_type IN ('solo', 'partner')
       AND a.scope = 'class') AS classes_led,
  (SELECT COUNT(*) FROM volunteer v WHERE v.person_id = p.id AND v.deleted_at IS NULL) AS volunteer_count,
  (SELECT COUNT(DISTINCT r.event_id) FROM registration r
     WHERE r.person_id = p.id AND r.deleted_at IS NULL AND r.status != 'cancelled') AS events_registered,
  (SELECT MIN(CAST(substr(s.started_on, 1, 4) AS INTEGER)) FROM service s
     WHERE s.person_id = p.id AND s.deleted_at IS NULL) AS first_service_year,
  (SELECT COUNT(*) FROM service s WHERE s.person_id = p.id AND s.deleted_at IS NULL) AS service_terms,
  (SELECT COUNT(*) FROM service s WHERE s.person_id = p.id AND s.deleted_at IS NULL
     AND (s.ended_on IS NULL OR s.ended_on >= date('now'))) AS serving_now,
  EXISTS (SELECT 1 FROM service s WHERE s.person_id = p.id AND s.deleted_at IS NULL
     AND (s.ended_on IS NULL OR s.ended_on >= date('now')) AND s.body = 'Board of Directors') AS on_board_now,
  (EXISTS (SELECT 1 FROM membership m WHERE m.person_id = p.id AND m.deleted_at IS NULL)
     OR EXISTS (SELECT 1 FROM donation d WHERE d.person_id = p.id AND d.deleted_at IS NULL)) AS supporter,
  (SELECT MAX(y) FROM (
     SELECT MAX(e.year) AS y FROM registration r JOIN event e ON e.id = r.event_id
       WHERE r.person_id = p.id AND r.deleted_at IS NULL AND r.status != 'cancelled'
     UNION ALL
     SELECT MAX(e.year) FROM role l JOIN event e ON e.id = l.event_id
       WHERE l.person_id = p.id AND l.deleted_at IS NULL
     UNION ALL
     SELECT MAX(COALESCE(e.year, CAST(substr(v.created_at, 1, 4) AS INTEGER))) FROM volunteer v
       LEFT JOIN event e ON e.id = v.event_id WHERE v.person_id = p.id AND v.deleted_at IS NULL)) AS last_active_year,
  EXISTS (SELECT 1 FROM outreach o WHERE o.person_id = p.id AND o.deleted_at IS NULL
     AND o.status = 'do_not_contact') AS do_not_contact
FROM person p
WHERE p.deleted_at IS NULL AND p.erased_at IS NULL;

-- What a person is aiming for next, set by hand. It never changes the derived stage.
CREATE TABLE journey_plan (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id  INTEGER NOT NULL REFERENCES person (id),
  target     TEXT,
  next_step  TEXT,
  due_on     TEXT,
  owner      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT,
  created_by TEXT,
  updated_by TEXT
);
CREATE UNIQUE INDEX journey_plan_person ON journey_plan (person_id) WHERE deleted_at IS NULL;
