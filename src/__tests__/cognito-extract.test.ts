import { describe, expect, it } from 'vitest';
import { ageBand, childToken, extractEntry, isChild } from '../../scripts/lib/cognito-extract.mjs';

// Synthetic data only.
const key = 'test-key';
const att = (over: Record<string, unknown> = {}) => ({
  Id: 'a1',
  Name: { First: 'Pat', Last: 'Lee', FirstAndLast: 'Pat Lee' },
  Email: ' Pat@Example.org ',
  Age_Value: 40,
  ...over,
});
const entry = (attendees: unknown[], over: Record<string, unknown> = {}) => ({
  Id: '131-7',
  Form: { Id: '131', Name: 'Test Event' },
  Entry: { Number: 7, Status: 'Submitted', DateSubmitted: '2026-01-02T00:00:00Z' },
  Order: { PaymentStatus: 'Paid' },
  Email: 'Contact@Example.org',
  AttendeeInformation: attendees,
  ...over,
});

describe('how each era marks a child', () => {
  it('reads Under18, Adult=false, AgeGroup, and age', () => {
    expect(isChild({ Under18: true })).toBe(true);
    expect(isChild({ Adult: false })).toBe(true);
    expect(isChild({ AgeGroup: 'Youth' })).toBe(true);
    expect(isChild({ AgeGroup: 'Infant' })).toBe(true);
    expect(isChild({ Age_Value: 17 })).toBe(true);
    expect(isChild({ Age: 9 })).toBe(true);
    expect(isChild({ AgeGroup: 'Adult', Age_Value: 18 })).toBe(false);
    expect(isChild({ Under18: false, Adult: true })).toBe(false);
    expect(isChild({ AgeGroup: '' })).toBe(false);
    expect(isChild({ Age: 'x' })).toBe(false);
  });

  it('bands ages coarsely', () => {
    expect([2, 6, 11, 12, 17, 18].map((a) => ageBand(a, undefined))).toEqual([
      'under 6',
      '6 to 11',
      '6 to 11',
      '12 to 17',
      '12 to 17',
      null,
    ]);
    expect([
      ageBand(undefined, 'Infant'),
      ageBand(undefined, 'Child'),
      ageBand(undefined, 'Youth'),
      ageBand(undefined, 'Adult'),
      ageBand(undefined, undefined),
    ]).toEqual(['under 6', '6 to 11', '12 to 17', null, null]);
  });
});

describe('the child token', () => {
  it('is stable, ignores case, accents, and punctuation, and depends on the key', () => {
    const t = childToken(key, 'Zoë', "O'Neil-Smith");
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(childToken(key, 'zoe', 'oneil smith')).toBe(t);
    expect(childToken('other-key', 'Zoë', "O'Neil-Smith")).not.toBe(t);
    expect(childToken(key, 'Zoe', 'Smith')).not.toBe(t);
  });
});

describe('extracting an entry', () => {
  it('keeps adults with their email, and turns children into tokens with no name', () => {
    const r = extractEntry(
      entry([
        att(),
        att({
          Id: 'a2',
          Name: { First: 'Sam', Last: 'Lee', FirstAndLast: 'Sam Lee' },
          Email: null,
          Age_Value: 7,
          AgeGroup: 'Child',
        }),
      ]),
      { key }
    );
    expect(r).toMatchObject({
      formId: '131',
      entryRef: '131-7',
      entryNumber: 7,
      status: 'Submitted',
      payment: 'Paid',
      contactEmail: 'contact@example.org',
      partyAdults: 1,
      partyChildren: 1,
    });
    expect(r.adults).toEqual([
      { ref: 'a1', first: 'Pat', last: 'Lee', email: 'pat@example.org', newcomer: null, membershipYear: null },
    ]);
    expect(r.children).toEqual([{ token: childToken(key, 'Sam', 'Lee'), band: '6 to 11' }]);
    expect(JSON.stringify(r)).not.toContain('Sam'); // the child's name appears nowhere
  });

  it('keeps only allowlisted fields, so sensitive ones are dropped', () => {
    const r = extractEntry(
      entry(
        [
          att({
            Phone: '555-0100',
            DietaryRestrictionDetails: 'nuts',
            COVID19VaccinationRecordCard: 'file',
            GenderIdentity: 'x',
            Address: 'street',
          }),
        ],
        {
          Address: { City: 'Town' },
          SpecialRequests: 'a note',
          InternalUseOnly: { BusinessManagersNotes: 'secret' },
        }
      ),
      { key }
    );
    const text = JSON.stringify(r);
    for (const leaked of ['555-0100', 'nuts', 'file', 'street', 'Town', 'a note', 'secret'])
      expect(text).not.toContain(leaked);
    expect(Object.keys(r.adults[0]).sort()).toEqual(['email', 'first', 'last', 'membershipYear', 'newcomer', 'ref']);
  });

  it('never makes a person of someone with no age and no email of their own', () => {
    const r = extractEntry(
      entry([att({ Age_Value: undefined, Email: '' }), att({ Id: 'a2', Age_Value: undefined })], {
        AttendeeInformation: undefined,
        Attendees: [att({ Age_Value: undefined, Email: '' }), att({ Id: 'a2', Age_Value: undefined })],
      }),
      { key }
    );
    expect(r.partyAdults).toBe(1);
    expect(r.partyChildren).toBe(1); // counted in the party as a possible child, never named
    expect(JSON.stringify(r)).not.toContain('"first":"Pat","last":"Lee","email":null');
  });

  it('reads the older Attendees array, newcomer flags, and membership purchases', () => {
    const r = extractEntry(
      entry([], {
        AttendeeInformation: undefined,
        Attendees: [
          att({ Newcomer: true, _2027ECRSMembership_QuantitySelected: 1, _2026ECRSMembership_QuantitySelected: 0 }),
        ],
      }),
      { key }
    );
    expect(r.adults[0]).toMatchObject({ newcomer: true, membershipYear: 2027 });
  });

  it('reads a form with one registrant at the top level, and a family group', () => {
    const one = extractEntry(
      {
        Id: '50-1',
        Form: { Id: '50' },
        Entry: { Status: 'Submitted' },
        Name: { First: 'Solo', Last: 'Guest', FirstAndLast: 'Solo Guest' },
        Email: 'Solo@Example.org',
      },
      { key }
    );
    expect(one.adults).toEqual([
      { ref: '', first: 'Solo', last: 'Guest', email: 'solo@example.org', newcomer: null, membershipYear: null },
    ]);
    const family = extractEntry(
      {
        Id: '68-1',
        FamilyGroup: [
          { Id: 'f1', Name: { First: 'Ann', Last: 'Fox', FirstAndLast: 'Ann Fox' }, Email: 'ann@example.org' },
          { Id: 'f2', Name: { First: 'Kid', Last: 'Fox', FirstAndLast: 'Kid Fox' } },
        ],
      },
      { key }
    );
    expect(family.partyAdults).toBe(1);
    expect(family.partyChildren).toBe(1); // no age and no email: counted, never named
    expect(extractEntry({ Id: '1', Name: {} }, { key }).adults).toEqual([]);
  });

  it('skips an incomplete entry, and counts an attendee with no name', () => {
    expect(extractEntry(entry([att()], { Entry: { Status: 'Incomplete' } }), { key })).toEqual({ skip: 'incomplete' });
    const r = extractEntry(entry([att(), { Id: 'x', Name: {} }]), { key });
    expect(r).toMatchObject({ partyAdults: 1, noName: 1 });
  });

  it('copes with an entry that has little in it', () => {
    const r = extractEntry({ Id: '9-1' }, { key });
    expect(r).toMatchObject({
      formId: '',
      entryRef: '9-1',
      status: null,
      payment: null,
      submittedAt: null,
      contactEmail: null,
      partyAdults: 0,
      partyChildren: 0,
    });
    expect(
      extractEntry(
        { Entry: { DateCreated: '2020-01-01' }, Attendees: [{ Name: { FirstAndLast: 'Solo Name' }, Adult: true }] },
        { key }
      ).adults[0]
    ).toMatchObject({
      first: 'Solo Name',
      last: '',
      ref: '',
    });
  });
});
