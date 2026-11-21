// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { buttonWithText, click, cleanup, render, settle, type } from '../../__tests__/react';
import LeadershipApp from './LeadershipApp';

// The canvas and physics are tested on their own; here it is a stand-in that reports what it was given.
vi.mock('./MarbleFunnel', () => ({
  default: (p: { people: { name: string }[]; onSelect: (id: number) => void; onPickLane: (l: string) => void }) => (
    <div data-testid="marbles">
      {p.people.map((x) => x.name).join(',')}
      <button onClick={() => p.onSelect(1)}>marble</button>
      <button onClick={() => p.onPickLane('class')}>chamber</button>
    </div>
  ),
}));
import { isOverdue, journeyEvidence, type Data, type JourneyBoard, type JourneyRow } from './model';

// Placeholder names only.
const base: Data = {
  me: 'Me@Example.org',
  level: 'standard',
  isAdmin: false,
  people: [{ id: 1, name: 'Person A', email: null, leader_slug: null, status: 'active', mentor: 0, notes: null }],
  activities: [],
  events: [],
  roles: [],
  notes: [],
  service: [],
  volunteers: [],
  outreach: [],
  activityTypes: [],
};
const rowOf = (over: Partial<JourneyRow> = {}): JourneyRow => ({
  person_id: 1,
  name: 'Person A',
  status: 'active',
  mentor: 0,
  stage: 'attendee',
  first_attended_year: 2022,
  first_volunteer_year: null,
  first_activity_year: null,
  first_class_year: null,
  first_service_year: null,
  activities_led: 0,
  classes_led: 0,
  volunteer_count: 0,
  events_registered: 3,
  service_terms: 0,
  serving_now: 0,
  on_board_now: 0,
  last_active_year: 2024,
  do_not_contact: 0,
  target: null,
  next_step: null,
  due_on: null,
  owner: null,
  ...over,
});
const emptyCol = { people: [], total: 0, limit: 12, offset: 0 };
const board = (over: Partial<JourneyBoard['columns']> = {}): JourneyBoard => ({
  funnel: {
    supporter: 5,
    attendee: 4,
    volunteer: 2,
    activity: 1,
    class: 1,
    serving_now: 1,
    served_ever: 2,
    attendee_new: 1,
    volunteer_new: 0,
    activity_new: 0,
    class_new: 0,
    serving_new: 0,
  },
  year: null,
  thisYear: 2026,
  columns: {
    supporter: emptyCol,
    attendee: { people: [rowOf()], total: 3, limit: 12, offset: 0 },
    volunteer: emptyCol,
    activity: emptyCol,
    class: emptyCol,
    serving: emptyCol,
    ...over,
  },
});

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

let queries: string[];
let writes: { path: string; method: string; body?: Record<string, unknown> }[];
let person: JourneyRow;
let current: JourneyBoard;
let fail: string | null;
let boardFails: boolean;
let holdBoard: Promise<Response> | null;
let columnFails: boolean;
let marblesFail = false;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T12:00:00Z') });
  queries = [];
  writes = [];
  person = rowOf();
  current = board();
  fail = null;
  boardFails = false;
  holdBoard = null;
  columnFails = false;
  marblesFail = false;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = url.replace('/api/internal/engagement', '');
      const method = init?.method ?? 'GET';
      if (path === '/bootstrap') return json(base);
      if (path.startsWith('/journey?')) {
        queries.push(path.slice('/journey?'.length));
        if (boardFails) return json({ error: 'board broke' }, 500);
        if (holdBoard && !path.includes('mine=1')) return holdBoard;
        if (path.includes('stage=') && columnFails) return json({ error: 'column broke' }, 500);
        if (path.includes('stage='))
          return json({ people: [rowOf({ person_id: 9, name: 'Person Z' })], total: 3, limit: 12, offset: 1 });
        return json(current);
      }
      if (path.startsWith('/journey/marbles')) {
        queries.push(`marbles:${path.split('?')[1] ?? ''}`);
        return marblesFail
          ? json({ error: 'marbles broke' }, 500)
          : json({ people: [{ person_id: 1, name: 'Person A', stage: 'attendee' }] });
      }
      if (path === '/journey') {
        queries.push('');
        return json(current);
      }
      const one = path.match(/^\/journey\/(\d+)$/);
      if (one && method === 'GET') return Number(one[1]) === 404 ? json({ error: 'gone' }, 404) : json(person);
      writes.push({ path, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
      return fail ? json({ error: fail }, 400) : json({ ok: true });
    })
  );
});
afterEach(async () => {
  vi.useRealTimers();
  await cleanup();
});

const open = async (hash = '#/journey') => {
  window.history.replaceState(null, '', `/${hash}`);
  const c = await render(<LeadershipApp />);
  await settle();
  return c.container;
};
const field = (c: Element, label: string) =>
  [...c.querySelectorAll('label')]
    .find((l) => l.textContent?.startsWith(label))!
    .querySelector('input, select') as HTMLInputElement;
const choose = (el: HTMLSelectElement, value: string) =>
  act(async () => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });

describe('the words', () => {
  it('tells what someone has done, and says when it is only support', () => {
    expect(journeyEvidence(rowOf())).toBe('Registered for 3 events');
    expect(
      journeyEvidence(
        rowOf({
          events_registered: 1,
          volunteer_count: 1,
          activities_led: 2,
          classes_led: 1,
          serving_now: 1,
          on_board_now: 1,
        })
      )
    ).toBe('Registered for 1 event · Helped 1 time · Led 2 activities · Led 1 class · On the board');
    expect(journeyEvidence(rowOf({ events_registered: 0, serving_now: 1 }))).toBe('On a committee');
    expect(journeyEvidence(rowOf({ events_registered: 0 }))).toBe('Member or donor, no events yet');
  });
  it('knows when a step is overdue', () => {
    expect(isOverdue('2026-11-19', '2026-11-20')).toBe(true);
    expect(isOverdue('2026-11-20', '2026-11-20')).toBe(false);
    expect(isOverdue(null, '2026-11-20')).toBe(false);
  });
});

describe('the Journey view', () => {
  it('shows the funnel and a column per stage, with counts and a show-more', async () => {
    const c = await open();
    const text = c.textContent ?? '';
    expect(text).toContain('How far people get');
    expect(text).toContain('Person A');
    expect(text).toContain('Registered for 3 events');
    expect(text).toContain('Show more (2)');
    expect(text).toContain('1 more are supporters only'.replace('1', '1')); // 5 supporters - 4 attendees
    expect(queries[0]).toBe('exclude_do_not_contact=1');
    await click(buttonWithText(c, /Show more/));
    await settle();
    expect(queries.at(-1)).toContain('stage=attendee&offset=1');
    expect(c.textContent).toContain('Person Z');
  });

  it('refetches when a filter, the search, or the year changes', async () => {
    const c = await open();
    await click(buttonWithText(c, 'Mine'));
    await settle();
    expect(queries.at(-1)).toContain('mine=1');
    await click(buttonWithText(c, 'Next step date has passed'));
    await click(buttonWithText(c, 'Has a target'));
    await click(buttonWithText(c, 'Nothing in 3+ years'));
    await click(buttonWithText(c, 'Hide do not contact'));
    await settle();
    expect(queries.at(-1)).toBe('mine=1&overdue=1&has_target=1&stalled_years=3');
    await choose(c.querySelector('select')!, '2025');
    await settle();
    expect(queries.at(-1)).toContain('year=2025');
    await type(c.querySelector('input[type="search"]'), 'Pat');
    await act(async () => {
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(queries.at(-1)).toContain('q=Pat');
  });

  it('keeps the newest answer when an older one arrives late', async () => {
    let release!: (r: Response) => void;
    const c = await open();
    holdBoard = new Promise((r) => (release = r));
    await click(buttonWithText(c, 'Has a target')); // an older request, answered late
    await settle();
    await click(buttonWithText(c, 'Mine')); // a newer request, answered at once
    await settle();
    await act(async () =>
      release(
        new Response(
          JSON.stringify(
            board({ attendee: { people: [rowOf({ name: 'Stale Person' })], total: 1, limit: 12, offset: 0 } })
          )
        )
      )
    );
    await settle();
    expect(c.textContent).not.toContain('Stale Person');
  });

  it('asks for everyone when no filter is on, and says when more cannot load', async () => {
    const c = await open();
    await click(buttonWithText(c, 'Hide do not contact'));
    await settle();
    expect(queries.at(-1)).toBe('');
    columnFails = true;
    await click(buttonWithText(c, /Show more/));
    await settle();
    expect(c.textContent).toContain('column broke');
  });

  it('shows status only past the first steps, marks serving, and says when a step is not yet due', async () => {
    current = board({
      class: {
        people: [rowOf({ person_id: 2, name: 'Person C', stage: 'class', status: 'inactive', serving_now: 1 })],
        total: 1,
        limit: 12,
        offset: 0,
      },
      attendee: {
        people: [rowOf({ status: 'hiatus', next_step: 'Soon', due_on: '2027-01-01' })],
        total: 1,
        limit: 12,
        offset: 0,
      },
    });
    const c = await open();
    const cls = c.querySelector('section[aria-label="Leads a class"]')!.textContent;
    expect(cls).toContain('Inactive');
    expect(cls).toContain('Serving now');
    const att = c.querySelector('section[aria-label="Attendee"]')!.textContent;
    expect(att).not.toContain('On hiatus');
    expect(att).toContain('due 2027-01-01');
  });

  it('draws a step nobody has reached as an empty bar, and can go back to any year', async () => {
    current = { ...board(), funnel: { ...board().funnel, serving_now: 0 } };
    const c = await open();
    expect(c.textContent).toContain('Serving now');
    const select = c.querySelector('select')!;
    await choose(select, '2025');
    await settle();
    expect(c.textContent).toContain('in 2025');
    await choose(select, '');
    await settle();
    expect(c.textContent).not.toContain('in 2025');
  });

  it('shows a load failure', async () => {
    boardFails = true;
    const c = await open();
    expect(c.textContent).toContain('board broke');
  });

  it('jumps to a column from the funnel', async () => {
    const c = await open();
    const scroll = vi.fn();
    (c.querySelector('section[aria-label="Leads a class"]') as HTMLElement).scrollIntoView = scroll;
    await click(buttonWithText(c, /^Led a class/));
    expect(scroll).toHaveBeenCalled();
    expect(buttonWithText(c, /^Led a class/)!.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('planning a next step', () => {
  it('opens a person, saves a plan as mine, and keeps the address in step', async () => {
    const c = await open();
    await click(buttonWithText(c, /^Person A/));
    await settle();
    expect(window.location.hash).toBe('#/journey/1');
    expect(c.querySelector('aside')!.textContent).toContain('Attended');
    await choose(field(c, 'Aiming to') as unknown as HTMLSelectElement, 'class');
    await type(field(c, 'Next step'), ' Ask about a class ');
    await type(field(c, 'Due'), '2026-12-01');
    await click(field(c, 'I am following up'));
    await click(buttonWithText(c, 'Save plan'));
    expect(writes.at(-1)).toEqual({
      path: '/journey/1',
      method: 'PUT',
      body: { target: 'class', next_step: 'Ask about a class', due_on: '2026-12-01', owner: 'me@example.org' },
    });
    await settle();
    expect(c.textContent).toContain('Saved');
  });

  it('shows an existing plan, marks an overdue step, keeps another owner, and clears it', async () => {
    person = rowOf({ target: 'board', next_step: 'Coffee', due_on: '2026-11-01', owner: 'someone@example.org' });
    current = board({ attendee: { people: [person], total: 1, limit: 12, offset: 0 } });
    const c = await open('#/journey/1');
    expect(c.textContent).toContain('Aiming: Join the board');
    expect(c.textContent).toContain('date passed, 2026-11-01');
    expect(field(c, 'I am following up').checked).toBe(false);
    await click(buttonWithText(c, 'Save plan'));
    expect(writes.at(-1)!.body).toMatchObject({ owner: 'someone@example.org', target: 'board' });
    await click(buttonWithText(c, 'Clear plan'));
    await settle();
    expect(writes.at(-1)).toMatchObject({ path: '/journey/1', method: 'DELETE' });
    expect(c.querySelector('aside')).toBeNull();
  });

  it('stays open when clearing fails', async () => {
    person = rowOf({ target: 'class' });
    const c = await open('#/journey/1');
    fail = 'cannot clear';
    await click(buttonWithText(c, 'Clear plan'));
    await settle();
    expect(c.querySelector('aside')).not.toBeNull();
    expect(c.textContent).toContain('cannot clear');
  });

  it('shows why a save failed, and a person who is gone', async () => {
    const c = await open('#/journey/1');
    fail = 'nope';
    await click(buttonWithText(c, 'Save plan'));
    expect(c.textContent).toContain('nope');
    await cleanup();
    const d = await open('#/journey/404');
    expect(d.textContent).toContain('gone');
  });

  it('goes to the full record, and closes', async () => {
    const c = await open('#/journey/1');
    await click(buttonWithText(c, 'Open full record'));
    await settle();
    expect(window.location.hash).toBe('#/people/1');
  });
});

describe('the journey on a person record', () => {
  it('shows the strip with the plan, and links to planning', async () => {
    person = rowOf({
      stage: 'class',
      first_attended_year: 2019,
      first_class_year: 2023,
      first_service_year: 2025,
      service_terms: 1,
      serving_now: 1,
      on_board_now: 1,
      target: 'committee',
      next_step: 'Check in',
      due_on: '2027-01-01',
    });
    const c = await open('#/people/1');
    const section = c.querySelector('section[aria-label="Journey"]')!;
    expect(section.textContent).toContain('Attended 2019');
    expect(section.textContent).toContain('Led a class 2023');
    expect(section.textContent).toContain('On the board 2025');
    expect(section.textContent).toContain('Aiming: Join a committee');
    await click(buttonWithText(section, 'Plan next step'));
    await settle();
    expect(window.location.hash).toBe('#/journey/1');
  });

  it('marks the step someone is aiming for when it is not reached yet', async () => {
    person = rowOf({ target: 'class' });
    const c = await open('#/people/1');
    expect(c.querySelector('section[aria-label="Journey"]')!.textContent).toContain('aiming for this');
  });

  it('stays hidden when it cannot load', async () => {
    const c = await open('#/people/404');
    expect(c.querySelector('section[aria-label="Journey"]')).toBeNull();
  });
});

describe('the marble funnel', () => {
  it('is off until asked for, then shows everyone, follows the filters, and opens a person', async () => {
    const c = await open();
    expect(c.querySelector('[data-testid="marbles"]')).toBeNull();
    expect(queries.some((q) => q.startsWith('marbles:'))).toBe(false);
    await click(buttonWithText(c, 'Marbles'));
    await settle();
    expect(c.querySelector('[data-testid="marbles"]')?.textContent).toContain('Person A');
    expect(c.textContent).toContain('The funnel splits below Volunteer');
    await click(buttonWithText(c, 'Mine'));
    await settle();
    expect(queries).toContain('marbles:mine=1&exclude_do_not_contact=1');
    await click(buttonWithText(c, 'marble'));
    await settle();
    expect(window.location.hash).toBe('#/journey/1');
    await click(buttonWithText(c, 'chamber')); // scrolls to the lane; nothing to assert beyond not failing
    await click(buttonWithText(c, 'Bars'));
    expect(c.querySelector('[data-testid="marbles"]')).toBeNull();
    expect(c.querySelector('section[aria-label="Funnel"]')).not.toBeNull();
  });

  it('says so when the marbles cannot be loaded', async () => {
    marblesFail = true;
    const c = await open();
    await click(buttonWithText(c, 'Marbles'));
    await settle();
    expect(c.textContent).toContain('marbles broke');
  });
});
