// The engagement journey: where each person stands (derived from records) and what we
// plan to do next (set by hand). Counts and years only. Nothing here reads money.

import { ValidationError } from './leadership.js';
import { audit } from './roles.js';

export const STAGES = ['supporter', 'attendee', 'volunteer', 'activity', 'class'];
export const TARGETS = ['activity', 'class', 'committee', 'board'];

// A person's highest stage, from the records.
const STAGE_SQL = `CASE WHEN classes_led > 0 THEN 'class' WHEN activities_led > 0 THEN 'activity'
  WHEN first_volunteer_year IS NOT NULL THEN 'volunteer' WHEN events_registered > 0 THEN 'attendee'
  WHEN supporter = 1 THEN 'supporter' END`;
const RANK_SQL = `CASE stage WHEN 'class' THEN 5 WHEN 'activity' THEN 4 WHEN 'volunteer' THEN 3 WHEN 'attendee' THEN 2 WHEN 'supporter' THEN 1 ELSE 0 END`;
const BASE = `WITH j AS (SELECT *, ${STAGE_SQL} AS stage FROM person_journey)
  SELECT j.*, ${RANK_SQL.replaceAll('stage', 'j.stage')} AS stage_rank, pl.target, pl.next_step, pl.due_on, pl.owner
  FROM j LEFT JOIN journey_plan pl ON pl.person_id = j.person_id AND pl.deleted_at IS NULL`;

const int = (v, fallback, max = 1000) => {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new ValidationError('a number in the request is out of range');
  return n;
};

function filters(params, actor) {
  const where = [];
  const bind = [];
  const q = params.get('q')?.trim();
  if (q) {
    where.push("x.name LIKE ? ESCAPE '\\'");
    bind.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
  }
  if (params.get('mine') === '1') {
    where.push('lower(x.owner) = ?');
    bind.push(String(actor).toLowerCase());
  }
  if (params.get('overdue') === '1') where.push("x.due_on IS NOT NULL AND x.due_on < date('now')");
  if (params.get('has_target') === '1') where.push('x.target IS NOT NULL');
  if (params.get('exclude_do_not_contact') === '1') where.push('x.do_not_contact = 0');
  const stalled = int(params.get('stalled_years'), null, 100);
  if (stalled !== null) {
    where.push('(x.last_active_year IS NULL OR x.last_active_year <= ?)');
    bind.push(new Date().getUTCFullYear() - stalled);
  }
  return { where, bind };
}

const ORDER = `ORDER BY (x.due_on IS NULL), x.due_on, x.last_active_year DESC, x.name COLLATE NOCASE, x.person_id`;
const COLUMN_SIZE = 12;

const page = async (db, stage, params, actor, limit, offset) => {
  const { where, bind } = filters(params, actor);
  const lane = stage === 'serving' ? 'x.serving_now > 0' : 'x.stage = ?';
  const all = [lane, ...where].join(' AND ');
  const binds = stage === 'serving' ? bind : [stage, ...bind];
  const rows = await db
    .prepare(`SELECT x.* FROM (${BASE}) x WHERE ${all} ${ORDER} LIMIT ? OFFSET ?`)
    .bind(...binds, limit, offset)
    .all();
  const count = await db
    .prepare(`SELECT COUNT(*) AS n FROM (${BASE}) x WHERE ${all}`)
    .bind(...binds)
    .all();
  return { people: rows.results, total: count.results[0].n, limit, offset };
};

/**
 * Everyone on the board as a compact row, for the marble funnel. The columns are paged, so
 * they cannot feed a picture of the whole membership. Same filters as the board. People with
 * no stage and no service are left out, as they are from every column.
 */
export async function journeyMarbles(db, params, actor) {
  const { where, bind } = filters(params, actor);
  const all = ['(x.stage IS NOT NULL OR x.serving_now > 0)', ...where].join(' AND ');
  const rows = await db
    .prepare(
      `SELECT x.person_id, x.name, x.stage, x.serving_now, x.on_board_now, x.last_active_year, x.do_not_contact
       FROM (${BASE}) x WHERE ${all} ORDER BY x.person_id`
    )
    .bind(...bind)
    .all();
  return { people: rows.results };
}

/**
 * The whole board in one call: how many people have reached each stage (and how many
 * reached it in `year`), then the first few people in each column. With `stage=<name>`,
 * one column's next page instead.
 */
export async function journeyBoard(db, params, actor) {
  const stage = params.get('stage');
  if (stage) {
    if (!STAGES.includes(stage) && stage !== 'serving') throw new ValidationError('stage is not a stage');
    return page(
      db,
      stage,
      params,
      actor,
      int(params.get('limit'), COLUMN_SIZE, 100),
      int(params.get('offset'), 0, 100_000)
    );
  }
  const thisYear = new Date().getUTCFullYear();
  const year = int(params.get('year'), null, 3000);
  const reached = (
    await db
      .prepare(
        `SELECT
           SUM(stage_rank >= 1) AS supporter, SUM(stage_rank >= 2) AS attendee, SUM(stage_rank >= 3) AS volunteer,
           SUM(stage_rank >= 4) AS activity, SUM(stage_rank >= 5) AS class,
           SUM(serving_now > 0) AS serving_now, SUM(service_terms > 0) AS served_ever,
           SUM(first_attended_year = ?1) AS attendee_new, SUM(first_volunteer_year = ?1) AS volunteer_new,
           SUM(first_activity_year = ?1) AS activity_new, SUM(first_class_year = ?1) AS class_new,
           SUM(first_service_year = ?1) AS serving_new
         FROM (${BASE}) x`
      )
      .bind(year ?? -1)
      .all()
  ).results[0];
  const funnel = Object.fromEntries(Object.entries(reached).map(([k, v]) => [k, v ?? 0]));
  const columns = {};
  for (const s of [...STAGES, 'serving']) columns[s] = await page(db, s, params, actor, COLUMN_SIZE, 0);
  return { funnel, year, thisYear, columns };
}

/** One person's stage, the year each was reached, and their plan. Null if they do not exist. */
export async function journeyOne(db, personId) {
  const row = (await db.prepare(`SELECT x.* FROM (${BASE}) x WHERE x.person_id = ?`).bind(personId).all()).results[0];
  return row ?? null;
}

const plain = (v, field, max) => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw new ValidationError(`${field} must be text`);
  const t = v.trim();
  if (t.length > max) throw new ValidationError(`${field} is too long`);
  return t || null;
};

export function validatePlan(b) {
  const target = plain(b.target, 'target', 20);
  if (target !== null && !TARGETS.includes(target))
    throw new ValidationError(`target must be one of: ${TARGETS.join(', ')}`);
  const due = plain(b.due_on, 'due_on', 10);
  if (due !== null && !/^\d{4}-\d{2}-\d{2}$/.test(due))
    throw new ValidationError('due_on must be a date like 2026-12-31');
  return {
    target,
    next_step: plain(b.next_step, 'next_step', 300),
    due_on: due,
    owner: plain(b.owner, 'owner', 200)?.toLowerCase() ?? null,
  };
}

/** Sets a person's plan, adding it or replacing it. Returns false when the person does not exist. */
export async function savePlan(db, personId, values, actor) {
  const person = (
    await db
      .prepare('SELECT id FROM person WHERE id = ? AND deleted_at IS NULL AND erased_at IS NULL')
      .bind(personId)
      .all()
  ).results[0];
  if (!person) return false;
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  await db.batch([
    db
      .prepare(
        `UPDATE journey_plan SET target = ?, next_step = ?, due_on = ?, owner = ?, updated_at = ${now}, updated_by = ?
         WHERE person_id = ? AND deleted_at IS NULL`
      )
      .bind(values.target, values.next_step, values.due_on, values.owner, actor, personId),
    db
      .prepare(
        `INSERT INTO journey_plan (person_id, target, next_step, due_on, owner, created_by, updated_by)
         SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM journey_plan WHERE person_id = ? AND deleted_at IS NULL)`
      )
      .bind(personId, values.target, values.next_step, values.due_on, values.owner, actor, actor, personId),
  ]);
  return true;
}

/** Clears a plan (soft delete). */
export async function clearPlan(db, personId, actor) {
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  const res = await db
    .prepare(
      `UPDATE journey_plan SET deleted_at = ${now}, updated_at = ${now}, updated_by = ? WHERE person_id = ? AND deleted_at IS NULL`
    )
    .bind(actor, personId)
    .run();
  if (res.meta.changes > 0) await audit(db, actor, 'journey.clear', String(personId));
  return res.meta.changes > 0;
}
