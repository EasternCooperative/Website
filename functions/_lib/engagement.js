// Engagement reads: who has done what, the person timeline, and erasing a person.
//
// MONEY RULE. Amounts, totals, and per-gift figures exist in `donation` and the
// `person_giving` view. This module reads them ONLY on the finance branch of a
// function that is passed `level === 'finance'`. Everyone else reads
// `person_engagement`, which exposes a giving tier and nothing numeric about money.
// The contract test in src/__tests__/engagement-contract.test.ts runs every read as a
// standard user against real SQLite and fails if a figure appears.

import { ValidationError } from './leadership.js';
import { audit } from './roles.js';

const isFinance = (user) => user.level === 'finance';

// What each level may sort by. Sorting by a figure would leak its ordering, so
// standard users get the tier rank, never the amount.
const SORTS = {
  name: 'e.name COLLATE NOCASE',
  events_registered: 'e.events_registered',
  events_attended: 'e.events_attended',
  last_event_year: 'e.last_event_year',
  roles_led: 'e.roles_led',
  last_led_year: 'e.last_led_year',
  volunteer_count: 'e.volunteer_count',
  giving_tier: 'e.giving_tier_rank',
  last_contacted_on: 'e.last_contacted_on',
};
const FINANCE_SORTS = {
  giving_total: 'g.total_cents',
  last_gift: 'g.last_gift_at',
};

export async function givingTiers(db) {
  const { results } = await db.prepare('SELECT rank, name, min_cents FROM giving_tier ORDER BY rank').all();
  return results;
}

const int = (v, fallback, { min = 0, max = 1000 } = {}) => {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError('a number in the request is out of range');
  return n;
};

/**
 * People with their engagement facts, paged. `params` is a URLSearchParams.
 * Standard users get a giving tier. Finance users also get totals and gift dates.
 */
export async function listEngagement(db, user, params) {
  const finance = isFinance(user);
  const sorts = finance ? { ...SORTS, ...FINANCE_SORTS } : SORTS;
  const sortName = params.get('sort') ?? 'name';
  if (!(sortName in sorts)) {
    throw new ValidationError(
      sortName in FINANCE_SORTS
        ? 'Only the finance level can sort by amount.'
        : `sort must be one of: ${Object.keys(sorts).join(', ')}`
    );
  }
  if (!finance && params.has('min_giving_cents'))
    throw new ValidationError('Only the finance level can filter by amount.');

  const where = [];
  const bind = [];
  const q = params.get('q')?.trim();
  if (q) {
    where.push("e.name LIKE ? ESCAPE '\\'");
    bind.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
  }
  const minTier = int(params.get('min_tier'), null, { max: 20 });
  if (minTier !== null) {
    where.push('e.giving_tier_rank >= ?');
    bind.push(minTier);
  }
  if (params.get('member') === '1') where.push('e.member_now = 1');
  if (params.get('exclude_do_not_contact') === '1') where.push('e.do_not_contact = 0');

  // Criteria the invite lists use. Every one is a count, a year, or a flag: none is money.
  const num = (name, column, op) => {
    const v = int(params.get(name), null, { max: 3000 });
    if (v !== null) {
      where.push(`e.${column} ${op} ?`);
      bind.push(v);
    }
  };
  num('min_events', 'events_registered', '>=');
  num('min_attended', 'events_attended', '>=');
  num('min_roles_led', 'roles_led', '>=');
  num('max_roles_led', 'roles_led', '<=');
  num('min_volunteer', 'volunteer_count', '>=');
  num('min_last_event_year', 'last_event_year', '>=');
  num('max_last_event_year', 'last_event_year', '<=');
  num('min_last_led_year', 'last_led_year', '>=');
  num('min_gift_count', 'gift_count', '>=');
  num('max_gift_count', 'gift_count', '<=');
  // Gift recency is a year, never an amount, so any level may filter on it.
  const lastGift =
    '(SELECT MAX(CAST(substr(d.donated_at, 1, 4) AS INTEGER)) FROM donation d WHERE d.person_id = e.person_id AND d.deleted_at IS NULL)';
  for (const [name, op] of [
    ['min_last_gift_year', '>='],
    ['max_last_gift_year', '<='],
  ]) {
    const v = int(params.get(name), null, { max: 3000 });
    if (v !== null) {
      where.push(`${lastGift} ${op} ?`);
      bind.push(v);
    }
  }
  if (params.get('serving') === '1') where.push('e.serving_now > 0');
  if (params.get('serving') === '0') where.push('e.serving_now = 0');
  if (params.get('has_ready') === '1') {
    where.push(
      "EXISTS (SELECT 1 FROM journey_note n WHERE n.person_id = e.person_id AND n.kind = 'ready' AND n.deleted_at IS NULL)"
    );
  }
  // Leave out anyone contacted since a date, and anyone snoozed past today, so a list does not keep suggesting them.
  const since = params.get('not_contacted_since');
  if (since) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(since))
      throw new ValidationError('not_contacted_since must be a date like 2026-05-01');
    where.push('(e.last_contacted_on IS NULL OR e.last_contacted_on < ?)');
    bind.push(since);
  }
  if (params.get('exclude_snoozed') === '1') {
    where.push(
      "NOT EXISTS (SELECT 1 FROM outreach o WHERE o.person_id = e.person_id AND o.status = 'snoozed' AND o.deleted_at IS NULL AND o.snooze_until >= date('now'))"
    );
  }
  const minCents = int(params.get('min_giving_cents'), null, { max: 100_000_000 });
  if (minCents !== null) {
    where.push('g.total_cents >= ?');
    bind.push(minCents);
  }

  const dir = params.get('dir') === 'desc' ? 'DESC' : 'ASC';
  const limit = int(params.get('limit'), 50, { min: 1, max: 100 });
  const offset = int(params.get('offset'), 0, { max: 100_000 });
  const join = finance ? 'LEFT JOIN person_giving g ON g.person_id = e.person_id' : '';
  const money = finance ? ', g.total_cents, g.first_gift_at, g.last_gift_at' : '';
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { results } = await db
    .prepare(
      `SELECT e.*${money} FROM person_engagement e ${join} ${clause}
       ORDER BY ${sorts[sortName]} ${dir}, e.name COLLATE NOCASE ASC, e.person_id ASC LIMIT ? OFFSET ?`
    )
    .bind(...bind, limit, offset)
    .all();
  const count = await db
    .prepare(`SELECT COUNT(*) AS n FROM person_engagement e ${join} ${clause}`)
    .bind(...bind)
    .all();

  const tiers = new Map((await givingTiers(db)).map((t) => [t.rank, t.name]));
  const people = results.map((r) => ({ ...r, giving_tier: tiers.get(r.giving_tier_rank) ?? null }));
  return { people, total: count.results[0].n, limit, offset };
}

// A sortable instant for an item that may only know its year.
const sortKey = (at) => (at && at.length === 4 ? `${at}-07-01` : (at ?? ''));

/** One person's history across every record type, newest first. */
export async function timeline(db, user, personId) {
  const finance = isFinance(user);
  const person = (
    await db
      .prepare('SELECT id, name FROM person WHERE id = ? AND deleted_at IS NULL AND erased_at IS NULL')
      .bind(personId)
      .all()
  ).results[0];
  if (!person) return null;

  const q = (sql) =>
    db
      .prepare(sql)
      .bind(personId)
      .all()
      .then((r) => r.results);
  const [roles, regs, vols, serv, mem, outr, notes] = await Promise.all([
    q(`SELECT l.id, l.leadership_type, l.how_it_went, a.name AS activity, a.type, e.name AS event, e.year
         FROM role l JOIN activity a ON a.id = l.activity_id JOIN event e ON e.id = l.event_id
        WHERE l.person_id = ? AND l.deleted_at IS NULL`),
    q(`SELECT r.id, r.status, r.attended, r.registered_at, e.name AS event, e.year
         FROM registration r JOIN event e ON e.id = r.event_id
        WHERE r.person_id = ? AND r.deleted_at IS NULL`),
    q(`SELECT v.id, v.task, v.hours, v.note, e.name AS event, e.year
         FROM volunteer v LEFT JOIN event e ON e.id = v.event_id
        WHERE v.person_id = ? AND v.deleted_at IS NULL`),
    q(`SELECT id, body, title, started_on, ended_on, note FROM service WHERE person_id = ? AND deleted_at IS NULL`),
    q(`SELECT id, kind, starts_on, ends_on FROM membership WHERE person_id = ? AND deleted_at IS NULL`),
    q(
      `SELECT id, goal, status, contacted_on, snooze_until, note, created_at FROM outreach WHERE person_id = ? AND deleted_at IS NULL`
    ),
    q(`SELECT id, kind, focus, body, author, created_at FROM journey_note WHERE person_id = ? AND deleted_at IS NULL`),
  ]);

  const items = [
    ...roles.map((r) => ({
      type: 'role',
      id: r.id,
      at: String(r.year),
      title: r.activity,
      leadership_type: r.leadership_type,
      event: r.event,
      detail: `${r.leadership_type}, ${r.event}`,
      note: r.how_it_went,
    })),
    ...regs.map((r) => ({
      type: 'registration',
      id: r.id,
      at: r.registered_at ?? String(r.year),
      title: r.event,
      event: r.event,
      detail: r.status,
      attended: r.attended,
    })),
    ...vols.map((v) => ({
      type: 'volunteer',
      id: v.id,
      at: v.year ? String(v.year) : '',
      title: v.task,
      event: v.event,
      detail: v.event,
      hours: v.hours,
      note: v.note,
    })),
    ...serv.map((s) => ({
      type: 'service',
      id: s.id,
      at: s.started_on ?? s.ended_on ?? '',
      title: s.body,
      detail: s.title,
      started_on: s.started_on,
      ended_on: s.ended_on,
      note: s.note,
    })),
    ...mem.map((m) => ({
      type: 'membership',
      id: m.id,
      at: m.starts_on ?? m.ends_on ?? '',
      title: m.kind,
      ends_on: m.ends_on,
    })),
    ...outr.map((o) => ({
      type: 'outreach',
      id: o.id,
      at: o.contacted_on ?? o.created_at,
      title: o.goal,
      detail: o.status,
      snooze_until: o.snooze_until,
      note: o.note,
    })),
    ...notes.map((n) => ({
      type: 'note',
      id: n.id,
      at: n.created_at,
      title: n.kind,
      detail: n.focus,
      body: n.body,
      author: n.author,
    })),
  ];

  // Gifts. Finance sees each one with its amount. Everyone else sees that a gift
  // happened and the person's overall tier, never a figure.
  let giving;
  if (finance) {
    const gifts = await q(
      'SELECT id, donated_at, amount_cents, campaign, kind, recurring FROM donation WHERE person_id = ? AND deleted_at IS NULL'
    );
    items.push(
      ...gifts.map((g) => ({
        type: 'gift',
        id: g.id,
        at: g.donated_at,
        title: g.campaign ?? g.kind,
        amount_cents: g.amount_cents,
        recurring: g.recurring,
      }))
    );
    const total = (await db.prepare('SELECT total_cents FROM person_giving WHERE person_id = ?').bind(personId).all())
      .results[0];
    giving = { total_cents: total?.total_cents ?? 0 };
  } else {
    const gifts = await q('SELECT id, donated_at FROM donation WHERE person_id = ? AND deleted_at IS NULL');
    items.push(...gifts.map((g) => ({ type: 'gift', id: g.id, at: g.donated_at, title: 'Gift' })));
    const rank =
      (await db.prepare('SELECT giving_tier_rank AS r FROM person_engagement WHERE person_id = ?').bind(personId).all())
        .results[0]?.r ?? 0;
    const tier = (await givingTiers(db)).find((t) => t.rank === rank);
    giving = { tier: tier?.name ?? null };
  }

  items.sort((a, b) => sortKey(b.at).localeCompare(sortKey(a.at)) || a.type.localeCompare(b.type) || b.id - a.id);
  return { person, giving, items };
}

/**
 * Erase a person: clear everything that identifies them, keep the row so ids and
 * counts stay whole. Runs as one batch. D1 Time Travel keeps a 7-day copy of the
 * database as it was, so the privacy notice must say erasure completes within a week.
 */
export async function erasePerson(db, personId, actor) {
  const person = (
    await db
      .prepare('SELECT id FROM person WHERE id = ? AND deleted_at IS NULL AND erased_at IS NULL')
      .bind(personId)
      .all()
  ).results[0];
  if (!person) return false;
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  const run = (sql, ...args) => db.prepare(sql).bind(...args);
  await db.batch([
    run(
      `UPDATE person SET name = 'Removed person', email = NULL, leader_slug = NULL, notes = NULL, status = 'inactive',
         mentor = 0, erased_at = ${now}, updated_at = ${now}, updated_by = ? WHERE id = ?`,
      actor,
      personId
    ),
    run('DELETE FROM person_email WHERE person_id = ?', personId),
    run('DELETE FROM person_alias WHERE person_id = ?', personId),
    run(
      `UPDATE journey_note SET body = '[removed]', focus = NULL, deleted_at = ${now}, updated_at = ${now} WHERE person_id = ?`,
      personId
    ),
    run(`UPDATE role SET how_it_went = NULL, updated_at = ${now}, updated_by = ? WHERE person_id = ?`, actor, personId),
    run(`UPDATE outreach SET note = NULL, updated_at = ${now}, updated_by = ? WHERE person_id = ?`, actor, personId),
    run(`UPDATE volunteer SET note = NULL, updated_at = ${now}, updated_by = ? WHERE person_id = ?`, actor, personId),
    run(`UPDATE service SET note = NULL, updated_at = ${now}, updated_by = ? WHERE person_id = ?`, actor, personId),
    run(
      `UPDATE membership SET source_ref = NULL, updated_at = ${now}, updated_by = ? WHERE person_id = ?`,
      actor,
      personId
    ),
  ]);
  // The audit row names the id, never the person.
  await audit(db, actor, 'person.erase', String(personId));
  return true;
}

// ---------------------------------------------------------------------------
// Merging two records of the same person.

const normName = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’,]/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Tables whose rows simply move to the surviving person.
const MOVES = ['registration', 'donation', 'membership', 'volunteer', 'service', 'outreach', 'journey_note', 'role'];
// When both records have a status, the stronger one survives.
const STATUS_ORDER = ['active', 'hiatus', 'inactive'];

const livePerson = async (db, id) =>
  (
    await db
      .prepare(
        'SELECT id, name, email, leader_slug, status, mentor FROM person WHERE id = ? AND deleted_at IS NULL AND erased_at IS NULL'
      )
      .bind(id)
      .all()
  ).results[0] ?? null;

/** What a merge would move, as counts. Counts only, never amounts, so every level may see it. */
export async function mergePreview(db, fromId, intoId) {
  if (fromId === intoId) throw new ValidationError('choose two different people');
  const [from, into] = await Promise.all([livePerson(db, fromId), livePerson(db, intoId)]);
  if (!from || !into) return null;
  const counts = {};
  for (const table of MOVES) {
    const r = await db
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE person_id = ? AND deleted_at IS NULL`)
      .bind(fromId)
      .all();
    counts[table] = r.results[0].n;
  }
  const emails = await db
    .prepare('SELECT COUNT(*) AS n FROM person_email WHERE person_id = ? AND deleted_at IS NULL')
    .bind(fromId)
    .all();
  counts.email = emails.results[0].n;
  return { from: { id: from.id, name: from.name }, into: { id: into.id, name: into.name }, counts };
}

/**
 * Fold `fromId` into `intoId`. Everything the duplicate has moves to the survivor, the
 * duplicate is soft-deleted, its name becomes an alias so future imports still match,
 * and an append-only person_merge row records it. One batch, so it is all or nothing.
 */
export async function mergePeople(db, fromId, intoId, actor) {
  const preview = await mergePreview(db, fromId, intoId);
  if (!preview) return null;
  const [from, into] = await Promise.all([livePerson(db, fromId), livePerson(db, intoId)]);
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  const run = (sql, ...args) => db.prepare(sql).bind(...args);
  const status = STATUS_ORDER.find((s) => s === from.status || s === into.status) ?? into.status;
  const takeSlug = !into.leader_slug && from.leader_slug;

  const statements = [
    // Emails and aliases: drop what the survivor already has, move the rest.
    run(
      `DELETE FROM person_email WHERE person_id = ? AND email_lower IN
         (SELECT email_lower FROM person_email WHERE person_id = ? AND deleted_at IS NULL)`,
      fromId,
      intoId
    ),
    run(
      `UPDATE person_email SET person_id = ?, is_primary = 0, updated_at = ${now} WHERE person_id = ?`,
      intoId,
      fromId
    ),
    run(
      `DELETE FROM person_alias WHERE person_id = ? AND alias_norm IN
         (SELECT alias_norm FROM person_alias WHERE person_id = ? AND deleted_at IS NULL)`,
      fromId,
      intoId
    ),
    run(`UPDATE person_alias SET person_id = ?, updated_at = ${now} WHERE person_id = ?`, intoId, fromId),
    run(
      `INSERT INTO person_alias (person_id, alias_norm, kind, created_by, updated_by)
         SELECT ?, ?, 'merged', ?, ? WHERE ? != ? AND NOT EXISTS
           (SELECT 1 FROM person_alias WHERE person_id = ? AND alias_norm = ? AND deleted_at IS NULL)`,
      intoId,
      normName(from.name),
      actor,
      actor,
      normName(from.name),
      normName(into.name),
      intoId,
      normName(from.name)
    ),
    // A role the survivor already has for the same activity and event would break the
    // one-live-role rule, so the duplicate's copy is retired instead of moved.
    run(
      `UPDATE role SET deleted_at = ${now}, updated_at = ${now}, updated_by = ?
         WHERE person_id = ? AND deleted_at IS NULL AND EXISTS
           (SELECT 1 FROM role k WHERE k.person_id = ? AND k.activity_id = role.activity_id
              AND k.event_id = role.event_id AND k.deleted_at IS NULL)`,
      actor,
      fromId,
      intoId
    ),
    // Identical membership years are the same fact twice.
    run(
      `UPDATE membership SET deleted_at = ${now}, updated_at = ${now}, updated_by = ?
         WHERE person_id = ? AND deleted_at IS NULL AND EXISTS
           (SELECT 1 FROM membership k WHERE k.person_id = ? AND k.deleted_at IS NULL AND k.kind = membership.kind
              AND COALESCE(k.starts_on, '') = COALESCE(membership.starts_on, '')
              AND COALESCE(k.ends_on, '') = COALESCE(membership.ends_on, ''))`,
      actor,
      fromId,
      intoId
    ),
  ];
  for (const table of MOVES) {
    const audited = table !== 'journey_note';
    statements.push(
      run(
        `UPDATE ${table} SET person_id = ?, updated_at = ${now}${audited ? ', updated_by = ?' : ''} WHERE person_id = ?`,
        ...(audited ? [intoId, actor, fromId] : [intoId, fromId])
      )
    );
  }
  statements.push(
    // The duplicate gives up its link and address first, so the survivor can take them.
    run(
      `UPDATE person SET email = NULL, leader_slug = NULL, deleted_at = ${now}, updated_at = ${now}, updated_by = ? WHERE id = ?`,
      actor,
      fromId
    ),
    run(
      `UPDATE person SET status = ?, mentor = MAX(mentor, ?), email = COALESCE(email, ?),
         leader_slug = COALESCE(leader_slug, ?), updated_at = ${now}, updated_by = ? WHERE id = ?`,
      status,
      from.mentor ? 1 : 0,
      from.email,
      takeSlug ? from.leader_slug : null,
      actor,
      intoId
    ),
    run(
      'INSERT INTO person_merge (from_person_id, into_person_id, summary, merged_by) VALUES (?, ?, ?, ?)',
      fromId,
      intoId,
      JSON.stringify(preview.counts),
      actor
    )
  );
  await db.batch(statements);
  await audit(db, actor, 'person.merge', `${fromId}->${intoId}`);
  return { into: intoId, moved: preview.counts };
}

/** Pairs of live people who may be one person: a shared address, or compatible names. */
export async function possibleDuplicates(db, limit = 50) {
  const people = (await db.prepare('SELECT id, name FROM person WHERE deleted_at IS NULL AND erased_at IS NULL').all())
    .results;
  const emails = (
    await db
      .prepare(
        `SELECT person_id, email_lower FROM person_email WHERE deleted_at IS NULL AND shared = 0
         UNION SELECT id, lower(email) FROM person WHERE email IS NOT NULL AND deleted_at IS NULL`
      )
      .all()
  ).results;
  const byEmail = new Map();
  for (const e of emails) byEmail.set(e.email_lower, [...(byEmail.get(e.email_lower) ?? new Set()), e.person_id]);
  const pairs = new Map();
  const add = (a, b, why) => {
    if (a === b) return;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const hit = pairs.get(key) ?? { a: Math.min(a, b), b: Math.max(a, b), reasons: [] };
    if (!hit.reasons.includes(why)) hit.reasons.push(why);
    pairs.set(key, hit);
  };
  for (const ids of byEmail.values()) {
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i++)
      for (let j = i + 1; j < unique.length; j++) add(unique[i], unique[j], 'same email');
  }
  const parts = people.map((p) => {
    const w = normName(p.name).split(' ');
    return { id: p.id, first: w[0] ?? '', last: w.length > 1 ? w[w.length - 1] : '' };
  });
  const byLast = new Map();
  for (const p of parts) if (p.last) byLast.set(p.last, [...(byLast.get(p.last) ?? []), p]);
  for (const group of byLast.values()) {
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const [x, y] = [group[i].first, group[j].first];
        const close =
          x === y || (Math.min(x.length, y.length) >= 3 && x.startsWith(y.slice(0, 3)) && y.startsWith(x.slice(0, 3)));
        if (close) add(group[i].id, group[j].id, 'similar name');
      }
  }
  const name = new Map(people.map((p) => [p.id, p.name]));
  return [...pairs.values()]
    .sort((p, q) => q.reasons.length - p.reasons.length || p.a - q.a)
    .slice(0, limit)
    .map((p) => ({ a: { id: p.a, name: name.get(p.a) }, b: { id: p.b, name: name.get(p.b) }, reasons: p.reasons }));
}
