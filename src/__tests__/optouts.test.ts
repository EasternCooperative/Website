import { beforeEach, describe, expect, it } from 'vitest';
import { sqliteD1 } from './d1-sqlite';
import { optoutStatements } from '../../scripts/lib/optouts.mjs';

// Placeholder names only.
const people = [
  { id: 1, name: 'Pat Lee', emails: ['pat@example.org'] },
  { id: 2, name: 'Sam Rivera', emails: ['home@example.org'] },
  { id: 3, name: 'Kim Rivera', emails: ['home@example.org'] }, // shares an address with Sam
  { id: 4, name: 'Dana Moss', emails: [] as string[] },
  { id: 5, name: 'Dana Moss', emails: [] as string[] }, // two people share a name
  { id: 6, name: 'Alex Park', emails: [] as string[] },
];
const row = (email: string, first = '', last = '') => ({ email, first, last });

describe('who gets marked', () => {
  it('marks by address, everyone who shares it, and by an exact unique name', () => {
    const r = optoutStatements([row(' PAT@example.org '), row('home@example.org'), row('', 'Alex', 'Park')], people);
    expect(r).toMatchObject({ marked: 4, byEmail: 3, byName: 1, sharedAddresses: 1, unmatched: 0 });
    expect(r.statements).toHaveLength(4);
  });

  it('does not guess: a shared name, an unknown person, or no details at all', () => {
    const r = optoutStatements([row('', 'Dana', 'Moss'), row('nobody@example.org', 'No', 'One'), row('')], people);
    expect(r).toMatchObject({ marked: 0, unmatched: 3 });
  });

  it('counts a person once however many ways they match', () => {
    const r = optoutStatements(
      [row('pat@example.org'), row('pat@example.org', 'Pat', 'Lee'), row('', 'Pat', 'Lee')],
      people
    );
    expect(r.marked).toBe(1);
  });
});

describe('the SQL', () => {
  let db: ReturnType<typeof sqliteD1>;
  beforeEach(() => {
    db = sqliteD1();
    db.raw.exec("INSERT INTO person (id, name) VALUES (1, 'Pat Lee'), (2, 'Sam Rivera'), (3, 'Erased'), (4, 'Gone');");
    db.raw.exec(
      "UPDATE person SET erased_at = '2026-01-01' WHERE id = 3; UPDATE person SET deleted_at = '2026-01-01' WHERE id = 4;"
    );
  });

  it('marks people once, skips erased or removed ones, and shows up in the engagement view', () => {
    const r = optoutStatements(
      [row('pat@example.org'), row('e@x.org'), row('g@x.org')],
      [
        { id: 1, name: 'Pat Lee', emails: ['pat@example.org'] },
        { id: 3, name: 'Erased', emails: ['e@x.org'] },
        { id: 4, name: 'Gone', emails: ['g@x.org'] },
      ]
    );
    r.statements.forEach((s: string) => db.raw.exec(s));
    r.statements.forEach((s: string) => db.raw.exec(s)); // twice
    expect(db.raw.prepare('SELECT person_id, goal, status, note FROM outreach').all()).toEqual([
      {
        person_id: 1,
        goal: 'invite_back',
        status: 'do_not_contact',
        note: 'Unsubscribed from the newsletter list (Mailchimp)',
      },
    ]);
    expect(db.raw.prepare('SELECT person_id, do_not_contact FROM person_engagement ORDER BY person_id').all()).toEqual([
      { person_id: 1, do_not_contact: 1 },
      { person_id: 2, do_not_contact: 0 },
    ]);
  });
});
