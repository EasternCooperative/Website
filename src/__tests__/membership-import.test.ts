import { beforeEach, describe, expect, it } from 'vitest';
import { sqliteD1 } from './d1-sqlite';
import { identitiesFrom, resolveIdentities } from '../../scripts/lib/cognito-import.mjs';
import { membershipRows, membershipStatements } from '../../scripts/lib/membership-import.mjs';

// Synthetic data only.
const entry = (o: Record<string, unknown> = {}) => ({
  Id: 'e1',
  PrimaryMemberFirstName: 'Pat',
  PrimaryMemberLastName: 'Lee',
  Email: 'Pat@Example.org',
  TypeOfPrimaryMembership: 'Yearly (1st Household Member)',
  AdditionalHouseholdMembers: [{ FirstName: 'Sam', LastName: 'Rivera', Email: null }],
  Entry: { Status: 'Submitted', DateSubmitted: '2022-03-04T10:00:00Z' },
  Order: { PaymentStatus: 'Paid' },
  ...o,
});

describe('membershipRows', () => {
  it('counts the member and household members of paid, complete entries', () => {
    const { rows, skipped } = membershipRows([entry()]);
    expect(rows).toEqual([
      { first: 'Pat', last: 'Lee', email: 'pat@example.org', year: 2022, kind: 'annual', sourceRef: 'e1/0' },
      { first: 'Sam', last: 'Rivera', email: null, year: 2022, kind: 'annual', sourceRef: 'e1/1' },
    ]);
    expect(skipped).toEqual({ incomplete: 0, unpaid: 0, refunded: 0, noDate: 0 });
  });

  it('tallies what it leaves out, and reads lifetime memberships', () => {
    const { rows, skipped } = membershipRows([
      entry({ Entry: { Status: 'Incomplete' } }),
      entry({ Order: { PaymentStatus: 'Unpaid' } }),
      entry({ Order: { PaymentStatus: 'Refunded' } }),
      entry({ Entry: { Status: 'Submitted' } }),
      entry({
        TypeOfPrimaryMembership: 'Lifetime (Single)',
        AdditionalHouseholdMembers: [],
        PrimaryMemberFirstName: '',
        PrimaryMemberLastName: '',
      }),
      entry({
        Id: undefined,
        AdditionalHouseholdMembers: undefined,
        Order: undefined,
        Entry: { Status: 'Submitted', DateSubmitted: '2020-01-01' },
      }),
    ]);
    expect(skipped).toEqual({ incomplete: 1, unpaid: 2, refunded: 1, noDate: 1 });
    expect(rows).toEqual([]);
  });
});

describe('membershipStatements', () => {
  let db: ReturnType<typeof sqliteD1>;
  const build = (rows: ReturnType<typeof membershipRows>['rows']) => {
    const { identities, sharedEmails } = identitiesFrom(rows);
    const r = resolveIdentities(identities, [{ id: 1, name: 'Pat Lee', emails: ['pat@example.org'] }]);
    return membershipStatements({ rows, resolved: r.resolved, alias: r.alias, sharedEmails, newStatus: 'inactive' });
  };
  const run = (sqls: string[]) => sqls.forEach((s) => db.raw.exec(s));
  const all = () => db.raw.prepare('SELECT person_id, kind, ends_on FROM membership ORDER BY id').all();

  beforeEach(() => {
    db = sqliteD1();
    db.raw.exec("INSERT INTO person (id, name) VALUES (1, 'Pat Lee');");
  });

  it('adds a year per member once, creating a new person as inactive', () => {
    const sqls = build(
      membershipRows([entry(), entry({ Id: 'e2', Entry: { Status: 'Submitted', DateSubmitted: '2023-02-01' } })]).rows
    );
    run(sqls);
    run(sqls);
    expect(all()).toHaveLength(4);
    expect(db.raw.prepare("SELECT status FROM person WHERE name = 'Sam Rivera'").get()).toEqual({ status: 'inactive' });
  });

  it('does not repeat a year the person already has, and keeps one lifetime membership', () => {
    db.raw.exec(
      "INSERT INTO membership (person_id, kind, ends_on) VALUES (1, 'annual', '2022-12-31'), (1, 'life', NULL);"
    );
    const life = entry({ Id: 'e3', TypeOfPrimaryMembership: 'Lifetime (Single)', AdditionalHouseholdMembers: [] });
    run(build(membershipRows([entry({ AdditionalHouseholdMembers: [] }), life]).rows));
    expect(all()).toHaveLength(2);
  });

  it('skips a person a decision skipped', () => {
    const { rows } = membershipRows([entry()]);
    const { identities, sharedEmails } = identitiesFrom(rows);
    const r = resolveIdentities(identities, [], { decisions: new Map([['sam rivera', 'skip']]) });
    run(membershipStatements({ rows, resolved: r.resolved, alias: r.alias, sharedEmails, newStatus: 'inactive' }));
    expect(db.raw.prepare("SELECT COUNT(*) n FROM person WHERE name = 'Sam Rivera'").get()).toEqual({ n: 0 });
  });
});
