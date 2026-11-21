// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { buttonWithText, click, cleanup, render, settle } from '../../__tests__/react';
import LeadershipApp from './LeadershipApp';
import { briefFromQuery, briefToQuery } from './StaffView';
import type { Data } from './model';

// Placeholder names only.
const person = (id: number, name: string, over = {}) => ({
  id,
  name,
  email: null,
  leader_slug: null,
  status: 'active' as const,
  mentor: 0,
  notes: null,
  ...over,
});
const base = (): Data => ({
  me: 'me@example.org',
  level: 'standard',
  isAdmin: false,
  people: [person(1, 'Ana Expert', { mentor: 1 }), person(2, 'Bo Newer'), person(3, 'Cy Away', { status: 'hiatus' })],
  activities: [
    { id: 1, name: 'Tag', scope: 'activity', type: 'Games', subtype: null },
    { id: 2, name: 'Games Class', scope: 'class', type: 'Games', subtype: null },
  ],
  events: [
    {
      id: 1,
      name: 'Camping Weekend 2025',
      event_type: 'weekend',
      year: 2025,
      start_date: '2025-06-14',
      site_id: 'camp-onas',
    },
    {
      id: 2,
      name: 'Camping Weekend 2026',
      event_type: 'weekend',
      year: 2026,
      start_date: '2026-12-20',
      site_id: 'camp-onas',
    },
    {
      id: 3,
      name: 'Winter Adventure 2025',
      event_type: 'extended',
      year: 2025,
      start_date: '2025-12-27',
      site_id: 'the-y-at-watson-woods',
    },
  ],
  roles: [
    { id: 1, person_id: 1, activity_id: 2, event_id: 1, leadership_type: 'solo', how_it_went: null },
    { id: 2, person_id: 3, activity_id: 2, event_id: 1, leadership_type: 'partner', how_it_went: null },
    { id: 3, person_id: 1, activity_id: 1, event_id: 2, leadership_type: 'solo', how_it_went: null },
  ],
  notes: [
    { id: 1, person_id: 2, kind: 'ready', focus: 'games class', body: '', author: 'x', created_at: '2026-01-01' },
  ],
  service: [],
  volunteers: [],
  outreach: [],
  activityTypes: ['Dancing', 'Games'],
});

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
let current: Data;
let writes: { path: string; method: string; body?: Record<string, unknown> }[];
let fail: string | null;
let failPath: string | null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T12:00:00Z') });
  current = base();
  writes = [];
  fail = null;
  failPath = null;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = url.replace('/api/internal/engagement', '');
      const method = init?.method ?? 'GET';
      if (path === '/bootstrap') return json(current);
      writes.push({ path, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
      return fail && (!failPath || path.startsWith(failPath)) ? json({ error: fail }, 409) : json({ id: 77 });
    })
  );
});
afterEach(async () => {
  vi.useRealTimers();
  await cleanup();
});

const open = async (hash = '#/staff?venue=camp-onas&scope=class&type=Games') => {
  window.history.replaceState(null, '', `/${hash}`);
  const c = await render(<LeadershipApp />);
  await settle();
  return c.container;
};
const choose = (el: Element, value: string) =>
  act(async () => {
    (el as HTMLSelectElement).value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
const select = (c: Element, label: string) =>
  [...c.querySelectorAll('label')].find((l) => l.textContent?.startsWith(label))!.querySelector('select')!;
const input = (c: Element, label: string) =>
  [...c.querySelectorAll('label')].find((l) => l.textContent?.startsWith(label))!.querySelector('input')!;
const names = (c: Element) => [...c.querySelectorAll('ul > li > div > div > p > button')].map((b) => b.textContent);

describe('the brief in the address', () => {
  it('reads and writes the venue, date, kind, and type', () => {
    const full = {
      venue: 'camp-onas',
      date: '2026-12-20',
      scope: 'class' as const,
      type: 'Games',
    };
    const query = 'venue=camp-onas&date=2026-12-20&scope=class&type=Games';
    expect(briefFromQuery(query)).toEqual(full);
    expect(briefToQuery(full)).toBe(query);
    expect(briefFromQuery('scope=nonsense&event=2&date=soon')).toEqual({
      venue: null,
      date: null,
      scope: 'any',
      type: '',
    });
    expect(briefToQuery(briefFromQuery(''))).toBe('');
  });
});

describe('Staff an event', () => {
  it('opens here, asks for a venue and a type, and shows bench depth meanwhile', async () => {
    const c = await open('');
    expect(c.querySelector('nav [aria-current="page"]')?.textContent).toBe('Staff an event');
    expect(c.textContent).toContain('Choose a venue and a type');
    expect(c.querySelector('section[aria-label="Bench depth"]')!.textContent).toContain('Dancing');
    await click(buttonWithText(c.querySelector('section[aria-label="Bench depth"]')!, /^Games/));
    expect(window.location.hash).toBe('#/staff?type=Games');
    await choose(select(c, 'Where'), 'camp-onas');
    expect(window.location.hash).toBe('#/staff?venue=camp-onas&type=Games');
    expect(c.textContent).toContain('2 people'); // Cy is on hiatus
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(c, 'When'), '2026-12-20');
      input(c, 'When').dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(window.location.hash).toBe('#/staff?venue=camp-onas&date=2026-12-20&type=Games');
    expect(c.textContent).toContain('for Games at Camp Onas on 2026-12-20');
  });

  it('ranks people with reasons, from the venue and the date', async () => {
    const c = await open();
    expect(names(c)).toEqual(['Bo Newer', 'Ana Expert']); // a matching ready note outweighs one past class
    const text = c.textContent ?? '';
    expect(text).toContain('Led Games 1 time, last in 2025');
    expect(text).toContain('Said they are ready to lead games class');
    expect(text).toContain('Led here 1 time');
    expect(c.querySelector('label select option[value="__new"]')).not.toBeNull(); // a venue can be added
    expect(select(c, 'Where').value).toBe('camp-onas');
    expect(c.textContent).not.toContain('recurring');
  });

  it('narrows the kind, and shows the slot in words', async () => {
    const c = await open('#/staff?venue=camp-onas&type=Games');
    expect(c.textContent).not.toContain('Subtype');
    await choose(select(c, 'Kind'), 'activity');
    expect(window.location.hash).toContain('scope=activity');
    expect(c.textContent).toContain('for Games activity at Camp Onas');
  });

  it('filters, includes people away, and edits the weights', async () => {
    const c = await open();
    await click(buttonWithText(c, 'Include hiatus and inactive'));
    expect(names(c)).toContain('Cy Away');
    await click(buttonWithText(c, 'Mentors only'));
    expect(names(c)).toEqual(['Ana Expert']);
    await click(buttonWithText(c, 'Mentors only'));
    await click(buttonWithText(c, 'Has led this type'));
    expect(names(c)).not.toContain('Bo Newer');
    await click(buttonWithText(c, 'Has led at this venue'));
    const input = c.querySelector('details input[type="number"]') as HTMLInputElement;
    const before = c.textContent;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '0');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(c.textContent).not.toBe(before);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '99'); // out of range: ignored
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.value).toBe('0');
  });

  it('says when no one matches, and offers all of a long list', async () => {
    const c = await open('#/staff?venue=camp-onas&type=Dancing');
    await click(buttonWithText(c, 'Has led this type'));
    expect(c.textContent).toContain('No one matches');
    await cleanup();
    const many = base();
    many.people = Array.from({ length: 20 }, (_, i) => person(i + 1, `Person ${String(i + 1).padStart(2, '0')}`));
    many.roles = [];
    many.notes = [];
    current = many;
    const d = await open();
    expect(d.querySelectorAll('ul > li > div > div > p > button')).toHaveLength(15);
    await click(buttonWithText(d, 'Show all 20'));
    expect(d.querySelectorAll('ul > li > div > div > p > button')).toHaveLength(20);
  });
});

describe('the slate', () => {
  it('shortlists someone for this slot, and shows a person already shortlisted', async () => {
    const c = await open();
    await click([...c.querySelectorAll('button')].find((b) => b.textContent === 'Shortlist') ?? null);
    expect(writes.at(-1)).toEqual({
      path: '/outreach',
      method: 'POST',
      body: {
        person_id: 2,
        goal: 'staff_slot',
        status: 'suggested',
        venue_id: 'camp-onas',
        plan_date: null,
        slot: 'Games class',
      },
    });
    current.outreach = [
      {
        id: 5,
        person_id: 2,
        goal: 'staff_slot',
        status: 'suggested',
        contacted_on: null,
        snooze_until: null,
        note: null,
        venue_id: 'camp-onas',
        slot: 'Games class',
      },
    ];
    await cleanup();
    const d = await open();
    expect(d.querySelector('section[aria-label="Slate"]')!.textContent).toContain('Bo Newer');
    expect(d.textContent).toContain('On the shortlist');
  });

  it('moves an ask along: asked, yes, no, and removes it', async () => {
    current.outreach = [
      {
        id: 5,
        person_id: 1,
        goal: 'staff_slot',
        status: 'suggested',
        contacted_on: null,
        snooze_until: null,
        note: null,
        venue_id: 'camp-onas',
        slot: 'Games class',
      },
      {
        id: 6,
        person_id: 2,
        goal: 'staff_slot',
        status: 'contacted',
        contacted_on: '2026-11-10',
        snooze_until: null,
        note: null,
        venue_id: 'camp-onas',
        slot: 'Games class',
      },
      {
        id: 7,
        person_id: 3,
        goal: 'staff_slot',
        status: 'accepted',
        contacted_on: '2026-11-01',
        snooze_until: null,
        note: null,
        venue_id: 'camp-onas',
        slot: 'Games class',
      },
      {
        id: 8,
        person_id: 99,
        goal: 'staff_slot',
        status: 'declined',
        contacted_on: null,
        snooze_until: null,
        note: null,
        venue_id: 'camp-onas',
        slot: 'Games class',
      },
      {
        id: 9,
        person_id: 1,
        goal: 'staff_slot',
        status: 'suggested',
        contacted_on: null,
        snooze_until: null,
        note: null,
        venue_id: 'camp-onas',
        slot: 'Dance class',
      }, // another slot
    ];
    const c = await open();
    const slate = c.querySelector('section[aria-label="Slate"]')!;
    expect(slate.textContent).toContain('Someone'); // a person no longer in the list
    expect(slate.textContent).not.toContain('Dance class');
    await click(buttonWithText(slate, 'Mark asked'));
    expect(writes.at(-1)).toMatchObject({
      path: '/outreach/5',
      method: 'PUT',
      body: { status: 'contacted', contacted_on: '2026-11-20', slot: 'Games class' },
    });
    await click(buttonWithText(slate, 'Said yes'));
    expect(writes.at(-1)).toMatchObject({
      path: '/outreach/6',
      body: { status: 'accepted', contacted_on: '2026-11-10' },
    });
    await click(buttonWithText(slate, 'Said no'));
    expect(writes.at(-1)).toMatchObject({ path: '/outreach/6', body: { status: 'declined' } });
    await click(slate.querySelector('[aria-label="Remove Ana Expert from the slate"]'));
    expect(writes.at(-1)).toMatchObject({ path: '/outreach/5', method: 'DELETE' });
    await click(buttonWithText(slate, 'Record the role'));
    await settle();
    expect(window.location.hash).toBe('#/events');
  });

  it('shows why an ask failed', async () => {
    const c = await open();
    fail = 'already exists';
    await click([...c.querySelectorAll('button')].find((b) => b.textContent === 'Shortlist') ?? null);
    expect(c.textContent).toContain('already exists');
  });

  it('opens a person, and tells who was contacted lately', async () => {
    current.outreach = [
      {
        id: 3,
        person_id: 2,
        goal: 'invite_back',
        status: 'contacted',
        contacted_on: '2026-11-02',
        snooze_until: null,
        note: null,
      },
    ];
    const c = await open();
    expect(c.textContent).toContain('Contacted 2026-11-02');
    await click(buttonWithText(c, 'Bo Newer'));
    await settle();
    expect(window.location.hash).toBe('#/people/2');
  });
});

describe('bench depth', () => {
  it('flags thin types and counts mentors', async () => {
    const c = await open();
    const bench = c.querySelector('section[aria-label="Bench depth"]')!.textContent;
    expect(bench).toContain('1 of 2, 1 mentor');
    expect(bench).toContain('thin');
  });
});

describe('odd data', () => {
  it('names an ask with an unusual status', async () => {
    current.outreach = [
      {
        id: 5,
        person_id: 1,
        goal: 'staff_slot',
        status: 'snoozed',
        contacted_on: null,
        snooze_until: null,
        note: null,
        venue_id: 'camp-onas',
        slot: 'Games class',
      },
    ];
    const c = await open();
    expect(c.textContent).toContain('snoozed');
  });

  it('copes with no outreach list, an unknown venue, and no venue at all', async () => {
    current.outreach = undefined;
    current.events = [
      {
        id: 2,
        name: 'Mystery Weekend 2026',
        event_type: 'weekend',
        year: 2026,
        start_date: '2026-12-01',
        site_id: 'unknown-place',
      },
    ];
    const c = await open('#/staff?venue=unknown-place&type=Games');
    expect([...select(c, 'Where').options].map((o) => o.textContent)).toContain('unknown-place');
    expect(c.textContent).toContain('for Games at unknown-place');
    await cleanup();
    const d = await open('#/staff?type=Games');
    expect(d.textContent).toContain('Choose a venue and a type');
  });

  it('can step back from a venue', async () => {
    const c = await open('#/staff?venue=camp-onas&type=Games');
    await choose(select(c, 'Where'), '');
    expect(window.location.hash).not.toContain('venue=');
  });

  it('shows a healthy bench in the normal color and pluralizes mentors', async () => {
    current.people = Array.from({ length: 4 }, (_, i) => person(i + 1, `Leader ${i + 1}`, { mentor: i < 2 ? 1 : 0 }));
    current.roles = current.people.map((p, i) => ({
      id: i + 1,
      person_id: p.id,
      activity_id: 2,
      event_id: 1,
      leadership_type: 'solo' as const,
      how_it_went: null,
    }));
    const c = await open();
    const bench = c.querySelector('section[aria-label="Bench depth"]')!;
    expect(bench.textContent).toContain('4 of 4, 2 mentors');
    expect(bench.innerHTML).not.toContain('bg-amber-500" style="width: 100%');
  });
});

describe('distance', () => {
  beforeEach(() => {
    current.locations = [
      { person_id: 1, city: 'Ottsville', state: 'PA', lat: 40.31, lng: -75.1 },
      { person_id: 2, city: 'Boston', state: 'MA', lat: 42.36, lng: -71.06 },
    ];
  });
  it('shows where people are near, and limits the list by miles', async () => {
    const c = await open();
    expect(c.textContent).toContain('Near Ottsville, PA');
    expect(c.textContent).toContain('About 0 miles away (Ottsville)');
    expect(c.textContent).toContain('of Camp Onas. People with no known location stay in.');
    expect(names(c)).toContain('Bo Newer');
    await choose(select(c, 'Live within'), '50');
    expect(names(c)).not.toContain('Bo Newer');
    expect(names(c)).toContain('Ana Expert');
    await choose(select(c, 'Live within'), '0');
    expect(names(c)).toContain('Bo Newer');
  });
  it('offers no distance when nobody is located or the venue is unknown', async () => {
    current.locations = [];
    const c = await open();
    expect(c.textContent).not.toContain('Live within');
    await cleanup();
    current.locations = [{ person_id: 1, city: 'Ottsville', state: 'PA', lat: 40.31, lng: -75.1 }];
    const d = await open('#/staff?venue=unknown-place&type=Games');
    expect(d.textContent).not.toContain('Live within');
  });
});

describe('planning for a venue', () => {
  const pickWatson = async (c: Element) => {
    await choose(select(c, 'Where'), 'the-y-at-watson-woods');
    await choose(select(c, 'Type'), 'Games');
    await choose(select(c, 'Kind'), 'class');
  };
  const shortlistFirst = (c: Element) =>
    click([...c.querySelectorAll('button')].find((b) => b.textContent === 'Shortlist') ?? null);
  const setDate = async (c: Element, value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(c, 'When'), value);
      input(c, 'When').dispatchEvent(new Event('input', { bubbles: true }));
    });

  it('needs only a venue and a type, and no event is involved', async () => {
    const c = await open('#/staff');
    await pickWatson(c);
    expect(names(c).length).toBeGreaterThan(0);
    expect(c.textContent).not.toContain('calendar');
    expect(window.location.hash).toBe('#/staff?venue=the-y-at-watson-woods&scope=class&type=Games');
  });

  it('shortlists by venue and slot, without creating an event', async () => {
    const c = await open('#/staff');
    await pickWatson(c);
    await shortlistFirst(c);
    expect(writes.filter((w) => w.path === '/event')).toEqual([]);
    expect(writes.at(-1)).toEqual({
      path: '/outreach',
      method: 'POST',
      body: {
        person_id: expect.any(Number),
        goal: 'staff_slot',
        status: 'suggested',
        venue_id: 'the-y-at-watson-woods',
        plan_date: null,
        slot: 'Games class',
      },
    });
  });

  it('keeps the planned date on the ask, and shows only asks for that venue, date, and slot', async () => {
    current.outreach = [
      {
        id: 5,
        person_id: 2,
        goal: 'staff_slot',
        status: 'suggested',
        contacted_on: null,
        snooze_until: null,
        note: null,
        venue_id: 'the-y-at-watson-woods',
        plan_date: '2027-01-02',
        slot: 'Games class',
      },
      {
        id: 6,
        person_id: 1,
        goal: 'staff_slot',
        status: 'suggested',
        contacted_on: null,
        snooze_until: null,
        note: null,
        venue_id: 'the-y-at-watson-woods',
        plan_date: null,
        slot: 'Games class',
      },
    ];
    const c = await open('#/staff');
    await pickWatson(c);
    await setDate(c, '2027-01-02');
    const slate = c.querySelector('section[aria-label="Slate"]')!.textContent;
    expect(slate).toContain('Bo Newer');
    expect(slate).not.toContain('Ana Expert');
    await shortlistFirst(c);
    expect(writes.at(-1)!.body).toMatchObject({ plan_date: '2027-01-02' });
  });

  it('reports why a shortlist failed', async () => {
    const c = await open('#/staff');
    await pickWatson(c);
    fail = 'already exists';
    await shortlistFirst(c);
    expect(c.textContent).toContain('already exists');
  });

  it('follows a change of date or venue', async () => {
    const c = await open('#/staff?venue=camp-onas&type=Games');
    await choose(select(c, 'Where'), 'the-y-at-watson-woods');
    expect(window.location.hash).toContain('venue=the-y-at-watson-woods');
    await setDate(c, '2027-01-02');
    expect(window.location.hash).toContain('date=2027-01-02');
    await setDate(c, '');
    expect(window.location.hash).not.toContain('date=');
  });
});

describe('adding a venue', () => {
  const fill = async (c: Element, name: string, address: string) => {
    const [n, z] = [...c.querySelectorAll('form input')] as HTMLInputElement[];
    for (const [el, v] of [
      [n, name],
      [z, address],
    ] as const)
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
  };

  it('adds a venue from a name and an address, then chooses it', async () => {
    const c = await open();
    await choose(select(c, 'Where'), '__new');
    expect(buttonWithText(c, 'Add venue')!.disabled).toBe(true);
    await fill(c, ' New Place ', ' 609 Geigel Hill Rd, Ottsville, PA ');
    await click(buttonWithText(c, 'Add venue'));
    expect(writes.at(-1)).toEqual({
      path: '/venue',
      method: 'POST',
      body: { name: 'New Place', address: '609 Geigel Hill Rd, Ottsville, PA' },
    });
    await settle();
    expect(c.querySelector('form')).toBeNull();
    expect(window.location.hash).toContain('venue=77');
  });

  it('shows why it could not be added, and can be cancelled', async () => {
    const c = await open();
    await choose(select(c, 'Where'), '__new');
    await fill(c, 'X', 'Nowhere Lane');
    fail = 'That address could not be found.';
    await click(buttonWithText(c, 'Add venue'));
    expect(c.textContent).toContain('address could not be found');
    expect(c.querySelector('form')).not.toBeNull();
    await click(buttonWithText(c, 'Cancel'));
    expect(c.querySelector('form')).toBeNull();
  });

  it('lists venues added in the tool, and uses their place for distance', async () => {
    current.venues = [{ id: 'my-place', name: 'My Place', city: 'Ottsville', state: 'PA', lat: 40.3, lng: -75.1 }];
    current.locations = [{ person_id: 1, city: 'Ottsville', state: 'PA', lat: 40.31, lng: -75.1 }];
    const c = await open('#/staff?venue=my-place&date=2027-06-18&type=Games');
    expect([...select(c, 'Where').options].map((o) => o.textContent)).toContain('My Place');
    expect(c.textContent).toContain('Live within');
    expect(c.textContent).toContain('of My Place.');
  });
});

describe('experts', () => {
  it('marks someone an expert in the type, and takes the mark back', async () => {
    const c = await open();
    await click(buttonWithText(c, 'Mark as an expert in Games'));
    expect(writes.at(-1)).toEqual({ path: '/expertise', method: 'POST', body: { person_id: 2, type: 'Games' } });
    current.expertise = [{ id: 4, person_id: 2, type: 'Games', note: null }];
    await cleanup();
    const d = await open();
    expect(d.textContent).toContain('Marked an expert in Games');
    await click(buttonWithText(d, 'Remove expert mark for Games'));
    expect(writes.at(-1)).toMatchObject({ path: '/expertise/4', method: 'DELETE' });
  });
});

describe('odd links', () => {
  it('copes with a venue no one knows', async () => {
    const c = await open('#/staff?venue=nowhere&date=2027-03-01&type=Games');
    expect(window.location.hash).toContain('venue=nowhere');
    await click([...c.querySelectorAll('button')].find((b) => b.textContent === 'Shortlist') ?? null);
    expect(writes.at(-1)!.body).toMatchObject({ venue_id: 'nowhere', plan_date: '2027-03-01' });
  });
});

describe('what someone has led, on the card', () => {
  it('opens a list of titles for the type, and can show everything they led', async () => {
    current.roles.push({
      id: 9,
      person_id: 1,
      activity_id: 3,
      event_id: 1,
      leadership_type: 'assisting',
      how_it_went: null,
    });
    current.roles.push({
      id: 10,
      person_id: 1,
      activity_id: 3,
      event_id: 2,
      leadership_type: 'assisting',
      how_it_went: null,
    });
    current.roles.push({
      id: 11,
      person_id: 1,
      activity_id: 4,
      event_id: 1,
      leadership_type: 'solo',
      how_it_went: null,
    });
    current.roles.push({
      id: 12,
      person_id: 1,
      activity_id: 4,
      event_id: 2,
      leadership_type: 'partner',
      how_it_went: null,
    });
    current.activities.push({ id: 3, name: 'Waltz', scope: 'class', type: 'Dancing', subtype: null });
    current.activities.push({ id: 4, name: 'Foxtrot', scope: 'class', type: 'Dancing', subtype: null });
    const c = await open();
    const ana = [...c.querySelectorAll('li')].find((l) => l.textContent?.includes('Ana Expert'))!;
    const summary = ana.querySelector('details summary')!;
    expect(summary.textContent).toContain('What they have led (2 in Games, 4 in all)');
    expect(ana.textContent).toContain('Games Class');
    expect(ana.textContent).toContain('led once, last in 2025');
    expect(ana.textContent).not.toContain('Waltz');
    await click(buttonWithText(ana, 'Show all 4'));
    expect(ana.textContent).toContain('Waltz');
    expect(ana.textContent).toContain('Dancing');
    expect(ana.textContent).toContain('helped 2 times, last in 2026');
    expect(ana.textContent).toContain('Foxtrot');
    expect(ana.textContent).toContain('led 2 times, last in 2026');
    await click(buttonWithText(ana, 'Only Games'));
    expect(ana.textContent).not.toContain('Waltz');
  });

  it('says so when someone has nothing in the type, and shows nothing for someone with no history', async () => {
    const c = await open('#/staff?venue=camp-onas&type=Dancing');
    await click(buttonWithText(c, 'Include hiatus and inactive'));
    const cy = [...c.querySelectorAll('li')].find((l) => l.textContent?.includes('Cy Away'))!;
    expect(cy.querySelector('details')!.textContent).toContain('Nothing in Dancing');
    await cleanup();
    current.roles = [];
    const d = await open();
    expect(d.querySelector('li details')).toBeNull();
  });
});
