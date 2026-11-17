// Leadership tracker data layer (D1). Pure functions over a D1 binding so they
// can be tested with a stub. All SQL is parameterized; every table soft-deletes.

const STATUSES = ['active', 'hiatus', 'inactive'];
const SCOPES = ['class', 'activity'];
const EVENT_TYPES = ['extended', 'one_day', 'weekend'];
const LEADERSHIP_TYPES = ['solo', 'partner', 'assisting'];
const NOTE_KINDS = ['note', 'ready'];

export class ValidationError extends Error {}

const str = (v, field, { max = 500, required = false } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  if (typeof v !== 'string') throw new ValidationError(`${field} must be text`);
  const t = v.trim();
  if (!t && required) throw new ValidationError(`${field} is required`);
  if (t.length > max) throw new ValidationError(`${field} is too long`);
  return t || null;
};

const oneOf = (v, field, allowed) => {
  if (!allowed.includes(v)) throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`);
  return v;
};

// A yes/no sent as true/false or 1/0. Missing means no.
const flag = (v, field) => {
  if (v === undefined || v === null || v === false || v === 0) return 0;
  if (v === true || v === 1) return 1;
  throw new ValidationError(`${field} must be yes or no`);
};

const id = (v, field) => {
  if (!Number.isInteger(v) || v < 1) throw new ValidationError(`${field} must be an id`);
  return v;
};

export const validators = {
  person: (b) => ({
    name: str(b.name, 'name', { required: true, max: 120 }),
    email: str(b.email, 'email', { max: 200 }),
    leader_slug: str(b.leader_slug, 'leader_slug', { max: 120 }),
    status: oneOf(b.status ?? 'active', 'status', STATUSES),
    mentor: flag(b.mentor, 'mentor'),
    notes: str(b.notes, 'notes', { max: 4000 }),
  }),
  activity: (b) => ({
    name: str(b.name, 'name', { required: true, max: 200 }),
    scope: oneOf(b.scope, 'scope', SCOPES),
    type: str(b.type, 'type', { required: true, max: 80 }),
    subtype: str(b.subtype, 'subtype', { max: 80 }),
    site_activity_id: str(b.site_activity_id, 'site_activity_id', { max: 120 }),
  }),
  event: (b) => ({
    name: str(b.name, 'name', { required: true, max: 200 }),
    event_type: oneOf(b.event_type, 'event_type', EVENT_TYPES),
    year: (() => {
      if (!Number.isInteger(b.year) || b.year < 1970 || b.year > 2100) throw new ValidationError('year is invalid');
      return b.year;
    })(),
    site_event_id: str(b.site_event_id, 'site_event_id', { max: 120 }),
  }),
  role: (b) => ({
    person_id: id(b.person_id, 'person_id'),
    activity_id: id(b.activity_id, 'activity_id'),
    event_id: id(b.event_id, 'event_id'),
    leadership_type: oneOf(b.leadership_type, 'leadership_type', LEADERSHIP_TYPES),
    how_it_went: str(b.how_it_went, 'how_it_went', { max: 2000 }),
    source: oneOf(b.source ?? 'manual', 'source', ['manual', 'event_import', 'sheet_import']),
  }),
  note: (b) => ({
    person_id: id(b.person_id, 'person_id'),
    kind: oneOf(b.kind ?? 'note', 'kind', NOTE_KINDS),
    focus: str(b.focus, 'focus', { max: 200 }),
    body: str(b.body, 'body', { required: true, max: 4000 }),
  }),
};

// Table name and column list come from this allowlist, never from the request.
const TABLES = {
  person: ['name', 'email', 'leader_slug', 'status', 'mentor', 'notes'],
  activity: ['name', 'scope', 'type', 'subtype', 'site_activity_id'],
  event: ['name', 'event_type', 'year', 'site_event_id'],
  role: ['person_id', 'activity_id', 'event_id', 'leadership_type', 'how_it_went', 'source'],
  journey_note: ['person_id', 'kind', 'focus', 'body', 'author'],
};

export const tableFor = (resource) => (resource === 'note' ? 'journey_note' : resource);

export async function bootstrap(db) {
  const live = (t) => db.prepare(`SELECT * FROM ${t} WHERE deleted_at IS NULL ORDER BY id`).all();
  const [people, activities, events, roles, notes, types] = await Promise.all([
    live('person'),
    live('activity'),
    live('event'),
    live('role'),
    live('journey_note'),
    db.prepare('SELECT name FROM activity_type ORDER BY name').all(),
  ]);
  return {
    people: people.results,
    activities: activities.results,
    events: events.results,
    roles: roles.results,
    notes: notes.results,
    activityTypes: types.results.map((r) => r.name),
  };
}

export async function createRow(db, resource, values, author) {
  const table = tableFor(resource);
  const cols = TABLES[table];
  const data = table === 'journey_note' ? { ...values, author } : values;
  if (table === 'activity') await ensureType(db, data.type);
  const res = await db
    .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .bind(...cols.map((c) => data[c] ?? null))
    .run();
  return res.meta.last_row_id;
}

export async function updateRow(db, resource, rowId, values) {
  const table = tableFor(resource);
  if (table === 'journey_note') {
    // Notes are append-only history except for editing the text and focus.
    values = { focus: values.focus, body: values.body };
  }
  const cols = Object.keys(values).filter((c) => TABLES[table].includes(c));
  if (!cols.length) throw new ValidationError('nothing to update');
  if (table === 'activity' && values.type) await ensureType(db, values.type);
  const res = await db
    .prepare(
      `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND deleted_at IS NULL`
    )
    .bind(...cols.map((c) => values[c] ?? null), rowId)
    .run();
  return res.meta.changes > 0;
}

export async function softDelete(db, resource, rowId) {
  const table = tableFor(resource);
  const res = await db
    .prepare(
      `UPDATE ${table} SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND deleted_at IS NULL`
    )
    .bind(rowId)
    .run();
  return res.meta.changes > 0;
}

async function ensureType(db, type) {
  await db.prepare('INSERT OR IGNORE INTO activity_type (name) VALUES (?)').bind(type).run();
}

/** Bulk-add roles for one event. Existing live person+activity+event rows are skipped. */
export async function bulkAddRoles(db, rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 200) {
    throw new ValidationError('send between 1 and 200 roles');
  }
  const clean = rows.map((r) => validators.role(r));
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO role (person_id, activity_id, event_id, leadership_type, how_it_went, source)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const results = await db.batch(
    clean.map((r) => stmt.bind(r.person_id, r.activity_id, r.event_id, r.leadership_type, r.how_it_went, r.source))
  );
  return results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
}

export async function exportAll(db) {
  const data = await bootstrap(db);
  return { exportedAt: new Date().toISOString(), ...data };
}
