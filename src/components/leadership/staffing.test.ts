import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STAFF_FILTERS,
  DEFAULT_STAFF_WEIGHTS,
  benchDepth,
  candidatesFor,
  milesBetween,
  milesTo,
  slotLabel,
  type Brief,
} from './staffing';
import type { Data, Person, Role } from './model';

// Placeholder names only.
const person = (id: number, name: string, over: Partial<Person> = {}): Person => ({
  id,
  name,
  email: null,
  leader_slug: null,
  status: 'active',
  mentor: 0,
  notes: null,
  ...over,
});
const role = (
  id: number,
  person_id: number,
  activity_id: number,
  event_id: number,
  leadership_type: Role['leadership_type'] = 'solo'
): Role => ({
  id,
  person_id,
  activity_id,
  event_id,
  leadership_type,
  how_it_went: null,
});
const data: Data = {
  people: [
    person(1, 'Ana Expert', { mentor: 1 }),
    person(2, 'Bo Newer'),
    person(3, 'Cy Away', { status: 'hiatus' }),
    person(4, 'Di Gone', { status: 'inactive' }),
    person(5, 'Ed Blocked'),
    person(6, 'Flo Busy'),
    person(7, 'Gus Nobody'),
  ],
  activities: [
    { id: 1, name: 'Tag', scope: 'activity', type: 'Games', subtype: null },
    { id: 2, name: 'Games Class', scope: 'class', type: 'Games', subtype: null },
    { id: 3, name: 'Waltz', scope: 'class', type: 'Dancing', subtype: 'Ballroom' },
  ],
  events: [
    { id: 1, name: 'Camp 2024', event_type: 'weekend', year: 2024, start_date: '2024-06-15', site_id: 'camp-onas' },
    { id: 2, name: 'Winter 2025', event_type: 'extended', year: 2025, start_date: '2025-12-27', site_id: 'watson' },
    { id: 3, name: 'Camp 2026', event_type: 'weekend', year: 2026, start_date: '2026-06-20', site_id: 'camp-onas' },
    { id: 4, name: 'Winter 2027', event_type: 'extended', year: 2027, start_date: '2027-01-05', site_id: 'watson' },
  ],
  roles: [
    role(1, 1, 2, 1),
    role(2, 1, 2, 2),
    role(3, 1, 1, 3),
    role(4, 2, 1, 2, 'assisting'),
    role(5, 3, 2, 1),
    role(6, 4, 2, 1),
    role(7, 5, 2, 1),
    role(8, 6, 2, 1),
    role(9, 6, 3, 3), // Flo already leads Waltz at Camp 2026
  ],
  notes: [
    {
      id: 1,
      person_id: 2,
      kind: 'ready',
      focus: 'games class',
      body: 'Wants to lead',
      author: 'x',
      created_at: '2026-01-01',
    },
    { id: 2, person_id: 7, kind: 'ready', focus: 'puppets', body: '', author: 'x', created_at: '2026-01-01' },
    { id: 3, person_id: 7, kind: 'note', focus: null, body: 'not a ready note', author: 'x', created_at: '2026-01-01' },
    { id: 4, person_id: 3, kind: 'ready', focus: null, body: '', author: 'x', created_at: '2026-01-01' },
  ],
  outreach: [
    {
      id: 1,
      person_id: 5,
      goal: 'invite_back',
      status: 'do_not_contact',
      contacted_on: null,
      snooze_until: null,
      note: null,
    },
    {
      id: 2,
      person_id: 1,
      goal: 'staff_slot',
      status: 'contacted',
      contacted_on: '2026-11-10',
      snooze_until: null,
      note: null,
      event_id: 3,
      slot: 'Games class',
    },
    {
      id: 3,
      person_id: 2,
      goal: 'invite_back',
      status: 'contacted',
      contacted_on: '2025-01-01',
      snooze_until: null,
      note: null,
    },
  ],
  activityTypes: ['Dancing', 'Games', 'Music'],
};
const brief: Brief = {
  series: '',
  venue: null,
  date: null,
  eventId: 3,
  scope: 'class',
  type: 'Games',
  activityId: null,
};
const run = (b: Brief = brief, f = DEFAULT_STAFF_FILTERS, miles?: Map<number, number>) =>
  candidatesFor(data, b, DEFAULT_STAFF_WEIGHTS, f, '2026-11-20', miles);
const seg = (name: string, key: string) =>
  run()
    .find((c) => c.person.name === name)!
    .segments.find((s) => s.key === key)!;

describe('slotLabel', () => {
  it('names the slot from its parts', () => {
    expect(slotLabel(brief, data.activities)).toBe('Games class');
    expect(slotLabel({ ...brief, scope: 'activity' }, data.activities)).toBe('Games activity');
    expect(slotLabel({ ...brief, scope: 'any' }, data.activities)).toBe('Games');
    expect(slotLabel({ ...brief, activityId: 3 }, data.activities)).toBe('Waltz');
    expect(slotLabel({ ...brief, type: '' }, data.activities)).toBe('');
  });
});

describe('candidatesFor', () => {
  it('ranks by experience first, and keeps away and blocked people out unless asked', () => {
    const names = run().map((c) => c.person.name);
    expect(names[0]).toBe('Ana Expert');
    expect(names).not.toContain('Cy Away');
    expect(names).not.toContain('Di Gone');
    expect(names).not.toContain('Ed Blocked'); // asked not to be contacted
    expect(run(brief, { ...DEFAULT_STAFF_FILTERS, includeAway: true }).map((c) => c.person.name)).toEqual(
      expect.arrayContaining(['Cy Away', 'Di Gone'])
    );
  });

  it('explains experience in words, counting helping at half and a specific activity extra', () => {
    const ana = seg('Ana Expert', 'experience');
    expect(ana.detail).toBe('Led Games 2 times, last in 2025');
    expect(ana.value).toBeCloseTo(2 / 6, 5); // six times leading fills the bar
    const tag = candidatesFor(
      data,
      { ...brief, scope: 'any', activityId: 1 },
      DEFAULT_STAFF_WEIGHTS,
      DEFAULT_STAFF_FILTERS,
      '2026-11-20'
    );
    expect(tag.find((c) => c.person.name === 'Ana Expert')!.segments[0].detail).toBe(
      'Led Games 3 times, last in 2026; led Tag 1 time'
    );
    expect(seg('Bo Newer', 'experience').detail).toBe('Led Games 0 times'.replace('Led Games 0 times', ''));
    const helped = candidatesFor(
      data,
      { ...brief, scope: 'activity' },
      DEFAULT_STAFF_WEIGHTS,
      DEFAULT_STAFF_FILTERS,
      '2026-11-20'
    );
    const helpedBo = helped.find((c) => c.person.name === 'Bo Newer')!.segments[0];
    expect(helpedBo.detail).toBe('Helped with Games');
    expect(helpedBo.value).toBeCloseTo(0.5 / 6, 5);
    expect(helpedBo.value).toBeLessThan(ana.value);
  });

  it('matches a ready-for note to the slot, and says so for a different one', () => {
    expect(seg('Bo Newer', 'readiness')).toEqual({ key: 'readiness', value: 1, detail: 'Ready for games class' });
    expect(seg('Gus Nobody', 'readiness')).toEqual({ key: 'readiness', value: 0.3, detail: 'Ready for puppets' });
    expect(seg('Ana Expert', 'readiness')).toEqual({ key: 'readiness', value: 0, detail: '' });
  });

  it('copes with a ready note that has no focus', () => {
    const away = candidatesFor(
      data,
      brief,
      DEFAULT_STAFF_WEIGHTS,
      { ...DEFAULT_STAFF_FILTERS, includeAway: true },
      '2026-11-20'
    );
    expect(away.find((c) => c.person.name === 'Cy Away')!.segments[1]).toEqual({
      key: 'readiness',
      value: 0.3,
      detail: 'Ready for something else',
    });
  });

  it('reads availability from status, with mentors a little higher', () => {
    expect(seg('Ana Expert', 'availability')).toEqual({ key: 'availability', value: 1, detail: 'Mentor' });
    const away = candidatesFor(
      data,
      brief,
      DEFAULT_STAFF_WEIGHTS,
      { ...DEFAULT_STAFF_FILTERS, includeAway: true },
      '2026-11-20'
    );
    expect(away.find((c) => c.person.name === 'Cy Away')!.segments[2]).toMatchObject({
      value: 0.3,
      detail: 'On hiatus',
    });
    expect(away.find((c) => c.person.name === 'Di Gone')!.segments[2]).toMatchObject({
      value: 0.1,
      detail: 'Inactive',
    });
  });

  it('counts leading at the same venue and near the same time of year, and uses distance when known', () => {
    expect(seg('Ana Expert', 'nearness')).toMatchObject({ value: 1 / 3, detail: 'Led here 1 time' });
    expect(seg('Ana Expert', 'timing')).toMatchObject({ value: 1 / 3, detail: 'Led 1 time near this time of year' });
    const withMiles = run(brief, DEFAULT_STAFF_FILTERS, new Map([[7, 30]]));
    expect(withMiles.find((c) => c.person.name === 'Gus Nobody')!.segments[3]).toMatchObject({
      value: 0.8,
      detail: 'About 30 miles away',
    });
    // Winter wraps the new year: Dec 27 is near Jan 5
    const winter = candidatesFor(
      data,
      { ...brief, eventId: 4 },
      DEFAULT_STAFF_WEIGHTS,
      DEFAULT_STAFF_FILTERS,
      '2026-11-20'
    );
    expect(winter.find((c) => c.person.name === 'Ana Expert')!.segments[4].detail).toBe(
      'Led 1 time near this time of year'
    );
  });

  it('filters to people who have led the type, led at the venue, or mentor', () => {
    const ledOnly = run(brief, { ...DEFAULT_STAFF_FILTERS, hasLed: true }).map((c) => c.person.name);
    expect(ledOnly).toEqual(['Ana Expert', 'Flo Busy']);
    expect(run(brief, { ...DEFAULT_STAFF_FILTERS, ledHere: true }).map((c) => c.person.name)).toEqual([
      'Ana Expert',
      'Flo Busy',
    ]);
    expect(run(brief, { ...DEFAULT_STAFF_FILTERS, mentorsOnly: true }).map((c) => c.person.name)).toEqual([
      'Ana Expert',
    ]);
  });

  it('shows what someone already leads at the event, without ruling them out', () => {
    const all = run();
    expect(all.find((c) => c.person.name === 'Flo Busy')!.atEvent).toEqual(['Waltz']);
    expect(all[0].person.name).toBe('Ana Expert');
    expect(all[0].atEvent).toEqual(['Tag']);
    expect(all.find((c) => c.person.name === 'Bo Newer')!.atEvent).toEqual([]);
  });

  it('finds the ask for this event and slot, and anyone contacted lately', () => {
    const ana = run().find((c) => c.person.name === 'Ana Expert')!;
    expect(ana.ask).toMatchObject({ id: 2, status: 'contacted' });
    expect(ana.lastContacted).toBe('2026-11-10');
    const bo = run().find((c) => c.person.name === 'Bo Newer')!;
    expect(bo.ask).toBeNull();
    expect(bo.lastContacted).toBeNull(); // contacted a year and a half ago
    expect(run({ ...brief, scope: 'activity' }).find((c) => c.person.name === 'Ana Expert')!.ask).toBeNull(); // another slot
  });

  it('copes with no event yet, and with a type nobody has led', () => {
    const none = candidatesFor(
      data,
      { series: '', venue: null, date: null, eventId: null, scope: 'any', type: 'Music', activityId: null },
      DEFAULT_STAFF_WEIGHTS,
      DEFAULT_STAFF_FILTERS,
      '2026-11-20'
    );
    expect(none.every((c) => c.total >= 0)).toBe(true);
    expect(none[0].segments.find((s) => s.key === 'timing')!.value).toBe(0);
  });

  it('copes with a role whose activity or event is missing', () => {
    const odd: Data = { ...data, roles: [...data.roles, role(99, 1, 99, 1), role(98, 1, 1, 99)] };
    expect(candidatesFor(odd, brief, DEFAULT_STAFF_WEIGHTS, DEFAULT_STAFF_FILTERS, '2026-11-20')).toHaveLength(4);
  });

  it('treats a data set with no outreach at all', () => {
    const bare: Data = { ...data, outreach: undefined };
    expect(
      candidatesFor(bare, brief, DEFAULT_STAFF_WEIGHTS, DEFAULT_STAFF_FILTERS, '2026-11-20').length
    ).toBeGreaterThan(0);
  });

  it('zero weights do not divide by zero', () => {
    const zero = { experience: 0, readiness: 0, availability: 0, nearness: 0, timing: 0 };
    expect(candidatesFor(data, brief, zero, DEFAULT_STAFF_FILTERS, '2026-11-20')[0].total).toBe(0);
  });
});

describe('benchDepth', () => {
  it('counts active people who led each type lately, thinnest first', () => {
    const d = benchDepth(data, 'any', '2026-11-20');
    expect(d.map((x) => x.type)).toEqual(['Music', 'Dancing', 'Games']);
    expect(d.find((x) => x.type === 'Games')).toEqual({ type: 'Games', ready: 3, ever: 5, mentors: 1 });
    expect(d.find((x) => x.type === 'Music')).toEqual({ type: 'Music', ready: 0, ever: 0, mentors: 0 });
  });
  it('can look at classes or activities only', () => {
    expect(benchDepth(data, 'activity', '2026-11-20').find((x) => x.type === 'Games')).toMatchObject({
      ready: 1,
      ever: 1,
    });
    expect(benchDepth(data, 'class', '2026-11-20').find((x) => x.type === 'Dancing')).toMatchObject({ ready: 1 });
  });
});

describe('distance', () => {
  const venue = { lat: 40.3124, lng: -75.1046 }; // Camp Onas
  const near = { person_id: 1, city: 'Ottsville', state: 'PA', lat: 40.31, lng: -75.1 };
  const far = { person_id: 2, city: 'Boston', state: 'MA', lat: 42.36, lng: -71.06 };

  it('measures straight-line miles', () => {
    expect(milesBetween(venue, venue)).toBe(0);
    expect(milesBetween({ lat: 39.95, lng: -75.17 }, { lat: 40.71, lng: -74.0 })).toBeGreaterThan(75);
    expect(milesBetween({ lat: 39.95, lng: -75.17 }, { lat: 40.71, lng: -74.0 })).toBeLessThan(85);
  });

  it('gives a distance for each located person, and none without a venue', () => {
    expect([...milesTo([near, far], venue).keys()]).toEqual([1, 2]);
    expect(milesTo([near], undefined).size).toBe(0);
    expect(milesTo(undefined, venue).size).toBe(0);
  });

  it('says where someone is near, uses distance in the nearness score, and can limit by miles', () => {
    const located: Data = { ...data, locations: [near, far] };
    const miles = milesTo(located.locations, venue);
    const run2 = (f = DEFAULT_STAFF_FILTERS) =>
      candidatesFor(located, brief, DEFAULT_STAFF_WEIGHTS, f, '2026-11-20', miles);
    const ana = run2().find((c) => c.person.name === 'Ana Expert')!;
    expect(ana.place).toBe('Ottsville, PA');
    expect(ana.segments[3].detail).toBe('About 0 miles away (Ottsville), Led here 1 time');
    expect(ana.segments[3].value).toBeGreaterThan(0.9);
    expect(run2().find((c) => c.person.name === 'Bo Newer')!.segments[3].detail).toMatch(
      /About 2\d\d miles away \(Boston\)/
    );
    const within = run2({ ...DEFAULT_STAFF_FILTERS, maxMiles: 50 }).map((c) => c.person.name);
    expect(within).toContain('Ana Expert');
    expect(within).not.toContain('Bo Newer'); // known to live too far away
    expect(within).toContain('Gus Nobody'); // no known location: stays in
    expect(run2().find((c) => c.person.name === 'Gus Nobody')!.place).toBeNull();
  });

  it('names a place with only a state, and no place when neither is known', () => {
    const odd: Data = {
      ...data,
      locations: [
        { person_id: 1, city: null, state: 'PA', lat: 40, lng: -75 },
        { person_id: 2, city: null, state: null, lat: 40, lng: -75 },
      ],
    };
    const r = candidatesFor(odd, brief, DEFAULT_STAFF_WEIGHTS, DEFAULT_STAFF_FILTERS, '2026-11-20');
    expect(r.find((c) => c.person.name === 'Ana Expert')!.place).toBe('PA');
    expect(r.find((c) => c.person.name === 'Bo Newer')!.place).toBeNull();
  });
});

describe('expert marks and a long record', () => {
  const marked = (type: string): Data => ({
    ...data,
    expertise: [{ id: 1, person_id: 2, type, note: null }],
  });
  const exp = (d: Data, name: string) =>
    candidatesFor(d, brief, DEFAULT_STAFF_WEIGHTS, DEFAULT_STAFF_FILTERS, '2026-11-20').find(
      (c) => c.person.name === name
    )!;

  it('fills the experience bar for an expert, whatever the records say', () => {
    const bo = exp(marked('Games'), 'Bo Newer');
    expect(bo.segments[0]).toEqual({ key: 'experience', value: 1, detail: 'Marked an expert in Games' });
    expect(bo.expert).toMatchObject({ id: 1 });
    expect(exp(data, 'Bo Newer').expert).toBeNull();
  });

  it('keeps the records in the explanation when an expert also has them', () => {
    const d = { ...marked('Games'), expertise: [{ id: 1, person_id: 1, type: 'Games', note: null }] };
    expect(exp(d, 'Ana Expert').segments[0].detail).toBe('Marked an expert in Games. Led Games 2 times, last in 2025');
  });

  it('only counts a mark for the type being staffed', () => {
    expect(exp(marked('Dancing'), 'Bo Newer').segments[0].value).toBeLessThan(1);
    expect(exp(marked('Dancing'), 'Bo Newer').expert).toBeNull();
  });

  it('fills the bar after six times leading, and breaks a tie by who has done more', () => {
    const many: Data = {
      ...data,
      roles: Array.from({ length: 8 }, (_, i) => role(100 + i, 7, 2, (i % 2) + 1)),
    };
    const gus = candidatesFor(many, brief, DEFAULT_STAFF_WEIGHTS, DEFAULT_STAFF_FILTERS, '2026-11-20').find(
      (c) => c.person.name === 'Gus Nobody'
    )!;
    expect(gus.segments[0].value).toBe(1);
    const tie: Data = {
      ...data,
      roles: [...many.roles, ...Array.from({ length: 10 }, (_, i) => role(200 + i, 1, 2, (i % 2) + 1))],
    };
    const order = candidatesFor(
      tie,
      brief,
      { experience: 4, readiness: 0, availability: 0, nearness: 0, timing: 0 },
      DEFAULT_STAFF_FILTERS,
      '2026-11-20'
    ).map((c) => c.person.name);
    expect(order.indexOf('Ana Expert')).toBeLessThan(order.indexOf('Gus Nobody')); // both full; Ana has more
  });

  it('plans for an event that is not on the calendar yet, from its date and venue', () => {
    const b: Brief = {
      series: 'Camping Weekend',
      venue: 'camp-onas',
      date: '2027-06-18',
      eventId: null,
      scope: 'class',
      type: 'Games',
      activityId: null,
    };
    const r = candidatesFor(data, b, DEFAULT_STAFF_WEIGHTS, DEFAULT_STAFF_FILTERS, '2026-11-20');
    const ana = r.find((c) => c.person.name === 'Ana Expert')!;
    expect(ana.segments[3].detail).toBe('Led here 1 time');
    expect(ana.segments[4].detail).toBe('Led 1 time near this time of year');
    expect(ana.ask).toBeNull();
    expect(ana.atEvent).toEqual([]);
  });
});
