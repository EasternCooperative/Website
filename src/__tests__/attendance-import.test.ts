import { beforeEach, describe, expect, it } from 'vitest';
import { sqliteD1 } from './d1-sqlite';
import { identitiesFrom, resolveIdentities } from '../../scripts/lib/cognito-import.mjs';
import { attendanceStatements, attendeeRows } from '../../scripts/lib/attendance-import.mjs';

// Synthetic data only.
const table = [
  ['First Name', 'Last Name', 'Email', 'Phone Number', 'Registered but did not attend', 'Notes'],
  ['Pat', 'Lee', 'pat@example.org', '555', '', 'ignored'],
  ['Sam', 'Rivera', '', '', 'x', ''],
  ['', '', '', '', '', ''],
];

describe('attendeeRows', () => {
  it('marks the flagged as not attended and ignores phone, notes, and blank rows', () => {
    expect(attendeeRows(table, 'ev')).toEqual([
      { first: 'Pat', last: 'Lee', email: 'pat@example.org', attended: 1, eventSlug: 'ev' },
      { first: 'Sam', last: 'Rivera', email: null, attended: 0, eventSlug: 'ev' },
    ]);
  });
  it('refuses a list without the expected columns', () => {
    expect(() => attendeeRows([['Name']], 'ev')).toThrow();
  });
});

describe('attendanceStatements', () => {
  let db: ReturnType<typeof sqliteD1>;
  const run = (rows: ReturnType<typeof attendeeRows>) => {
    const { identities, sharedEmails } = identitiesFrom(rows);
    const r = resolveIdentities(identities, [{ id: 1, name: 'Pat Lee', emails: [] }]);
    const sqls = attendanceStatements({
      rows,
      resolved: r.resolved,
      alias: r.alias,
      sharedEmails,
      newStatus: 'inactive',
    });
    sqls.forEach((s) => db.raw.exec(s));
  };
  beforeEach(() => {
    db = sqliteD1();
    db.raw.exec(`INSERT INTO person (id, name) VALUES (1, 'Pat Lee');
      INSERT INTO event (id, name, event_type, year, site_event_id) VALUES (1, 'Fun Day', 'one_day', 2026, 'ev');`);
  });

  it('records attendance once, adding new people as inactive', () => {
    const rows = attendeeRows(table, 'ev');
    run(rows);
    run(rows);
    expect(db.raw.prepare('SELECT person_id, attended FROM registration ORDER BY id').all()).toEqual([
      { person_id: 1, attended: 1 },
      { person_id: 2, attended: 0 },
    ]);
    expect(db.raw.prepare("SELECT status FROM person WHERE name = 'Sam Rivera'").get()).toEqual({ status: 'inactive' });
  });

  it('updates an existing registration instead of adding another, and skips an unknown event', () => {
    db.raw.exec("INSERT INTO registration (person_id, event_id, source, entry_ref) VALUES (1, 1, 'cognito', 'x');");
    run(attendeeRows(table, 'ev'));
    expect(db.raw.prepare('SELECT COUNT(*) n FROM registration WHERE person_id = 1').get()).toEqual({ n: 1 });
    expect(db.raw.prepare('SELECT attended FROM registration WHERE person_id = 1').get()).toEqual({ attended: 1 });
    run(attendeeRows(table, 'missing'));
    expect(db.raw.prepare('SELECT COUNT(*) n FROM registration').get()).toEqual({ n: 2 });
  });
});
