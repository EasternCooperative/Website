import { beforeEach, describe, expect, it } from 'vitest';
import { sqliteD1 } from './d1-sqlite';
import {
  compatibleNames,
  identitiesFrom,
  importStatements,
  newNameCollisions,
  parseDecision,
  resolveIdentities,
  statusFor,
} from '../../scripts/lib/cognito-import.mjs';

// Placeholder names only.
const row = (first: string, last: string, email: string | null = null) => ({ first, last, email });
const people = [
  { id: 1, name: 'Patricia Lee', emails: ['pat@example.org'] },
  { id: 2, name: 'Sam Rivera', emails: [] as string[] },
  { id: 3, name: 'Dana Moss', emails: [] as string[] },
  { id: 4, name: 'Dana Moss', emails: [] as string[] }, // two people share a name
  { id: 5, name: 'Jordan Blake-Hart', emails: ['jb@example.org'] },
];
const resolve = (rows: ReturnType<typeof row>[], opts = {}) => {
  const { identities, sharedEmails } = identitiesFrom(rows);
  return { ...resolveIdentities(identities, people, opts), identities, sharedEmails };
};
const how = (r: ReturnType<typeof resolve>, name: string) =>
  r.resolved.find((x: { id: { name: string } }) => x.id.name === name)?.how;
const reviewed = (r: ReturnType<typeof resolve>) => r.review.map((x: { id: { name: string } }) => x.id.name).sort();

describe('names that could be the same person', () => {
  it('accepts the same name, an initial, or a prefix of the first name, with the same last name', () => {
    expect(compatibleNames('Pat Lee', 'Patricia Lee')).toBe(true);
    expect(compatibleNames('P. Lee', 'Patricia Lee')).toBe(true);
    expect(compatibleNames('Jordan Blake-Hart', 'jordan blake hart')).toBe(true);
    expect(compatibleNames('Pat Lee', 'Pat Kim')).toBe(false);
    expect(compatibleNames('Pat Lee', 'Sam Lee')).toBe(false);
    expect(compatibleNames('Gabby Frisone', 'Gabriella Frisone')).toBe(false); // nicknames need an override
    expect(compatibleNames('', 'Pat Lee')).toBe(false);
  });
});

describe('matching attendees to people', () => {
  it('matches an exact name, an override, and an email with a compatible name', () => {
    const r = resolve(
      [
        row('Sam', 'Rivera'),
        row('Pat', 'Lee', 'pat@example.org'),
        row('Alex', 'Blake-Hart', 'jb@example.org'),
        row('Nick', 'Name'),
      ],
      { overrides: { 'Nick Name': 'Sam Rivera' } }
    );
    expect(how(r, 'Sam Rivera')).toBe('name');
    expect(how(r, 'Pat Lee')).toBe('email');
    expect(how(r, 'Nick Name')).toBe('override');
    expect(r.review.map((x: { id: { name: string } }) => x.id.name)).toEqual(['Alex Blake-Hart']); // the email matches someone, but the name does not
  });

  it('sends ambiguous and near matches to review rather than guessing', () => {
    const r = resolve([
      row('Dana', 'Moss'),
      row('Sam', 'Riveras'),
      row('Someone', 'Else', 'pat@example.org'),
      row('Totally', 'Unknown'),
    ]);
    expect(reviewed(r)).toEqual(['Dana Moss', 'Sam Riveras', 'Someone Else']);
    expect(r.review.find((x: { id: { name: string } }) => x.id.name === 'Dana Moss')?.reason).toContain(
      'share this name'
    );
    expect(r.review.find((x: { id: { name: string } }) => x.id.name === 'Someone Else')?.reason).toContain(
      'different name'
    );
    expect(how(r, 'Totally Unknown')).toBe('new');
  });

  it('treats one new person seen in several rows as one, and flags a person who looks like another new one', () => {
    const r = resolve([row('Alex', 'Park', 'a@x.org'), row('Alex', 'Park', 'b@x.org'), row('Alexa', 'Park')]);
    expect(r.identities.find((i: { name: string }) => i.name === 'Alex Park')?.emails.size).toBe(2);
    expect(reviewed(r)).toEqual(['Alex Park', 'Alexa Park']);
  });

  it('marks an email as shared when two different people use it, but not for spellings of one name', () => {
    const shared = identitiesFrom([
      row('Ann', 'Wu', 'home@x.org'),
      row('Bo', 'Wu', 'home@x.org'),
      row('Cy', 'Ng', 'cy@x.org'),
      row('Cyril', 'Ng', 'cy@x.org'),
    ]);
    expect([...shared.sharedEmails]).toEqual(['home@x.org']);
    expect(identitiesFrom([row('', '')]).identities).toEqual([]);
  });

  it('applies a reviewed decision', () => {
    const decisions = new Map([
      ['dana moss', 'match:4'],
      ['sam riveras', 'match:Sam Rivera'],
      ['someone else', 'new'],
      ['pat lee', 'skip'],
      ['nobody', 'match:999'],
    ]);
    const r = resolve(
      [
        row('Dana', 'Moss'),
        row('Sam', 'Riveras'),
        row('Someone', 'Else', 'pat@example.org'),
        row('Pat', 'Lee'),
        row('Nobody', ''),
      ],
      { decisions }
    );
    expect(r.resolved.map((x: { id: { name: string }; how: string }) => [x.id.name, x.how])).toEqual(
      expect.arrayContaining([
        ['Dana Moss', 'decided'],
        ['Sam Riveras', 'decided'],
        ['Someone Else', 'new'],
        ['Pat Lee', 'skipped'],
      ])
    );
    expect(reviewed(r)).toEqual(['Nobody']); // a decision that matches no one stays in review
  });

  it('reports new people who would share a lookup name', () => {
    expect(
      newNameCollisions([
        { how: 'new', id: { key: 'a' } },
        { how: 'new', id: { key: 'a' } },
        { how: 'name', id: { key: 'b' } },
      ])
    ).toEqual(['a']);
    expect(newNameCollisions([])).toEqual([]);
  });
});

describe('review decisions', () => {
  it('reads each kind, and ignores anything else', () => {
    expect(
      ['New', ' skip ', 'match: 12', 'MATCH:Sam Rivera', 'as : Alex Park', 'maybe', '', undefined, 'match:'].map(
        parseDecision
      )
    ).toEqual(['new', 'skip', 'match:12', 'match:Sam Rivera', 'as:Alex Park', null, null, null, null]);
  });

  it('folds one spelling into another, so registrations land on one person', () => {
    const decisions = new Map([['alexa park', 'as:Alex Park']]);
    const rows = [row('Alex', 'Park', 'a@x.org'), row('Alexa', 'Park', 'b@x.org'), row('Alex', 'Park')];
    const { identities } = identitiesFrom(rows);
    const r = resolveIdentities(identities, people, { decisions });
    expect(r.review).toEqual([]);
    expect(r.resolved.map((x: { id: { name: string } }) => x.id.name)).toEqual(['Alex Park']);
    expect([...r.resolved[0].id.emails].sort()).toEqual(['a@x.org', 'b@x.org']);
    expect([...r.alias]).toEqual([['alexa park', 'alex park']]);
  });

  it('keeps a fold that points nowhere, or at itself or another fold, in review', () => {
    const decisions = new Map([
      ['a b', 'as:Nobody Here'],
      ['c d', 'as:E F'],
      ['e f', 'as:C D'],
      ['g h', 'as:G H'],
    ]);
    const { identities } = identitiesFrom([row('A', 'B'), row('C', 'D'), row('E', 'F'), row('G', 'H')]);
    const r = resolveIdentities(identities, people, { decisions });
    expect(r.review.map((x: { id: { name: string } }) => x.id.name).sort()).toEqual(['A B', 'C D', 'E F', 'G H']);
  });
});

describe('payment and status', () => {
  it('treats a refund or cancellation as cancelled, and everything else as registered', () => {
    expect([
      statusFor('Refunded', 'Submitted'),
      statusFor('Paid', 'Cancelled'),
      statusFor('Unpaid', 'Awaiting Payment'),
      statusFor(null, null),
    ]).toEqual(['cancelled', 'cancelled', 'registered', 'registered']);
  });
});

describe('the SQL', () => {
  let db: ReturnType<typeof sqliteD1>;
  const adult = (
    ref: string,
    first: string,
    last: string,
    email: string | null = null,
    membershipYear: number | null = null
  ) => ({ ref, first, last, email, newcomer: null, membershipYear });
  const entry = (over = {}) => ({
    formId: '10',
    entryRef: '10-1',
    status: 'Submitted',
    payment: 'Paid',
    submittedAt: '2026-01-02T00:00:00Z',
    partyAdults: 2,
    partyChildren: 1,
    adults: [
      adult('a1', 'Sam', 'Rivera', 'sam@example.org'),
      adult('a2', 'Newcomer', 'Person', 'new@example.org', 2027),
    ],
    children: [{ token: 'tok1', band: '6 to 11' }],
    ...over,
  });
  const build = (entries = [entry()], newStatus = 'inactive') => {
    const rows = entries.flatMap((e) => e.adults).map((a) => row(a.first, a.last, a.email));
    const r = resolve(rows);
    return importStatements({
      resolved: r.resolved,
      entries,
      eventOf: (f: string) => (f === '10' ? 'camp-2026' : null),
      sharedEmails: r.sharedEmails,
      newStatus,
    });
  };
  const run = (sqls: string[]) => sqls.forEach((s) => db.raw.exec(s));
  const count = (t: string) => (db.raw.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;

  beforeEach(() => {
    db = sqliteD1();
    db.raw.exec(`
      INSERT INTO person (id, name) VALUES (1, 'Patricia Lee'), (2, 'Sam Rivera'), (3, 'Dana Moss'), (4, 'Dana Moss'), (5, 'Jordan Blake-Hart');
      UPDATE person SET email = 'jb@example.org' WHERE id = 5;
      INSERT INTO event (id, name, event_type, year, site_event_id) VALUES (1, 'Camp 2026', 'weekend', 2026, 'camp-2026');
    `);
  });

  it('loads registrations, a new person, a missing email, a membership, and a child token', () => {
    run(build());
    expect(
      db.raw
        .prepare(
          'SELECT person_id, event_id, entry_ref, attendee_ref, status, party_adults, party_children FROM registration ORDER BY id'
        )
        .all()
    ).toEqual([
      {
        person_id: 2,
        event_id: 1,
        entry_ref: '10-1',
        attendee_ref: 'a1',
        status: 'registered',
        party_adults: 2,
        party_children: 1,
      },
      {
        person_id: 6,
        event_id: 1,
        entry_ref: '10-1',
        attendee_ref: 'a2',
        status: 'registered',
        party_adults: 2,
        party_children: 1,
      },
    ]);
    expect(db.raw.prepare('SELECT name, email, status, mentor FROM person WHERE id = 6').get()).toEqual({
      name: 'Newcomer Person',
      email: 'new@example.org',
      status: 'inactive',
      mentor: 0,
    });
    expect(db.raw.prepare('SELECT email FROM person WHERE id = 2').get()).toEqual({ email: 'sam@example.org' }); // was empty
    expect(
      db.raw.prepare('SELECT person_id, email_lower, is_primary, shared FROM person_email ORDER BY id').all()
    ).toEqual([
      { person_id: 2, email_lower: 'sam@example.org', is_primary: 0, shared: 0 },
      { person_id: 6, email_lower: 'new@example.org', is_primary: 1, shared: 0 },
    ]);
    expect(db.raw.prepare('SELECT person_id, kind, ends_on, source_ref FROM membership').all()).toEqual([
      { person_id: 6, kind: 'annual', ends_on: '2027-12-31', source_ref: '10-1/a2' },
    ]);
    expect(db.raw.prepare('SELECT event_id, token, age_band FROM child_attendance').all()).toEqual([
      { event_id: 1, token: 'tok1', age_band: '6 to 11' },
    ]);
  });

  it('can leave child tokens out, or load only them', () => {
    const rows = [entry()].flatMap((e) => e.adults).map((a) => row(a.first, a.last, a.email));
    const r = resolve(rows);
    const make = (children: string) =>
      importStatements({
        resolved: r.resolved,
        entries: [entry()],
        eventOf: () => 'camp-2026',
        sharedEmails: r.sharedEmails,
        newStatus: 'inactive',
        children,
      });
    run(make('none'));
    expect([count('registration'), count('child_attendance')]).toEqual([2, 0]);
    run(make('only'));
    expect([count('registration'), count('child_attendance'), count('person')]).toEqual([2, 1, 6]);
    expect(make('only').every((s: string) => s.includes('child_attendance'))).toBe(true);
  });

  it('is safe to run twice', () => {
    const sqls = build();
    run(sqls);
    const before = ['person', 'person_email', 'registration', 'membership', 'child_attendance'].map(count);
    run(sqls);
    expect(['person', 'person_email', 'registration', 'membership', 'child_attendance'].map(count)).toEqual(before);
  });

  it('keeps one membership per person per year, however many events it was bought at', () => {
    const again = entry({ entryRef: '10-2' });
    run(build([entry(), again]));
    expect(db.raw.prepare('SELECT COUNT(*) n FROM membership').get()).toEqual({ n: 1 });
    expect(count('registration')).toBe(4); // but both events' registrations are kept
  });

  it('records a refunded entry as cancelled, with no child token and no membership', () => {
    run(build([entry({ payment: 'Refunded' })]));
    expect(db.raw.prepare('SELECT DISTINCT status FROM registration').all()).toEqual([{ status: 'cancelled' }]);
    expect(count('child_attendance')).toBe(0);
    expect(count('membership')).toBe(0);
  });

  it('skips a form with no confirmed event, and an event that is not in the database', () => {
    run(build([entry({ formId: '99' })]));
    expect(count('registration')).toBe(0);
    db.raw.exec("UPDATE event SET site_event_id = 'other' WHERE id = 1");
    run(build());
    expect(count('registration')).toBe(0);
    expect(count('child_attendance')).toBe(0);
  });

  it('gives an attendee with no id a stable reference, and does not duplicate registrations across runs', () => {
    const e = entry({ adults: [adult('', 'Sam', 'Rivera', null), adult('', 'Newcomer', 'Person', null)] });
    run(build([e]));
    run(build([e]));
    expect(db.raw.prepare('SELECT attendee_ref FROM registration ORDER BY id').all()).toEqual([
      { attendee_ref: 'n0' },
      { attendee_ref: 'n1' },
    ]);
  });

  it('loads registrations under a folded spelling onto the one person', () => {
    const e = entry({ adults: [adult('a1', 'Alex', 'Park', 'a@x.org'), adult('a2', 'Alexa', 'Park', 'b@x.org')] });
    const rows = e.adults.map((a) => row(a.first, a.last, a.email));
    const { identities, sharedEmails } = identitiesFrom(rows);
    const r = resolveIdentities(identities, people, { decisions: new Map([['alexa park', 'as:Alex Park']]) });
    run(
      importStatements({
        resolved: r.resolved,
        entries: [e],
        eventOf: () => 'camp-2026',
        sharedEmails,
        newStatus: 'inactive',
        alias: r.alias,
      })
    );
    expect(db.raw.prepare("SELECT COUNT(*) n FROM person WHERE name LIKE 'Alex%'").get()).toEqual({ n: 1 });
    expect(db.raw.prepare('SELECT COUNT(DISTINCT person_id) n, COUNT(*) c FROM registration').get()).toEqual({
      n: 1,
      c: 2,
    });
  });

  it('marks a shared email, keeps it off the person record, and leaves skipped people out', () => {
    const e = entry({ adults: [adult('a1', 'Ann', 'Wu', 'home@x.org'), adult('a2', 'Bo', 'Wu', 'home@x.org')] });
    const rows = e.adults.map((a) => row(a.first, a.last, a.email));
    const r = resolve(rows);
    const skipped = {
      ...r,
      resolved: [
        ...r.resolved,
        { id: { key: 'ghost', name: 'Ghost', emails: new Set(['g@x.org']) }, how: 'skipped', person: null },
      ],
    };
    run(
      importStatements({
        resolved: skipped.resolved,
        entries: [e],
        eventOf: () => 'camp-2026',
        sharedEmails: r.sharedEmails,
        newStatus: 'inactive',
      })
    );
    expect(db.raw.prepare('SELECT shared FROM person_email').all()).toEqual([{ shared: 1 }, { shared: 1 }]);
    expect(db.raw.prepare("SELECT email FROM person WHERE name IN ('Ann Wu','Bo Wu')").all()).toEqual([
      { email: null },
      { email: null },
    ]);
    expect(db.raw.prepare("SELECT COUNT(*) n FROM person WHERE name = 'Ghost'").get()).toEqual({ n: 0 });
  });
});
