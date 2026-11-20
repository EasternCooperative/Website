import { beforeEach, describe, expect, it } from 'vitest';
import { sqliteD1 } from './d1-sqlite';
import {
  COMMITTEE_NAMES,
  currentService,
  eventStatements,
  mergeCurrent,
  personStatement,
  resolveService,
  serviceStatement,
  slugStatement,
} from '../../scripts/lib/engagement-backfill.mjs';

// Placeholder names only.
let db: ReturnType<typeof sqliteD1>;
const run = (sqls: string[]) => sqls.forEach((s) => db.raw.exec(s));
const all = (sql: string) => db.raw.prepare(sql).all() as Record<string, unknown>[];
const one = (sql: string) => db.raw.prepare(sql).get() as Record<string, unknown>;

beforeEach(() => {
  db = sqliteD1();
  db.raw.exec(`
    INSERT INTO person (id, name) VALUES (1, 'Person A'), (2, 'Person B'), (3, 'Person B');
    INSERT INTO event (id, name, event_type, year, site_event_id) VALUES
      (1, 'Winter Adventure', 'extended', 2025, NULL),
      (2, 'Camp 2024', 'weekend', 2024, '2024-camp');
  `);
});

describe('events', () => {
  const winter = { slug: '2025-winter-adventure', title: 'Winter Adventure 2025', year: 2025, type: 'extended' };

  it('links an unlinked event instead of adding a duplicate, and adds the rest', () => {
    run(eventStatements({ ...winter, forms: [{ source: 'cognito', ref: '116' }] }));
    run(
      eventStatements({
        slug: '2026-spring',
        title: 'Spring 2026',
        year: 2026,
        type: 'weekend',
        forms: [{ source: 'zeffy', ref: 'spring-tix' }],
      })
    );
    expect(all('SELECT id, site_event_id FROM event ORDER BY id')).toEqual([
      { id: 1, site_event_id: '2025-winter-adventure' },
      { id: 2, site_event_id: '2024-camp' },
      { id: 3, site_event_id: '2026-spring' },
    ]);
    expect(all('SELECT event_id, source, form_ref FROM event_source ORDER BY id')).toEqual([
      { event_id: 1, source: 'cognito', form_ref: '116' },
      { event_id: 3, source: 'zeffy', form_ref: 'spring-tix' },
    ]);
  });

  it('records when and where, fills a linked event, and only rewrites what differs', () => {
    const dated = { ...winter, start: '2025-12-26', end: '2025-12-31', siteId: 'the-y-at-watson-woods' };
    run(eventStatements(dated));
    const row = () => one('SELECT start_date, end_date, site_id, updated_at FROM event WHERE id = 1');
    expect(row()).toMatchObject({ start_date: '2025-12-26', end_date: '2025-12-31', site_id: 'the-y-at-watson-woods' });
    db.raw.exec("UPDATE event SET updated_at = 'marker' WHERE id = 1");
    run(eventStatements(dated));
    expect(row().updated_at).toBe('marker');
    run(eventStatements({ ...dated, start: '2025-12-27' }));
    expect(row()).toMatchObject({ start_date: '2025-12-27' });
    run(eventStatements({ slug: 'virtual', title: 'Virtual 2026', year: 2026, type: 'one_day' }));
    expect(one("SELECT start_date, site_id FROM event WHERE site_event_id = 'virtual'")).toEqual({
      start_date: null,
      site_id: null,
    });
  });

  it('is safe to run twice', () => {
    const sqls = eventStatements({ ...winter, forms: [{ source: 'cognito', ref: '116' }] });
    run(sqls);
    const before = all('SELECT * FROM event').length + all('SELECT * FROM event_source').length;
    run(sqls);
    expect(all('SELECT * FROM event').length + all('SELECT * FROM event_source').length).toBe(before);
  });

  it('does not link when the year differs, the name is not in the title, or two events could match', () => {
    run(eventStatements({ slug: '2026-winter', title: 'Winter Adventure 2026', year: 2026, type: 'extended' }));
    run(eventStatements({ slug: '2025-other', title: 'Fall Fun Day', year: 2025, type: 'one_day' }));
    expect(one('SELECT site_event_id FROM event WHERE id = 1')).toEqual({ site_event_id: null });
    db.raw.exec("INSERT INTO event (name, event_type, year) VALUES ('Winter', 'extended', 2025)"); // a second unlinked candidate
    run(eventStatements(winter));
    expect(one('SELECT site_event_id FROM event WHERE id = 1')).toEqual({ site_event_id: null });
    expect(all("SELECT id FROM event WHERE site_event_id = '2025-winter-adventure'")).toHaveLength(1); // added as its own row
  });

  it('quotes awkward titles safely', () => {
    run(eventStatements({ slug: 's', title: "Kids' Day; DROP TABLE person;--", year: 2030, type: 'one_day' }));
    expect(one("SELECT name FROM event WHERE site_event_id = 's'")).toEqual({
      name: "Kids' Day; DROP TABLE person;--",
    });
    expect(all('SELECT id FROM person')).toHaveLength(3);
  });
});

describe('leader pages', () => {
  it('links a person once, by exact name', () => {
    run([slugStatement({ id: 'person-a', name: 'person a' })]);
    expect(one('SELECT leader_slug FROM person WHERE id = 1')).toEqual({ leader_slug: 'person-a' });
    run([slugStatement({ id: 'person-a-2', name: 'Person A' })]); // already linked
    expect(one('SELECT leader_slug FROM person WHERE id = 1')).toEqual({ leader_slug: 'person-a' });
  });

  it('skips a name that two people share, and a page already used', () => {
    run([slugStatement({ id: 'person-b', name: 'Person B' })]);
    expect(all('SELECT id FROM person WHERE leader_slug IS NOT NULL')).toEqual([]);
    run([slugStatement({ id: 'person-a', name: 'Person A' })]);
    db.raw.exec("UPDATE person SET name = 'Person C' WHERE id = 2");
    run([slugStatement({ id: 'person-a', name: 'Person C' })]); // slug taken
    expect(one('SELECT leader_slug FROM person WHERE id = 2')).toEqual({ leader_slug: null });
  });
});

describe('service history', () => {
  const row = (over = {}) => ({
    person: 'Person A',
    body: 'Board of Directors',
    title: null,
    started_on: '2024-01',
    ended_on: '2027-12',
    note: null,
    source: 'test',
    ...over,
  });

  it('adds a row once, and treats a missing title or date as a value, not a wildcard', () => {
    run([serviceStatement(row()), serviceStatement(row())]);
    expect(all('SELECT * FROM service')).toHaveLength(1);
    run([serviceStatement(row({ title: 'Chair' }))]);
    run([serviceStatement(row({ ended_on: null }))]);
    expect(all('SELECT title, ended_on FROM service ORDER BY id')).toEqual([
      { title: null, ended_on: '2027-12' },
      { title: 'Chair', ended_on: '2027-12' },
      { title: null, ended_on: null },
    ]);
  });

  it('does not guess between two people with the same name', () => {
    run([serviceStatement(row({ person: 'Person B' }))]);
    expect(all('SELECT * FROM service')).toEqual([]);
  });

  it('skips an erased person', () => {
    db.raw.exec("UPDATE person SET erased_at = '2026-01-01' WHERE id = 1");
    run([serviceStatement(row())]);
    expect(all('SELECT * FROM service')).toEqual([]);
  });

  it('adds a missing person once, unless the name exists', () => {
    run([
      personStatement('Person D', 'inactive'),
      personStatement('person d', 'inactive'),
      personStatement('Person A', 'active'),
    ]);
    expect(all('SELECT name, status FROM person WHERE id > 3')).toEqual([{ name: 'Person D', status: 'inactive' }]);
  });
});

describe('merging the site roster into the dated history', () => {
  const canon = (n: string) => (n === 'Old Name' ? 'Person A' : n);
  const dated = [
    {
      name: 'Old Name',
      body: 'Board of Directors',
      title: null,
      started_on: '2023-01',
      ended_on: '2026-12',
      note: null,
      source: 'd',
    },
    {
      name: 'Person B',
      body: 'Board of Directors',
      title: null,
      started_on: '2018-01',
      ended_on: '2021-12',
      note: null,
      source: 'd',
    },
  ];
  const page = {
    categories: [
      {
        label: 'Board of Directors',
        people: [
          { name: 'Person A', title: 'Board Chair' },
          { name: 'Person B', title: 'Board Member' },
          { name: 'Person E' },
        ],
      },
      { label: 'Programming & Staffing Committee', people: [{ name: 'Person A', title: 'Chair' }] },
      { label: 'Unlisted Group', people: [{ name: 'Person E' }] },
    ],
  };

  it('reads the roster, mapping committee names and ignoring the plain "Board Member" title', () => {
    const cur = currentService(page);
    expect(cur.map((c) => [c.name, c.body, c.title])).toEqual([
      ['Person A', 'Board of Directors', 'Board Chair'],
      ['Person B', 'Board of Directors', null],
      ['Person E', 'Board of Directors', null],
      ['Person A', COMMITTEE_NAMES['Programming & Staffing Committee'], 'Chair'],
      ['Person E', 'Unlisted Group', null],
    ]);
    expect(currentService({})).toEqual([]);
  });

  it('gives an open term its title, adds people with no open term, and leaves ended terms alone', () => {
    const merged = mergeCurrent(dated, currentService(page), canon, '2026-11-20');
    const board = merged.filter((r) => r.body === 'Board of Directors').map((r) => [r.name, r.title, r.ended_on]);
    expect(board).toEqual([
      ['Old Name', 'Board Chair', '2026-12'], // the open term takes the title from the page
      ['Person B', null, '2021-12'], // that term ended, so the page adds a separate current row
      ['Person B', null, null],
      ['Person E', null, null],
    ]);
    expect(
      merged.filter((r) => r.current && r.body === COMMITTEE_NAMES['Programming & Staffing Committee'])
    ).toHaveLength(1);
  });

  it('separates people who are in the database from those who are not', () => {
    const resolve = ({ name }: { name: string }) => ({ name: canon(name), how: 'x' });
    const { resolved, unresolved } = resolveService(dated, resolve, ['Person A']);
    expect(resolved.map((r) => r.person)).toEqual(['Person A']);
    expect([...unresolved]).toEqual([['Person B', 1]]);
    expect(resolveService([{ name: '' } as never], () => null, []).resolved).toEqual([]);
  });
});
