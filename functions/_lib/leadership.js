// Leadership tracker data layer (D1). Pure functions over a D1 binding so they
// can be tested with a stub. All SQL is parameterized; every table soft-deletes.

const STATUSES = ['active', 'hiatus', 'inactive'];
const SCOPES = ['class', 'activity'];
const EVENT_TYPES = ['extended', 'one_day', 'weekend'];
const LEADERSHIP_TYPES = ['solo', 'partner', 'assisting'];
const NOTE_KINDS = ['note', 'ready'];
// Lists that will grow are checked here, not with a CHECK in the database, which SQLite cannot alter.
export const OUTREACH_GOALS = [
  'invite_back',
  'invite_lead',
  'invite_committee',
  'invite_board',
  'thank_donor',
  'staff_slot',
];
export const OUTREACH_STATUSES = ['suggested', 'contacted', 'accepted', 'declined', 'snoozed', 'do_not_contact'];

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

// A year, a month, or a full date: "2024", "2024-06", "2024-06-30".
const fullDate = (v, field) => {
  const t = str(v, field, { max: 10 });
  if (t !== null && !/^\d{4}-\d{2}-\d{2}$/.test(t))
    throw new ValidationError(`${field} must be a date like 2024-06-30`);
  return t;
};

const partialDate = (v, field) => {
  const t = str(v, field, { max: 10 });
  if (t !== null && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(t))
    throw new ValidationError(`${field} must be a date like 2024 or 2024-06-30`);
  return t;
};

const optionalId = (v, field) => (v === undefined || v === null ? null : id(v, field));

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
    // Only touched when sent, so an older client saving a name never clears them.
    ...('start_date' in b && { start_date: fullDate(b.start_date, 'start_date') }),
    ...('end_date' in b && { end_date: fullDate(b.end_date, 'end_date') }),
    ...('site_id' in b && { site_id: str(b.site_id, 'site_id', { max: 120 }) }),
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
  service: (b) => ({
    person_id: id(b.person_id, 'person_id'),
    body: str(b.body, 'body', { required: true, max: 120 }),
    title: str(b.title, 'title', { max: 120 }),
    started_on: partialDate(b.started_on, 'started_on'),
    ended_on: partialDate(b.ended_on, 'ended_on'),
    note: str(b.note, 'note', { max: 1000 }),
    source: str(b.source, 'source', { max: 60 }) ?? 'manual',
  }),
  volunteer: (b) => ({
    person_id: id(b.person_id, 'person_id'),
    event_id: optionalId(b.event_id, 'event_id'),
    task: str(b.task, 'task', { required: true, max: 200 }),
    hours: (() => {
      if (b.hours === undefined || b.hours === null || b.hours === '') return null;
      if (typeof b.hours !== 'number' || !(b.hours >= 0) || b.hours > 1000)
        throw new ValidationError('hours must be a number');
      return b.hours;
    })(),
    note: str(b.note, 'note', { max: 1000 }),
  }),
  expertise: (b) => ({
    person_id: id(b.person_id, 'person_id'),
    type: str(b.type, 'type', { required: true, max: 80 }),
    note: str(b.note, 'note', { max: 300 }),
  }),
  outreach: (b) => {
    const goal = oneOf(b.goal, 'goal', OUTREACH_GOALS);
    const slotAsk = goal === 'staff_slot';
    const slot = str(b.slot, 'slot', { max: 120, required: slotAsk });
    const venueId = str(b.venue_id, 'venue_id', { max: 120, required: slotAsk });
    const planDate = partialDate(b.plan_date, 'plan_date');
    return {
      person_id: id(b.person_id, 'person_id'),
      goal,
      status: oneOf(b.status ?? 'suggested', 'status', OUTREACH_STATUSES),
      contacted_on: partialDate(b.contacted_on, 'contacted_on'),
      snooze_until: partialDate(b.snooze_until, 'snooze_until'),
      note: str(b.note, 'note', { max: 1000 }),
      // Only the staffing ask has a slot, a venue, and a planned date.
      ...(slotAsk || 'slot' in b ? { slot } : {}),
      ...(slotAsk || 'venue_id' in b ? { venue_id: venueId } : {}),
      ...(slotAsk || 'plan_date' in b ? { plan_date: planDate } : {}),
    };
  },
  // Money. The Function lets only the finance level touch this resource.
  donation: (b) => ({
    person_id: optionalId(b.person_id, 'person_id'),
    source: str(b.source, 'source', { max: 60 }) ?? 'manual',
    source_ref: str(b.source_ref, 'source_ref', { max: 120 }) ?? `manual-${crypto.randomUUID()}`,
    line_ref: str(b.line_ref, 'line_ref', { max: 120 }) ?? '',
    amount_cents: (() => {
      if (!Number.isInteger(b.amount_cents) || b.amount_cents < 1 || b.amount_cents > 100_000_000) {
        throw new ValidationError('amount_cents must be a whole number of cents above zero');
      }
      return b.amount_cents;
    })(),
    donated_at: (() => {
      const t = str(b.donated_at, 'donated_at', { required: true, max: 10 });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new ValidationError('donated_at must be a date like 2026-05-23');
      return t;
    })(),
    campaign: str(b.campaign, 'campaign', { max: 200 }),
    kind: str(b.kind, 'kind', { max: 40 }) ?? 'gift',
    recurring: flag(b.recurring, 'recurring'),
    event_id: optionalId(b.event_id, 'event_id'),
  }),
};

// Table name and column list come from this allowlist, never from the request.
const TABLES = {
  person: ['name', 'email', 'leader_slug', 'status', 'mentor', 'notes'],
  activity: ['name', 'scope', 'type', 'subtype', 'site_activity_id'],
  event: ['name', 'event_type', 'year', 'site_event_id', 'start_date', 'end_date', 'site_id'],
  role: ['person_id', 'activity_id', 'event_id', 'leadership_type', 'how_it_went', 'source'],
  journey_note: ['person_id', 'kind', 'focus', 'body', 'author'],
  expertise: ['person_id', 'type', 'note'],
  service: ['person_id', 'body', 'title', 'started_on', 'ended_on', 'note', 'source'],
  volunteer: ['person_id', 'event_id', 'task', 'hours', 'note'],
  outreach: [
    'person_id',
    'goal',
    'status',
    'contacted_on',
    'snooze_until',
    'note',
    'event_id',
    'slot',
    'venue_id',
    'plan_date',
  ],
  donation: [
    'person_id',
    'source',
    'source_ref',
    'line_ref',
    'amount_cents',
    'donated_at',
    'campaign',
    'kind',
    'recurring',
    'event_id',
  ],
};

// Everything but notes (which have `author`) records who created and last changed a row.
const isAudited = (table) => table !== 'journey_note';

export const tableFor = (resource) => (resource === 'note' ? 'journey_note' : resource);

export async function bootstrap(db) {
  const live = (t) =>
    db
      .prepare(
        `SELECT * FROM ${t} WHERE deleted_at IS NULL${t === 'person' ? ' AND erased_at IS NULL' : ''} ORDER BY id`
      )
      .all();
  const [people, activities, events, roles, notes, service, volunteers, outreach, types, places, venues, expertise] =
    await Promise.all([
      live('person'),
      live('activity'),
      live('event'),
      live('role'),
      live('journey_note'),
      live('service'),
      live('volunteer'),
      live('outreach'),
      db.prepare('SELECT name FROM activity_type ORDER BY name').all(),
      // City and state, and the postal code's center point rounded to about a kilometer. No street, no code.
      db
        .prepare('SELECT person_id, city, state, ROUND(lat, 2) AS lat, ROUND(lng, 2) AS lng FROM person_location')
        .all(),
      db.prepare('SELECT id, name, city, state, address, lat, lng FROM venue ORDER BY name').all(),
      live('expertise'),
    ]);
  return {
    people: people.results,
    activities: activities.results,
    events: events.results,
    roles: roles.results,
    notes: notes.results,
    service: service.results,
    volunteers: volunteers.results,
    outreach: outreach.results,
    activityTypes: types.results.map((r) => r.name),
    locations: places.results,
    venues: venues.results,
    expertise: expertise.results,
  };
}

export async function createRow(db, resource, values, author) {
  const table = tableFor(resource);
  const audited = isAudited(table);
  const cols = audited ? [...TABLES[table], 'created_by', 'updated_by'] : TABLES[table];
  const data = audited ? { ...values, created_by: author, updated_by: author } : { ...values, author };
  if (table === 'activity') await ensureType(db, data.type);
  const res = await db
    .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .bind(...cols.map((c) => data[c] ?? null))
    .run();
  return res.meta.last_row_id;
}

export async function updateRow(db, resource, rowId, values, author) {
  const table = tableFor(resource);
  if (table === 'journey_note') {
    // Notes are append-only history except for editing the text and focus.
    values = { focus: values.focus, body: values.body };
  }
  const cols = Object.keys(values).filter((c) => TABLES[table].includes(c));
  if (!cols.length) throw new ValidationError('nothing to update');
  const audited = isAudited(table);
  if (table === 'activity' && values.type) await ensureType(db, values.type);
  const res = await db
    .prepare(
      `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')}${audited ? ', updated_by = ?' : ''}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND deleted_at IS NULL`
    )
    .bind(...cols.map((c) => values[c] ?? null), ...(audited ? [author ?? null] : []), rowId)
    .run();
  return res.meta.changes > 0;
}

// Which role column points at each deletable thing. Notes and roles stand alone.
const ROLE_COLUMN = { person: 'person_id', activity: 'activity_id', event: 'event_id' };

/** Same name (ignoring case) already live. Events also match on year, activities on scope. */
export async function findDuplicate(db, resource, values, exceptId = 0) {
  if (resource === 'expertise') {
    const { results } = await db
      .prepare('SELECT id FROM expertise WHERE deleted_at IS NULL AND person_id = ? AND type = ? AND id != ?')
      .bind(values.person_id, values.type, exceptId)
      .all();
    return results.length > 0;
  }
  if (resource === 'outreach') {
    // One live ask per person, event, and slot.
    if (values.goal !== 'staff_slot') return false;
    const { results } = await db
      .prepare(
        "SELECT id FROM outreach WHERE deleted_at IS NULL AND goal = 'staff_slot' AND person_id = ? AND venue_id = ? AND slot = ? AND COALESCE(plan_date, '') = ? AND id != ?"
      )
      .bind(values.person_id, values.venue_id, values.slot, values.plan_date ?? '', exceptId)
      .all();
    return results.length > 0;
  }
  const extra = { activity: 'scope', event: 'year' }[resource];
  if (!extra) return false;
  const table = tableFor(resource);
  const { results } = await db
    .prepare(`SELECT id FROM ${table} WHERE deleted_at IS NULL AND lower(name) = lower(?) AND ${extra} = ? AND id != ?`)
    .bind(values.name, values[extra], exceptId)
    .all();
  return results.length > 0;
}

export async function softDelete(db, resource, rowId, author) {
  const table = tableFor(resource);
  const column = ROLE_COLUMN[resource];
  if (column) {
    const { results } = await db
      .prepare(`SELECT id FROM role WHERE deleted_at IS NULL AND ${column} = ?`)
      .bind(rowId)
      .all();
    if (results.length) {
      const n = results.length;
      throw new ValidationError(
        `It still has ${n} ${n === 1 ? 'role' : 'roles'}. Remove ${n === 1 ? 'it' : 'them'} first.`
      );
    }
  }
  const res = await db
    .prepare(
      `UPDATE ${table} SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')${isAudited(table) ? ', updated_by = ?' : ''} WHERE id = ? AND deleted_at IS NULL`
    )
    .bind(...(isAudited(table) ? [author ?? null] : []), rowId)
    .run();
  return res.meta.changes > 0;
}

async function ensureType(db, type) {
  await db.prepare('INSERT OR IGNORE INTO activity_type (name) VALUES (?)').bind(type).run();
}

/** Bulk-add roles for one event. Existing live person+activity+event rows are skipped. */
export async function bulkAddRoles(db, rows, author) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 200) {
    throw new ValidationError('send between 1 and 200 roles');
  }
  const clean = rows.map((r) => validators.role(r));
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO role (person_id, activity_id, event_id, leadership_type, how_it_went, source, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const results = await db.batch(
    clean.map((r) =>
      stmt.bind(r.person_id, r.activity_id, r.event_id, r.leadership_type, r.how_it_went, r.source, author, author)
    )
  );
  return results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
}

/** Adds the same task at one event for several people. Neither is money, so any level may do it. */
export async function bulkAddVolunteers(db, rows, author) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 200) {
    throw new ValidationError('send between 1 and 200 volunteers');
  }
  const clean = rows.map((r) => validators.volunteer(r));
  const stmt = db.prepare(
    'INSERT INTO volunteer (person_id, event_id, task, hours, note, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const results = await db.batch(
    clean.map((r) => stmt.bind(r.person_id, r.event_id, r.task, r.hours, r.note, author, author))
  );
  return results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
}

export async function exportAll(db) {
  const data = await bootstrap(db);
  return { exportedAt: new Date().toISOString(), ...data };
}
