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
    { id: 1, name: 'Camp 2025', event_type: 'weekend', year: 2025, start_date: '2025-06-14', site_id: 'camp-onas' },
    { id: 2, name: 'Camp 2026', event_type: 'weekend', year: 2026, start_date: '2026-12-20', site_id: 'camp-onas' },
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T12:00:00Z') });
  current = base();
  writes = [];
  fail = null;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = url.replace('/api/internal/engagement', '');
      const method = init?.method ?? 'GET';
      if (path === '/bootstrap') return json(current);
      writes.push({ path, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
      return fail ? json({ error: fail }, 409) : json({ id: 77 });
    })
  );
});
afterEach(async () => {
  vi.useRealTimers();
  await cleanup();
});

const open = async (hash = '#/staff?event=2&scope=class&type=Games') => {
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
const names = (c: Element) => [...c.querySelectorAll('ul > li > div > div > p > button')].map((b) => b.textContent);

describe('the brief in the address', () => {
  it('reads and writes the event, kind, type, and activity', () => {
    expect(briefFromQuery('event=2&scope=class&type=Games&activity=2')).toEqual({
      eventId: 2,
      scope: 'class',
      type: 'Games',
      activityId: 2,
    });
    expect(briefFromQuery('scope=nonsense&event=x')).toEqual({
      eventId: null,
      scope: 'any',
      type: '',
      activityId: null,
    });
    expect(briefToQuery({ eventId: 2, scope: 'class', type: 'Games', activityId: 2 })).toBe(
      'event=2&scope=class&type=Games&activity=2'
    );
    expect(briefToQuery({ eventId: null, scope: 'any', type: '', activityId: null })).toBe('');
  });
});

describe('Staff an event', () => {
  it('opens here, asks for an event and a type, and shows bench depth meanwhile', async () => {
    const c = await open('');
    expect(c.querySelector('nav [aria-current="page"]')?.textContent).toBe('Staff an event');
    expect(c.textContent).toContain('Choose an event and a type');
    expect(c.querySelector('section[aria-label="Bench depth"]')!.textContent).toContain('Dancing');
    await click(buttonWithText(c.querySelector('section[aria-label="Bench depth"]')!, /^Games/));
    expect(window.location.hash).toBe('#/staff?type=Games');
    await choose(select(c, 'Event'), '2');
    expect(window.location.hash).toBe('#/staff?event=2&type=Games');
    expect(c.textContent).toContain('3 people'.replace('3', '2')); // Cy is on hiatus
  });

  it('ranks people with reasons, and lists upcoming events first', async () => {
    const c = await open();
    expect(names(c)).toEqual(['Bo Newer', 'Ana Expert']); // a matching ready note outweighs one past class
    const text = c.textContent ?? '';
    expect(text).toContain('Led Games 1 time, last in 2025');
    expect(text).toContain('Ready for games class');
    expect(text).toContain('Led here 1 time');
    expect(select(c, 'Event').textContent!.indexOf('2026-12-20')).toBeLessThan(
      select(c, 'Event').textContent!.indexOf('2025-06-14')
    );
    expect(text).toContain('2026-12-20, Camp Onas');
  });

  it('narrows the kind and the specific activity, and clears the activity when the type changes', async () => {
    const c = await open('#/staff?event=2&type=Games');
    expect(select(c, 'A specific one').textContent).toContain('Tag');
    await choose(select(c, 'Kind'), 'activity');
    expect(window.location.hash).toContain('scope=activity');
    expect(select(c, 'A specific one').textContent).not.toContain('Games Class');
    await choose(select(c, 'A specific one'), '1');
    expect(window.location.hash).toContain('activity=1');
    await choose(select(c, 'Type'), 'Dancing');
    expect(window.location.hash).not.toContain('activity=');
    expect(c.textContent).not.toContain('A specific one');
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
    const c = await open('#/staff?event=2&type=Dancing');
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
      body: { person_id: 2, goal: 'staff_slot', status: 'suggested', event_id: 2, slot: 'Games class' },
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
        event_id: 2,
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
        event_id: 2,
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
        event_id: 2,
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
        event_id: 2,
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
        event_id: 2,
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
        event_id: 2,
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
  it('says what someone already leads at the event, and names an ask with an unusual status', async () => {
    current.outreach = [
      {
        id: 5,
        person_id: 1,
        goal: 'staff_slot',
        status: 'snoozed',
        contacted_on: null,
        snooze_until: null,
        note: null,
        event_id: 2,
        slot: 'Games class',
      },
    ];
    const c = await open();
    expect(c.textContent).toContain('Already leading Tag at this event');
    expect(c.textContent).toContain('snoozed');
  });

  it('copes with no outreach list, an unknown event, an undated event, and an unknown venue', async () => {
    current.outreach = undefined;
    current.events = [
      { id: 2, name: 'Mystery 2026', event_type: 'weekend', year: 2026, start_date: null, site_id: 'unknown-place' },
      { id: 3, name: 'Plain 2026', event_type: 'weekend', year: 2026, start_date: null, site_id: null },
    ];
    const c = await open('#/staff?event=2&type=Games');
    expect(c.textContent).toContain('2026, unknown-place');
    await choose(select(c, 'Event'), '3');
    expect(c.textContent).toMatch(/Plain\s*2026|2026 Plain/);
    expect(c.textContent).not.toContain(', unknown-place');
    await cleanup();
    const d = await open('#/staff?event=999&type=Games'); // an event that is not there
    expect(d.textContent).toContain('for Games at this event');
  });

  it('can step back from an event or a specific activity to none', async () => {
    const c = await open('#/staff?event=2&type=Games&activity=1');
    await choose(select(c, 'A specific one'), '0');
    expect(window.location.hash).not.toContain('activity=');
    await choose(select(c, 'Event'), '0');
    expect(window.location.hash).not.toContain('event=');
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
