// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, cleanup, render, settle } from '../../__tests__/react';
import LeadershipApp from './LeadershipApp';
import { DEFAULT_WEIGHTS, LISTS, factsFor, listQuery, scoreFor, type Data, type EngagementRow } from './model';

// Placeholder names only.
const base: Data = {
  me: 'board@example.org',
  level: 'standard',
  isAdmin: false,
  people: [
    { id: 1, name: 'Person A', email: null, leader_slug: null, status: 'inactive', mentor: 0, notes: null },
    { id: 2, name: 'Person B', email: null, leader_slug: null, status: 'active', mentor: 1, notes: null },
  ],
  activities: [],
  events: [],
  roles: [],
  notes: [],
  service: [],
  volunteers: [],
  outreach: [
    {
      id: 5,
      person_id: 2,
      goal: 'invite_back',
      status: 'contacted',
      contacted_on: '2026-11-02',
      snooze_until: null,
      note: null,
    },
  ],
  activityTypes: [],
};
const rowOf = (over: Partial<EngagementRow> = {}): EngagementRow => ({
  person_id: 1,
  name: 'Person A',
  status: 'inactive',
  mentor: 0,
  events_registered: 4,
  events_attended: 0,
  last_event_year: 2023,
  roles_led: 0,
  roles_total: 0,
  last_led_year: null,
  volunteer_count: 0,
  member_now: 0,
  serving_now: 0,
  gift_count: 0,
  giving_tier: 'No gifts',
  last_contacted_on: null,
  do_not_contact: 0,
  ...over,
});

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

let queries: string[];
let writes: { path: string; method: string; body?: Record<string, unknown> }[];
let current: Data;
let answer: (query: string) => Promise<Response>;
let fail: { status: number; error: string } | null;

const page = (people: EngagementRow[], total = people.length, offset = 0) => json({ people, total, limit: 25, offset });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T12:00:00Z') });
  queries = [];
  writes = [];
  fail = null;
  current = structuredClone(base);
  answer = () =>
    page([
      rowOf(),
      rowOf({
        person_id: 2,
        name: 'Person B',
        status: 'active',
        mentor: 1,
        events_registered: 1,
        last_event_year: 2022,
      }),
    ]);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = url.replace('/api/internal/engagement', '');
      const method = init?.method ?? 'GET';
      if (path === '/bootstrap') return json(current);
      if (path.startsWith('/engagement?')) {
        queries.push(path.slice('/engagement?'.length));
        return answer(path.slice('/engagement?'.length));
      }
      if (path.startsWith('/timeline/'))
        return json({ person: { id: 1, name: 'x' }, giving: { tier: 'No gifts' }, items: [] });
      writes.push({ path, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (fail) return json({ error: fail.error }, fail.status);
      if (path === '/outreach' && method === 'POST') {
        const o = JSON.parse(init!.body as string);
        current.outreach!.push({
          id: 90 + current.outreach!.length,
          note: null,
          contacted_on: null,
          snooze_until: null,
          ...o,
        });
        return json({ id: 90 }, 201);
      }
      return json({ ok: true });
    })
  );
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const buttons = (r: Element) => [...r.querySelectorAll('button')];
const button = (r: Element, label: string) =>
  buttons(r).find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === label) ?? null;
const params = (q: string) => Object.fromEntries(new URLSearchParams(q));
const last = () => params(queries.at(-1)!);
async function open() {
  const { container } = await render(<LeadershipApp />);
  await settle();
  await click(button(container, 'Outreach'));
  await settle();
  return container;
}
async function setNumber(el: HTMLInputElement | null, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el!, value);
    el!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}
const pick = async (c: Element, label: string) => {
  await click(button(c, label));
  await settle();
};

describe('what each list asks for', () => {
  const q = (id: string, values = {}) =>
    params(
      listQuery(
        LISTS.find((l) => l.id === id)!,
        values,
        new Date('2026-11-20T12:00:00Z')
      )
    );

  it('invite back: regulars who have been away, not contacted lately', () => {
    expect(q('back')).toMatchObject({
      min_events: '2',
      max_last_event_year: '2024',
      not_contacted_since: '2026-05-24',
      exclude_do_not_contact: '1',
      exclude_snoozed: '1',
      sort: 'events_registered',
      dir: 'desc',
    });
  });

  it('invite to lead: never led, came recently, optionally with a ready note', () => {
    expect(q('lead')).toMatchObject({ min_events: '3', max_roles_led: '0', min_last_event_year: '2023' });
    expect(q('lead')).not.toHaveProperty('has_ready');
    expect(q('lead', { readyOnly: true, minEvents: 5, recentYears: 1 })).toMatchObject({
      has_ready: '1',
      min_events: '5',
      min_last_event_year: '2025',
    });
  });

  it('committee and board: not serving, and by default has led before', () => {
    expect(q('committee')).toMatchObject({ serving: '0', min_events: '4', min_roles_led: '1' });
    expect(q('committee')).not.toHaveProperty('member');
    expect(q('committee', { mustHaveLed: false, membersOnly: true })).toMatchObject({ member: '1' });
    expect(q('committee', { mustHaveLed: false })).not.toHaveProperty('min_roles_led');
  });

  it('thank donors: anyone with a gift, with no waiting period', () => {
    const d = q('donors');
    expect(d).toMatchObject({ min_tier: '1', sort: 'giving_tier', dir: 'desc', exclude_do_not_contact: '1' });
    expect(d).not.toHaveProperty('not_contacted_since');
    expect(params(listQuery(LISTS[0], {}, new Date('2026-11-20T12:00:00Z'), 25)).offset).toBe('25');
  });
});

describe('donor stewardship lists', () => {
  const q = (id: string, values = {}) =>
    params(
      listQuery(
        LISTS.find((l) => l.id === id)!,
        values,
        new Date('2026-11-20T12:00:00Z')
      )
    );
  it('first-time donors gave exactly once, within the window, with no waiting period', () => {
    const p = q('firstgift');
    expect(p).toMatchObject({ min_gift_count: '1', max_gift_count: '1', min_last_gift_year: '2025' });
    expect(p.not_contacted_since).toBeUndefined();
    expect(q('firstgift', { recentYears: 3 }).min_last_gift_year).toBe('2023');
  });
  it('lapsed donors gave before but not within the window', () => {
    expect(q('lapsed')).toMatchObject({ min_gift_count: '1', max_last_gift_year: '2024', sort: 'giving_tier' });
  });
});

describe('the optional score', () => {
  it('adds up visible points and explains each one', () => {
    const r = rowOf({ events_registered: 3, events_attended: 2, roles_led: 1, member_now: 1, giving_tier_rank: 2 });
    const { total, parts } = scoreFor(r, DEFAULT_WEIGHTS, 2026);
    expect(total).toBe(3 + 2 + 3 + 3 + 4);
    expect(parts.map((x) => x.label)).toEqual(['3 registered', '2 attended', '1 led', 'member', 'giving']);
    expect(scoreFor(rowOf({ events_registered: 0, last_event_year: null }), DEFAULT_WEIGHTS, 2026).total).toBe(0);
    expect(scoreFor(rowOf({ events_registered: 0, last_event_year: 2025 }), DEFAULT_WEIGHTS, 2026).total).toBe(3);
  });
});

describe('the facts behind a row', () => {
  it('says each thing in words, and nothing that is empty', () => {
    expect(factsFor(rowOf())).toEqual(['Registered for 4 events, last in 2023', 'Never led']);
    expect(
      factsFor(
        rowOf({
          events_registered: 1,
          last_event_year: null,
          events_attended: 2,
          roles_led: 3,
          last_led_year: 2024,
          volunteer_count: 1,
          member_now: 1,
          serving_now: 2,
          gift_count: 2,
          giving_tier: 'Medium',
          last_contacted_on: '2026-11-02',
        })
      )
    ).toEqual([
      'Registered for 1 event',
      'Attended 2',
      'Led 3, last in 2024',
      'Helped 1 time',
      'Member',
      'Serving now',
      'Giving: Medium',
      'Last contacted Nov 2, 2026',
    ]);
    expect(
      factsFor(
        rowOf({
          events_registered: 0,
          roles_led: 1,
          last_led_year: null,
          gift_count: 1,
          giving_tier: null,
          total_cents: 12500,
        })
      )
    ).toEqual(['Led 1', 'Giving:  ($125)']);
  });
});

describe('the Lists tab', () => {
  it('shows who is on the first list, with facts, tags, and outreach so far', async () => {
    const c = await open();
    expect(queries).toHaveLength(1);
    expect(last()).toMatchObject({ min_events: '2', max_last_event_year: '2024' });
    const text = c.textContent ?? '';
    expect(text).toContain('2 people');
    expect(text).toContain('Person A');
    expect(text).toContain('Registered for 4 events, last in 2023');
    expect(text).toContain('Never led');
    expect(text).toContain('Contacted Nov 2, 2026'); // Person B was contacted for this list before
    expect(text).toContain('left out');
    expect(button(c, 'Invite back')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('refetches when the list or a criterion changes, ignoring an out-of-range number', async () => {
    const c = await open();
    await pick(c, 'Invite to lead');
    expect(last()).toMatchObject({ max_roles_led: '0', min_events: '3' });
    await setNumber(c.querySelector('input[type="number"]'), '5');
    expect(last().min_events).toBe('5');
    const before = queries.length;
    await setNumber(c.querySelector('input[type="number"]'), '0'); // below the minimum
    await setNumber(c.querySelector('input[type="number"]'), '2.5');
    expect(queries).toHaveLength(before);
    await click(c.querySelector('input[type="checkbox"]'));
    await settle();
    expect(last().has_ready).toBe('1');
    await pick(c, 'Committee and board');
    expect(last()).toMatchObject({ serving: '0', min_roles_led: '1' });
    await pick(c, 'Invite to lead'); // its own settings are remembered
    expect(last()).toMatchObject({ min_events: '5', has_ready: '1' });
  });

  it('says what is empty, and has no controls for the donor list', async () => {
    answer = () => page([]);
    const c = await open();
    expect(c.textContent).toContain('No one matches. Try fewer events, or a shorter time away.');
    await pick(c, 'Thank donors');
    expect(c.textContent).toContain('No gifts are recorded yet.');
    expect(c.querySelector('input[type="number"]')).toBeNull();
  });

  it('shows a person’s total to the finance level, as the server sends it', async () => {
    answer = () => page([rowOf({ gift_count: 2, giving_tier: 'Large', total_cents: 123456 })]);
    const c = await open();
    expect(c.textContent).toContain('Giving: Large ($1,234.56)');
  });

  it('shows more, appending the next page', async () => {
    answer = (q) =>
      q.includes('offset=25')
        ? page([rowOf({ person_id: 2, name: 'Person B' })], 26, 25)
        : page(
            Array.from({ length: 25 }, (_, i) => rowOf({ person_id: 100 + i, name: `Person ${i}` })),
            26
          );
    const c = await open();
    expect(c.textContent).toContain('26 people');
    await click(button(c, 'Show more'));
    await settle();
    expect(last().offset).toBe('25');
    expect(c.textContent).toContain('Person B');
    expect(c.textContent).toContain('Person 24');
    expect(button(c, 'Show more')).toBeNull();
  });

  it('shows a load failure, including from "Show more"', async () => {
    answer = () => json({ error: 'nope' }, 500);
    const c = await open();
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('nope');
    expect(button(c, 'Show more')).toBeNull();
    answer = (q) =>
      q.includes('offset=25')
        ? json({ error: 'second page failed' }, 500)
        : page(
            Array.from({ length: 25 }, (_, i) => rowOf({ person_id: 100 + i, name: `P${i}` })),
            40
          );
    await pick(c, 'Invite to lead');
    await click(button(c, 'Show more'));
    await settle();
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('second page failed');
  });

  it('ignores a slow answer for a list that is no longer showing', async () => {
    let release!: (r: Response) => void;
    answer = (q) =>
      q.includes('max_roles_led') ? new Promise((r) => (release = r)) : page([rowOf({ name: 'From the first list' })]);
    const c = await open();
    await click(button(c, 'Invite to lead'));
    await click(button(c, 'Invite back')); // moves on before the second list answers
    await settle();
    release(
      new Response(JSON.stringify({ people: [rowOf({ name: 'From the slow list' })], total: 1, limit: 25, offset: 0 }))
    );
    await settle();
    expect(c.textContent).toContain('From the first list');
    expect(c.textContent).not.toContain('From the slow list');
  });
});

describe('the score on the Lists tab', () => {
  it('is off until asked for, then shows a breakdown, orders by it, and takes edited weights', async () => {
    const c = await open();
    expect(c.textContent).not.toContain('Score ');
    const toggle = [...c.querySelectorAll('label')].find((l) => l.textContent?.includes('Show a score'))!;
    await click(toggle.querySelector('input'));
    expect(c.textContent).toContain('Score 4: 4 registered 4');
    // Person A (4) is listed before Person B (1).
    expect(c.textContent!.indexOf('Person A')).toBeLessThan(c.textContent!.indexOf('Person B'));
    const input = c.querySelector('details input[type="number"]') as HTMLInputElement;
    await setNumber(input, '5');
    expect(c.textContent).toContain('Score 20');
    await setNumber(input, '99'); // out of range, ignored
    expect(c.textContent).toContain('Score 20');
  });
});

describe('status tags on a list', () => {
  it('hides "Inactive" for people who have never led, where it would only mean "not asked yet"', async () => {
    answer = () =>
      page([
        rowOf({ person_id: 1, name: 'Person A', roles_total: 0 }),
        rowOf({ person_id: 2, name: 'Person B', roles_total: 3, roles_led: 3 }),
      ]);
    current.people[1].status = 'hiatus';
    const c = await open();
    const rows = [...c.querySelectorAll('li')].filter((li) => li.textContent?.includes('Mark contacted'));
    expect(rows[0].textContent).not.toContain('Inactive'); // never led: the status is a placeholder
    expect(rows[1].textContent).toContain('On hiatus'); // has led: the status is real
  });
});

describe('where outreach stands', () => {
  it('shows each status in words, with a date only when there is one, and copes with none recorded', async () => {
    current.outreach = [
      {
        id: 1,
        person_id: 1,
        goal: 'invite_back',
        status: 'declined',
        contacted_on: null,
        snooze_until: null,
        note: null,
      },
      {
        id: 2,
        person_id: 2,
        goal: 'invite_back',
        status: 'review-later',
        contacted_on: null,
        snooze_until: '2027-01',
        note: null,
      },
    ];
    const c = await open();
    const text = c.textContent ?? '';
    expect(text).toContain('Declined');
    expect(text).not.toContain('Declined Nov');
    expect(text).toContain('review-later Jan 2027'); // an unknown status shows as it is
    delete current.outreach;
    const d = await open();
    expect(d.textContent).toContain('Person A');
  });
});

describe('outreach actions', () => {
  it('records each outcome with today’s date, then refreshes the list', async () => {
    const c = await open();
    const before = queries.length;
    await click(button(c, 'Mark contacted: Person A'));
    await settle();
    expect(writes.at(-1)).toEqual({
      path: '/outreach',
      method: 'POST',
      body: { person_id: 1, goal: 'invite_back', status: 'contacted', contacted_on: '2026-11-20', snooze_until: null },
    });
    expect(queries.length).toBeGreaterThan(before);
    await click(button(c, 'Snooze 6 months: Person A'));
    await settle();
    expect(writes.at(-1)!.body).toMatchObject({ status: 'snoozed', snooze_until: '2027-05-21', contacted_on: null });
    await click(button(c, 'Declined: Person A'));
    await click(button(c, 'Do not contact: Person A'));
    await settle();
    expect(writes.slice(-2).map((w) => w.body!.status)).toEqual(['declined', 'do_not_contact']);
  });

  it('records the list’s own goal, and shows the new status', async () => {
    const c = await open();
    await pick(c, 'Thank donors');
    await click(button(c, 'Mark contacted: Person A'));
    await settle();
    expect(writes.at(-1)!.body).toMatchObject({ goal: 'thank_donor' });
    expect(c.textContent).toContain('Contacted Nov 20, 2026');
  });

  it('shows why an action failed', async () => {
    const c = await open();
    fail = { status: 400, error: 'goal must be one of: ...' };
    await click(button(c, 'Declined: Person A'));
    await settle();
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('goal must be one of: ...');
  });
});

describe('opening a person from a list', () => {
  it('opens their panel, closes it, and refreshes the list when something changes', async () => {
    const c = await open();
    await click(buttons(c).find((b) => b.textContent === 'Person A') ?? null);
    await settle();
    expect(c.querySelector('aside')?.getAttribute('aria-label')).toBe('Person A details');
    const before = queries.length;
    await click(c.querySelector('aside button[aria-label="Close"]'));
    expect(c.querySelector('aside')).toBeNull();
    await click(buttons(c).find((b) => b.textContent === 'Person B') ?? null);
    await settle();
    const status = c.querySelector('aside input[name="status"][value="hiatus"]') as HTMLInputElement;
    await click(status);
    await click(button(c.querySelector('aside')!, 'Save'));
    await settle();
    expect(queries.length).toBeGreaterThan(before);
  });

  it('copes with a person the page no longer knows', async () => {
    answer = () => page([rowOf({ person_id: 77, name: 'Someone Missing' })]);
    const c = await open();
    expect(c.textContent).toContain('Someone Missing');
    await click(buttons(c).find((b) => b.textContent === 'Someone Missing') ?? null);
    expect(c.querySelector('aside')).toBeNull(); // no panel without a person record
  });
});
