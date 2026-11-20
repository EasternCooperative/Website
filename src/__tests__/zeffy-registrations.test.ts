import { beforeEach, describe, expect, it } from 'vitest';
import { sqliteD1 } from './d1-sqlite';
import { identitiesFrom, resolveIdentities } from '../../scripts/lib/cognito-import.mjs';
import { ticketRegistrations, ticketStatements, TICKET_EVENTS } from '../../scripts/lib/zeffy-registrations.mjs';

// Synthetic data only.
const header = [
  'Payment Status',
  'Campaign Title',
  'First Name',
  'Last Name',
  'Email',
  'Payment Date (America/Los_Angeles)',
  'Payment Time (America/Los_Angeles)',
];
const MAY = 'ECRS Fun Day Philly- Sunday May 18, 2025';
const row = (status: string, campaign: string, first: string, last: string, email: string | null, time = '1:00 PM') => [
  status,
  campaign,
  first,
  last,
  email,
  '5/10/2025',
  time,
];

describe('ticketRegistrations', () => {
  it('keeps one row per payer and payment, and only successful tickets for known events', () => {
    const rows = ticketRegistrations(header, [
      row('Succeeded', MAY, 'Pat', 'Lee', 'Pat@Example.org'),
      row('Succeeded', MAY, 'Pat', 'Lee', 'Pat@Example.org'),
      row('Refunded', MAY, 'Sam', 'Rivera', null),
      row('Succeeded', 'One Time Supporting Donation', 'Kit', 'Fox', null),
      row('Succeeded', 'ECRS Fun Day in Philly', 'Kit', 'Fox', null),
      row('Succeeded', MAY, '', '', null),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ first: 'Pat', email: 'pat@example.org', date: '2025-05-10' });
    expect(rows[0].ref).toMatch(/^[0-9a-f]{20}$/);
    expect(Object.keys(TICKET_EVENTS)).toContain(MAY);
  });
});

describe('ticketStatements', () => {
  let db: ReturnType<typeof sqliteD1>;
  const run = (data: unknown[][]) => {
    const rows = ticketRegistrations(header, data);
    const { identities, sharedEmails } = identitiesFrom(rows);
    const r = resolveIdentities(identities, [{ id: 1, name: 'Pat Lee', emails: [] }]);
    ticketStatements({ rows, resolved: r.resolved, alias: r.alias, sharedEmails, newStatus: 'inactive' }).forEach((s) =>
      db.raw.exec(s)
    );
  };
  beforeEach(() => {
    db = sqliteD1();
    db.raw.exec("INSERT INTO person (id, name) VALUES (1, 'Pat Lee');");
  });

  it('creates the event, adds registrations once, and adds new payers as inactive', () => {
    const data = [row('Succeeded', MAY, 'Pat', 'Lee', null), row('Succeeded', MAY, 'Sam', 'Rivera', null, '2:00 PM')];
    run(data);
    run(data);
    expect(db.raw.prepare("SELECT COUNT(*) n FROM event WHERE name = 'Fun Day in Philly (May 18)'").get()).toEqual({
      n: 1,
    });
    expect(db.raw.prepare('SELECT COUNT(*) n FROM registration').get()).toEqual({ n: 2 });
    expect(db.raw.prepare("SELECT status FROM person WHERE name = 'Sam Rivera'").get()).toEqual({ status: 'inactive' });
  });

  it('skips a registration when the event is not in the database', () => {
    db.raw.exec("INSERT INTO event (name, event_type, year) VALUES ('x', 'one_day', 2026);");
    run([row('Succeeded', 'ECRS Fun Day in Wilmington', 'Pat', 'Lee', null)]);
    expect(db.raw.prepare('SELECT COUNT(*) n FROM registration').get()).toEqual({ n: 0 });
  });
});
