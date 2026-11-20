// SQL generators for the engagement backfill. Pure: data in, statements out. Every
// statement checks before it writes, so the whole file is safe to run twice.

import { norm, sql } from './leadership-history.mjs';

const BY = "'script:engagement-backfill'";
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/**
 * One event from the site content. Links an existing database event that has no link
 * yet (same year, and its name appears in the title, and it is the only such event),
 * otherwise adds the event. Then records which Cognito form or Zeffy page belongs to it.
 * `forms` is [{ source, ref }].
 */
/** @param {{ slug: string, title: string, year: number, type: string, forms?: { source: string, ref: string }[] }} event */
export function eventStatements({ slug, title, year, type, forms = [] }) {
  const unlinked = `site_event_id IS NULL AND deleted_at IS NULL AND year = ${year} AND instr(lower(${sql(title)}), lower(name)) > 0`;
  const out = [
    `UPDATE event SET site_event_id = ${sql(slug)}, updated_at = ${NOW}, updated_by = ${BY}
 WHERE ${unlinked}
   AND (SELECT COUNT(*) FROM event WHERE ${unlinked}) = 1
   AND NOT EXISTS (SELECT 1 FROM event WHERE site_event_id = ${sql(slug)});`,
    `INSERT INTO event (name, event_type, year, site_event_id, created_by, updated_by)
 SELECT ${sql(title)}, ${sql(type)}, ${year}, ${sql(slug)}, ${BY}, ${BY}
 WHERE NOT EXISTS (SELECT 1 FROM event WHERE site_event_id = ${sql(slug)});`,
  ];
  for (const { source, ref } of forms) {
    out.push(`INSERT INTO event_source (event_id, source, form_ref, created_by, updated_by)
 SELECT (SELECT id FROM event WHERE site_event_id = ${sql(slug)}), ${sql(source)}, ${sql(ref)}, ${BY}, ${BY}
 WHERE NOT EXISTS (SELECT 1 FROM event_source WHERE source = ${sql(source)} AND form_ref = ${sql(ref)} AND deleted_at IS NULL);`);
  }
  return out;
}

/** Links a person to their leader page when their name matches one person exactly. */
export function slugStatement({ id, name }) {
  const same = `lower(name) = lower(${sql(name)}) AND deleted_at IS NULL AND erased_at IS NULL`;
  return `UPDATE person SET leader_slug = ${sql(id)}, updated_at = ${NOW}, updated_by = ${BY}
 WHERE leader_slug IS NULL AND ${same}
   AND (SELECT COUNT(*) FROM person WHERE ${same}) = 1
   AND NOT EXISTS (SELECT 1 FROM person WHERE leader_slug = ${sql(id)});`;
}

// Committee names on the Our People page, mapped to the name used in the records.
export const COMMITTEE_NAMES = {
  'Programming & Staffing Committee': 'Programming and Staffing Committee',
  'Leadership, Recruitment, Development & Mentoring Committee':
    'Leadership, Recruitment, Development and Mentoring Committee',
  'One-Day Events Committee': 'One-Day Events Committee',
};

/** Who serves now, from the Our People page. Dates are not on the page, so they stay empty. */
export function currentService(peoplePage) {
  const out = [];
  for (const cat of peoplePage.categories ?? []) {
    const body = cat.label === 'Board of Directors' ? 'Board of Directors' : (COMMITTEE_NAMES[cat.label] ?? cat.label);
    for (const p of cat.people ?? []) {
      const title = p.title && p.title !== 'Board Member' ? p.title : null;
      out.push({
        name: p.name,
        body,
        title,
        started_on: null,
        ended_on: null,
        note: null,
        source: 'Our People page',
        current: true,
      });
    }
  }
  return out;
}

const isOpen = (r, today) => r.ended_on == null || r.ended_on >= today;

/**
 * Adds the people currently shown on the site to the dated history. If someone already
 * has an open term in the same body, the page just supplies their title instead of a
 * second row. `canon` maps a raw name to the name used in the database.
 */
/**
 * @typedef {{ name: string, body: string, title: string | null, started_on: string | null, ended_on: string | null, note: string | null, source: string, current?: boolean }} ServiceEntry
 * @param {ServiceEntry[]} dated
 * @param {ServiceEntry[]} current
 * @param {(name: string) => string} canon
 * @param {string} today
 * @returns {ServiceEntry[]}
 */
export function mergeCurrent(dated, current, canon, today) {
  const rows = dated.map((r) => ({ ...r }));
  for (const c of current) {
    const key = norm(canon(c.name));
    const open = rows.find((r) => norm(canon(r.name)) === key && r.body === c.body && !r.current && isOpen(r, today));
    if (open) {
      if (c.title && !open.title) open.title = c.title;
    } else rows.push(c);
  }
  return rows;
}

/** Splits rows into those whose person is already in the database and those that are not. */
export function resolveService(rows, resolve, peopleNames) {
  const known = new Set(peopleNames.map((n) => norm(n)));
  const resolved = [];
  const unresolved = new Map();
  for (const r of rows) {
    const hit = resolve({ name: r.name });
    if (hit && known.has(norm(hit.name))) resolved.push({ ...r, person: hit.name, how: hit.how });
    else unresolved.set(r.name, (unresolved.get(r.name) ?? 0) + 1);
  }
  return { resolved, unresolved };
}

/** Adds someone who is not in the database yet, unless a person with that name is. */
export function personStatement(name, status) {
  return `INSERT INTO person (name, status, mentor, created_by, updated_by)
 SELECT ${sql(name)}, ${sql(status)}, 0, ${BY}, ${BY}
 WHERE NOT EXISTS (SELECT 1 FROM person WHERE lower(name) = lower(${sql(name)}) AND deleted_at IS NULL AND erased_at IS NULL);`;
}

/** One service row for a person who is the only one with that name. */
export function serviceStatement(r) {
  const same = `lower(p.name) = lower(${sql(r.person)}) AND p.deleted_at IS NULL AND p.erased_at IS NULL`;
  const eq = (col, v) => (v == null || v === '' ? `s.${col} IS NULL` : `s.${col} = ${sql(v)}`);
  return `INSERT INTO service (person_id, body, title, started_on, ended_on, note, source, created_by, updated_by)
 SELECT p.id, ${sql(r.body)}, ${sql(r.title)}, ${sql(r.started_on)}, ${sql(r.ended_on)}, ${sql(r.note)}, ${sql(r.source)}, ${BY}, ${BY}
 FROM person p WHERE ${same} AND (SELECT COUNT(*) FROM person p WHERE ${same}) = 1
   AND NOT EXISTS (SELECT 1 FROM service s WHERE s.person_id = p.id AND s.deleted_at IS NULL
     AND s.body = ${sql(r.body)} AND ${eq('title', r.title)} AND ${eq('started_on', r.started_on)} AND ${eq('ended_on', r.ended_on)});`;
}
