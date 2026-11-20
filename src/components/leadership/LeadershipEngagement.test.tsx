// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, cleanup, render, settle } from '../../__tests__/react';
import LeadershipApp from './LeadershipApp';
import type { Data, Timeline, TimelineItem } from './model';

// Placeholder names only.
const base: Data = {
  me: 'board@example.org',
  level: 'standard',
  isAdmin: false,
  people: [
    { id: 1, name: 'Person A', email: null, leader_slug: null, status: 'active', mentor: 0, notes: null },
    { id: 2, name: 'Person B', email: null, leader_slug: null, status: 'active', mentor: 0, notes: null },
  ],
  activities: [{ id: 1, name: 'Games Class', scope: 'class', type: 'Games', subtype: null }],
  events: [{ id: 1, name: 'Event One 2025', event_type: 'weekend', year: 2025 }],
  roles: [],
  notes: [],
  service: [
    {
      id: 1,
      person_id: 1,
      body: 'Board of Directors',
      title: 'Chair',
      started_on: '2024-01',
      ended_on: '2027-12',
      note: 'Third term',
      source: 'test',
    },
    {
      id: 2,
      person_id: 1,
      body: 'Programming Committee',
      title: null,
      started_on: '2023',
      ended_on: '2023',
      note: null,
    },
    { id: 3, person_id: 1, body: 'Site Committee', title: null, started_on: null, ended_on: null, note: null },
  ],
  volunteers: [
    { id: 1, person_id: 2, event_id: 1, task: 'Set up', hours: 2, note: null },
    { id: 2, person_id: 1, event_id: 1, task: 'Clean up', hours: null, note: null },
    { id: 3, person_id: 99, event_id: 1, task: 'Ghost', hours: null, note: null },
  ],
  activityTypes: ['Games'],
};

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

type Call = { path: string; method: string; body?: Record<string, unknown> };
let calls: Call[];
let current: Data;
let timelines: Record<number, Timeline | 'fail'>;
let holds: Record<number, Promise<Response>>;
let fail: { status: number; error: string } | null;

beforeEach(() => {
  calls = [];
  fail = null;
  current = structuredClone(base);
  timelines = {};
  holds = {};
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = url.replace('/api/internal/engagement', '');
      const method = init?.method ?? 'GET';
      if (path === '/bootstrap') return json(current);
      const tl = path.match(/^\/timeline\/(\d+)$/);
      if (tl && Number(tl[1]) in holds) return holds[Number(tl[1])];
      if (tl) {
        const t = timelines[Number(tl[1])] ?? {
          person: { id: Number(tl[1]), name: 'x' },
          giving: { tier: 'No gifts' },
          items: [],
        };
        return t === 'fail' ? json({ error: 'timeline broke' }, 500) : json(t);
      }
      const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined;
      calls.push({ path, method, body });
      if (fail) return json({ error: fail.error }, fail.status);
      if (path === '/volunteers/bulk') {
        for (const r of body!.rows as NonNullable<Data['volunteers']>)
          current.volunteers!.push({ ...r, id: 50 + current.volunteers!.length, note: null });
        return json({ added: (body!.rows as unknown[]).length });
      }
      const row = path.match(/^\/(service|volunteer)(?:\/(\d+))?$/);
      if (row) {
        const list = (row[1] === 'service' ? current.service : current.volunteers) as { id: number }[];
        if (method === 'POST') list.push({ id: 90, ...body } as never);
        else if (method === 'PUT')
          Object.assign(
            list.find((x) => x.id === Number(row[2]))!,
            body
          );
        else
          list.splice(
            list.findIndex((x) => x.id === Number(row[2])),
            1
          );
        return json(method === 'POST' ? { id: 90 } : { ok: true }, method === 'POST' ? 201 : 200);
      }
      return json({ ok: true });
    })
  );
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

const buttons = (r: Element) => [...r.querySelectorAll('button')];
const button = (r: Element, label: string) =>
  buttons(r).find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === label) ?? null;
const panel = (r: Element) => r.querySelector('aside') as HTMLElement;
const field = (root: Element, label: string) =>
  [...root.querySelectorAll('label')]
    .find((l) => l.textContent?.trim().startsWith(label))
    ?.querySelector('input, select, textarea') as HTMLInputElement & HTMLTextAreaElement;
async function setField(el: Element | null | undefined, value: string) {
  if (!el) throw new Error('setField: element not found');
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function open() {
  const { container } = await render(<LeadershipApp />);
  await settle();
  return container;
}
const openPerson = async (c: Element, name: string) => {
  await click(buttons(c).find((b) => b.textContent === name) ?? null);
  await settle();
};
const item = (
  type: TimelineItem['type'],
  id: number,
  at: string,
  title: string,
  extra: Partial<TimelineItem> = {}
): TimelineItem => ({ type, id, at, title, ...extra });

describe('the timeline', () => {
  it('lists each kind of record in words, grouped by year', async () => {
    timelines[1] = {
      person: { id: 1, name: 'Person A' },
      giving: { tier: 'Medium' },
      items: [
        item('gift', 1, '2026-05-23', 'Gift'),
        item('registration', 2, '2026-01-10', 'Winter 2026', { attended: 1 }),
        item('registration', 3, '2026', 'Spring 2026', { attended: 0 }),
        item('registration', 4, '2025', 'Camp 2025', { detail: 'cancelled' }),
        item('registration', 5, '2025', 'Fun Day', { attended: null, detail: 'registered' }),
        item('role', 6, '2025', 'Games Class', { leadership_type: 'partner', event: 'Camp 2025' }),
        item('role', 7, '2025', 'Tag', { leadership_type: 'assisting', event: 'Camp 2025' }),
        item('role', 8, '2024', 'Reel', { event: 'Camp 2024' }),
        item('volunteer', 9, '2024', 'Moved tables', { event: 'Camp 2024', hours: 2 }),
        item('volunteer', 10, '2024', 'Greeted', { event: 'Camp 2024' }),
        item('service', 11, '2023-01', 'Board of Directors', {
          detail: 'Chair',
          started_on: '2023-01',
          ended_on: null,
        }),
        item('membership', 12, '2022', 'annual', { ends_on: '2022-12-31' }),
        item('membership', 13, '2020', 'life'),
        item('outreach', 14, '2021-03-01', 'invite_lead', { detail: 'contacted', note: 'Asked at camp' }),
        item('outreach', 15, '2021', 'mystery', { detail: 'odd' }),
        item('note', 16, '2021-02-01', 'ready', { detail: 'games class', body: 'Great', author: 'a@example.org' }),
        item('note', 17, '2021-01-01', 'note', { body: 'Plain' }),
        item('service', 18, '', 'Site Committee'),
      ],
    };
    const c = await open();
    await openPerson(c, 'Person A');
    await click(button(panel(c), 'Show all 18'));
    const text = panel(c).textContent ?? '';
    for (const expected of [
      'Giving: Medium',
      'Gift',
      'May 23, 2026',
      'Attended',
      'Did not attend',
      'Registered',
      'Cancelled',
      'Co-led',
      'Assisted',
      'Led',
      'Helped',
      '2 hours',
      'Served',
      'Chair, Board of Directors',
      'since Jan 2023',
      'Member',
      'until Dec 31, 2022',
      'Invite to lead',
      'Contacted, Asked at camp',
      'mystery',
      'odd',
      'Ready for',
      'games class, Great',
      'Plain',
      'a@example.org',
      'Undated',
    ]) {
      expect(text, expected).toContain(expected);
    }
    expect([...panel(c).querySelectorAll('h4')].map((h) => h.textContent).slice(0, 3)).toEqual([
      '2026',
      '2025',
      '2024',
    ]);
  });

  it('shows a total to the finance level, and only the first dozen until asked', async () => {
    timelines[1] = {
      person: { id: 1, name: 'Person A' },
      giving: { total_cents: 123456 },
      items: [
        item('gift', 1, '2026-01-05', 'Annual Appeal', { amount_cents: 100000, recurring: 1 }),
        item('gift', 2, '2025-01-05', 'Fun Day', { amount_cents: 23456 }),
        ...Array.from({ length: 12 }, (_, i) => item('registration', 10 + i, `${2024 - i}`, `Event ${i}`)),
      ],
    };
    const c = await open();
    await openPerson(c, 'Person A');
    expect(panel(c).textContent).toContain('$1,234.56 in all');
    expect(panel(c).textContent).toContain('$1,000');
    expect(panel(c).textContent).toContain('Annual Appeal');
    expect(panel(c).textContent).toContain('Recurring');
    expect(panel(c).textContent).not.toContain('Event 11'); // 14 items, only 12 shown
    await click(button(panel(c), 'Show all 14'));
    expect(panel(c).textContent).toContain('Event 11');
    await click(button(panel(c), 'Show fewer'));
    expect(panel(c).textContent).not.toContain('Event 11');
  });

  it('says when nothing is recorded, and when the timeline cannot load', async () => {
    const c = await open();
    await openPerson(c, 'Person B');
    expect(panel(c).textContent).toContain('Nothing recorded yet.');
    timelines[1] = 'fail';
    await openPerson(c, 'Person A');
    expect(panel(c).textContent).toContain('timeline broke');
  });

  it('does not show a giving line when there are no gifts', async () => {
    timelines[2] = {
      person: { id: 2, name: 'Person B' },
      giving: { tier: 'No gifts' },
      items: [item('registration', 1, '2025', 'Camp')],
    };
    const c = await open();
    await openPerson(c, 'Person B');
    expect(panel(c).textContent).not.toContain('Giving:');
  });
});

describe('the timeline while a person changes', () => {
  it('ignores a slow answer for someone who is no longer open', async () => {
    let release!: (r: Response) => void;
    holds[1] = new Promise((resolve) => (release = resolve));
    const c = await open();
    await click(buttons(c).find((b) => b.textContent === 'Person A') ?? null);
    await openPerson(c, 'Person B'); // moves on before A's timeline arrives
    release(
      new Response(
        JSON.stringify({
          person: { id: 1, name: 'A' },
          giving: {},
          items: [item('note', 1, '2025', 'note', { body: 'from A' })],
        })
      )
    );
    await settle();
    expect(panel(c).textContent).not.toContain('from A');
  });

  it('ignores a slow failure too', async () => {
    let release!: (r: Response) => void;
    holds[1] = new Promise((resolve) => (release = resolve));
    const c = await open();
    await click(buttons(c).find((b) => b.textContent === 'Person A') ?? null);
    await openPerson(c, 'Person B');
    release(new Response(JSON.stringify({ error: 'late failure' }), { status: 500 }));
    await settle();
    expect(panel(c).textContent).not.toContain('late failure');
  });

  it('shows nothing after "Giving:" when the server sends no tier', async () => {
    timelines[2] = { person: { id: 2, name: 'B' }, giving: {}, items: [item('gift', 1, '2025-01-01', 'Gift')] };
    const c = await open();
    await openPerson(c, 'Person B');
    expect(panel(c).textContent).toContain('Giving: ');
  });
});

describe('board and committees on a person', () => {
  it('sorts terms that have only an end date, or no dates at all', async () => {
    current.service = [
      { id: 1, person_id: 2, body: 'Old Committee', title: null, started_on: null, ended_on: '2019', note: null },
      { id: 2, person_id: 2, body: 'Newer Committee', title: null, started_on: null, ended_on: '2022', note: null },
      { id: 3, person_id: 2, body: 'Undated Committee', title: null, started_on: null, ended_on: null, note: null },
    ];
    const c = await open();
    await openPerson(c, 'Person B');
    const text = panel(c).textContent ?? '';
    const at = (b: string) => text.indexOf(b, text.indexOf('Board and committees'));
    expect(at('Newer Committee')).toBeLessThan(at('Old Committee'));
    expect(at('Old Committee')).toBeLessThan(at('Undated Committee'));
  });

  it('lists terms newest first, with the term in words', async () => {
    const c = await open();
    await openPerson(c, 'Person A');
    const text = panel(c).textContent ?? '';
    expect(text).toContain('Board of Directors, Chair');
    expect(text).toContain('Jan 2024 to Dec 2027');
    expect(text).toContain('Third term');
    expect(text).toContain('Programming Committee');
    expect(text).toContain('Site Committee');
    expect(text).toContain('current');
    const order = ['Board of Directors', 'Programming Committee', 'Site Committee'].map((b) =>
      text.indexOf(b, text.indexOf('Board and committees'))
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    await openPerson(c, 'Person B');
    expect(panel(c).textContent).toContain('None recorded.');
  });

  it('adds a term, with a year or a year and month', async () => {
    const c = await open();
    await openPerson(c, 'Person B');
    await click(button(panel(c), 'Add service'));
    const form = panel(c).querySelector('form[aria-label="Add service"]')!;
    expect([...form.querySelectorAll('datalist option')].map((o) => o.getAttribute('value'))).toEqual([
      'Board of Directors',
      'Programming Committee',
      'Site Committee',
    ]);
    expect((button(form, 'Add') as HTMLButtonElement).disabled).toBe(true);
    await setField(field(form, 'Board or committee'), ' Diversity Committee ');
    await setField(field(form, 'Role'), 'Co-chair');
    await setField(field(form, 'Started'), '2025-06');
    await setField(field(form, 'Ended'), 'later');
    expect(form.textContent).toContain('Use a year, or a year and month');
    expect((button(form, 'Add') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(calls).toHaveLength(0);
    await setField(field(form, 'Ended'), '2026');
    await setField(field(form, 'Note'), ' second year ');
    await click(button(form, 'Add'));
    expect(calls.at(-1)).toEqual({
      path: '/service',
      method: 'POST',
      body: {
        person_id: 2,
        body: 'Diversity Committee',
        title: 'Co-chair',
        started_on: '2025-06',
        ended_on: '2026',
        note: 'second year',
      },
    });
    await settle();
    expect(panel(c).textContent).toContain('Diversity Committee');
    expect(panel(c).querySelector('form[aria-label="Add service"]')).toBeNull();
  });

  it('cancels, and shows the server’s reason when saving fails', async () => {
    const c = await open();
    await openPerson(c, 'Person B');
    await click(button(panel(c), 'Add service'));
    await click(button(panel(c), 'Cancel'));
    expect(panel(c).querySelector('form[aria-label="Add service"]')).toBeNull();
    await click(button(panel(c), 'Add service'));
    const form = panel(c).querySelector('form[aria-label="Add service"]')!;
    await setField(field(form, 'Board or committee'), 'Board of Directors');
    fail = { status: 400, error: 'body is too long' };
    await click(button(form, 'Add'));
    expect(form.querySelector('[role="alert"]')?.textContent).toBe('body is too long');
  });

  it('changes a term, keeping where it came from, and removes one after asking', async () => {
    const c = await open();
    await openPerson(c, 'Person A');
    await click(button(panel(c), 'Change Board of Directors'));
    const form = panel(c).querySelector('form[aria-label="Change service"]')!;
    expect(field(form, 'Role').value).toBe('Chair');
    await setField(field(form, 'Role'), '');
    await click(button(form, 'Save'));
    expect(calls.at(-1)).toEqual({
      path: '/service/1',
      method: 'PUT',
      body: {
        person_id: 1,
        body: 'Board of Directors',
        title: null,
        started_on: '2024-01',
        ended_on: '2027-12',
        note: 'Third term',
        source: 'test',
      },
    });
    await settle();
    await click(button(panel(c), 'Remove Site Committee'));
    await click(button(panel(c), 'Yes, remove'));
    expect(calls.at(-1)).toEqual({ path: '/service/3', method: 'DELETE', body: undefined });
  });
});

describe('volunteers at an event', () => {
  const openEvent = async () => {
    const c = await open();
    await click(button(c, 'Events'));
    await click(buttons(c).find((b) => b.textContent?.startsWith('2025 Event One')) ?? null);
    return c;
  };

  it('lists who helped, leaving out people who are gone', async () => {
    const c = await openEvent();
    const text = panel(c).textContent ?? '';
    expect(text).toContain('Person B, Set up, 2 hours');
    expect(text).toContain('Person A, Clean up');
    expect(text).not.toContain('Ghost');
    await click(button(c, 'Events'));
  });

  it('adds several people with one task, and offers tasks already used', async () => {
    const c = await openEvent();
    const form = panel(c).querySelector('form[aria-label="Add volunteers"]')!;
    expect([...form.querySelectorAll('datalist option')].map((o) => o.getAttribute('value'))).toEqual([
      'Clean up',
      'Ghost',
      'Set up',
    ]);
    expect((button(form, 'Add volunteer') as HTMLButtonElement).disabled).toBe(true);
    await setField(field(form, 'What they helped with'), ' Moved tables ');
    await setField(field(form, 'Hours'), '-1');
    await click(form.querySelector('input[type="checkbox"]'));
    expect((button(form, 'Add volunteer') as HTMLButtonElement).disabled).toBe(true); // hours must not be negative
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(calls).toHaveLength(0);
    await setField(field(form, 'Hours'), '1.5');
    await click([...form.querySelectorAll('input[type="checkbox"]')][1]);
    await click(button(form, 'Add 2 volunteers'));
    expect(calls.at(-1)).toEqual({
      path: '/volunteers/bulk',
      method: 'POST',
      body: {
        rows: [
          { person_id: 1, event_id: 1, task: 'Moved tables', hours: 1.5 },
          { person_id: 2, event_id: 1, task: 'Moved tables', hours: 1.5 },
        ],
      },
    });
    await settle();
    expect(form.querySelector('[role="status"]')?.textContent).toBe('Added 2 volunteers.');
    expect(panel(c).textContent).toContain('Person A, Moved tables, 1.5 hours');
  });

  it('says "1 volunteer", sends no hours when blank, and shows a failure', async () => {
    const c = await openEvent();
    const form = panel(c).querySelector('form[aria-label="Add volunteers"]')!;
    await setField(field(form, 'What they helped with'), 'Greeted');
    await click(form.querySelector('input[type="checkbox"]'));
    await click(button(form, 'Add volunteer'));
    expect(calls.at(-1)!.body).toEqual({ rows: [{ person_id: 1, event_id: 1, task: 'Greeted', hours: null }] });
    await settle();
    expect(form.querySelector('[role="status"]')?.textContent).toBe('Added 1 volunteer.');
    await click(form.querySelector('input[type="checkbox"]'));
    fail = { status: 400, error: 'send between 1 and 200 volunteers' };
    await click(button(form, 'Add volunteer'));
    expect(form.querySelector('[role="alert"]')?.textContent).toBe('send between 1 and 200 volunteers');
  });

  it('removes a volunteer after asking, and says when there are none', async () => {
    const c = await openEvent();
    await click(button(panel(c), 'Remove Person B from Set up'));
    await click(button(panel(c), 'Yes, remove'));
    expect(calls.at(-1)).toEqual({ path: '/volunteer/1', method: 'DELETE', body: undefined });
    current.volunteers = [];
    const d = await open();
    await click(button(d, 'Events'));
    await click(buttons(d).find((b) => b.textContent?.startsWith('2025 Event One')) ?? null);
    expect([...d.querySelectorAll('aside')].pop()!.textContent).toContain('No one recorded yet.');
  });

  it('copes with a server that sends no service or volunteer lists', async () => {
    delete current.service;
    delete current.volunteers;
    const c = await open();
    await openPerson(c, 'Person A');
    expect(panel(c).textContent).toContain('None recorded.');
    await click(button(panel(c), 'Add service'));
    expect(panel(c).querySelector('form[aria-label="Add service"]')).not.toBeNull(); // no list to suggest from
    await click(button(c, 'Events'));
    await click(buttons(c).find((b) => b.textContent?.startsWith('2025 Event One')) ?? null);
    expect(panel(c).textContent).toContain('No one recorded yet.');
  });
});
