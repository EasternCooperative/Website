// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, cleanup, render, settle } from '../../__tests__/react';
import LeadershipApp from './LeadershipApp';
import type { Data } from './model';

// Placeholder names only.
const base: Data = {
  me: 'board@example.org',
  people: [
    { id: 1, name: 'Person A', email: 'a@example.org', leader_slug: null, status: 'active', mentor: 0, notes: null },
    { id: 2, name: 'Person B', email: null, leader_slug: null, status: 'hiatus', mentor: 1, notes: null },
  ],
  activities: [
    { id: 1, name: 'Games Class', scope: 'class', type: 'Games', subtype: null, site_activity_id: 'games' },
    { id: 2, name: 'Tag', scope: 'activity', type: 'Games', subtype: 'Active' },
    { id: 3, name: 'Reel', scope: 'activity', type: 'Dancing', subtype: null },
  ],
  events: [
    { id: 1, name: 'Event One 2025', event_type: 'extended', year: 2025, site_event_id: 'one' },
    { id: 2, name: 'Event Two', event_type: 'weekend', year: 2024 },
    { id: 3, name: 'Empty Day', event_type: 'one_day', year: 2023 },
  ],
  roles: [
    {
      id: 1,
      person_id: 1,
      activity_id: 1,
      event_id: 1,
      leadership_type: 'solo',
      how_it_went: 'Went well',
      source: 'sheet_import',
    },
    { id: 2, person_id: 2, activity_id: 1, event_id: 1, leadership_type: 'assisting', how_it_went: null },
    { id: 3, person_id: 1, activity_id: 2, event_id: 2, leadership_type: 'partner', how_it_went: null },
  ],
  notes: [],
  activityTypes: ['Games', 'Dancing', 'Music'],
};

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

type Call = { path: string; method: string; body: Record<string, unknown> | undefined };
let calls: Call[];
let current: Data;
let fail: { status: number; error: string } | null;
let nextId: number;

const COLLECTION = { person: 'people', role: 'roles', activity: 'activities', event: 'events' } as const;

beforeEach(() => {
  calls = [];
  fail = null;
  nextId = 100;
  current = structuredClone(base);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = url.replace('/api/internal/engagement', '');
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined;
      if (method === 'GET') return json(current);
      calls.push({ path, method, body });
      if (fail) return json({ error: fail.error }, fail.status);

      if (path === '/roles/bulk') {
        let added = 0;
        for (const r of body!.rows as Data['roles']) {
          const dup = current.roles.some(
            (x) => x.person_id === r.person_id && x.activity_id === r.activity_id && x.event_id === r.event_id
          );
          if (!dup) {
            current.roles.push({ ...r, id: nextId++ });
            added += 1;
          }
        }
        return json({ added });
      }
      const m = path.match(/^\/(person|role|activity|event)(?:\/(\d+))?$/);
      if (!m) return json(current);
      const list = current[COLLECTION[m[1] as keyof typeof COLLECTION]] as { id: number }[];
      if (method === 'POST') {
        const row = { id: nextId++, ...body, ...(m[1] === 'person' ? { mentor: body!.mentor ? 1 : 0 } : {}) };
        list.push(row);
        return json({ id: row.id }, 201);
      }
      const at = list.findIndex((x) => x.id === Number(m[2]));
      if (method === 'PUT') {
        Object.assign(list[at], body, m[1] === 'person' ? { mentor: body!.mentor ? 1 : 0 } : {});
        return json({ ok: true });
      }
      list.splice(at, 1);
      return json({ ok: true });
    })
  );
});

afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

const buttons = (root: Element) => [...root.querySelectorAll('button')];
const button = (root: Element, label: string) =>
  buttons(root).find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === label) ?? null;
const radio = (root: Element, name: string, value: string) =>
  root.querySelector(`input[name="${name}"][value="${value}"]`) as HTMLInputElement;
const field = (root: Element, label: string) =>
  [...root.querySelectorAll('label')]
    .find((l) => l.textContent?.trim().startsWith(label))
    ?.querySelector('input, select, textarea') as HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement;
const panel = (root: Element) => root.querySelector('aside') as HTMLElement;
const lastCall = () => calls[calls.length - 1];

async function setField(el: Element | null | undefined, value: string) {
  if (!el) throw new Error('setField: element not found');
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
const submit = async (form: Element | null) => {
  if (!form) throw new Error('submit: form not found');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
};

async function open() {
  const { container } = await render(<LeadershipApp />);
  await settle();
  return container;
}
const tab = (root: Element, label: string) => click(button(root, label));
const openPerson = (root: Element, name: string) => click(buttons(root).find((b) => b.textContent === name) ?? null);

describe('adding a person', () => {
  it('adds someone, then opens their panel', async () => {
    const c = await open();
    await click(button(c, 'Add a person'));
    expect(panel(c).textContent).toContain('Add a person');
    await setField(field(panel(c), 'Name'), '  Person C ');
    await setField(field(panel(c), 'Email'), 'c@example.org');
    await click(radio(panel(c), 'new-status', 'hiatus'));
    await click(field(panel(c), 'Available as a mentor'));
    await click(button(panel(c), 'Add person'));
    expect(lastCall()).toEqual({
      path: '/person',
      method: 'POST',
      body: { name: 'Person C', email: 'c@example.org', status: 'hiatus', mentor: true, notes: null },
    });
    await settle();
    expect(panel(c).getAttribute('aria-label')).toBe('Person C details');
  });

  it('keeps Add person off until there is a name, and warns about a repeat name', async () => {
    const c = await open();
    await click(button(c, 'Add a person'));
    expect((button(panel(c), 'Add person') as HTMLButtonElement).disabled).toBe(true);
    await setField(field(panel(c), 'Name'), 'person a');
    expect(panel(c).querySelector('[role="status"]')?.textContent).toContain('Person A is already on the list');
    await setField(field(panel(c), 'Name'), 'Someone New');
    expect(panel(c).querySelector('[role="status"]')).toBeNull();
    await submit(panel(c).querySelector('form'));
    expect(lastCall().body).toMatchObject({ name: 'Someone New', email: null, status: 'active', mentor: false });
  });

  it('does nothing on submit with no name, and cancels', async () => {
    const c = await open();
    await click(button(c, 'Add a person'));
    await submit(panel(c).querySelector('form'));
    expect(calls).toHaveLength(0);
    await click(button(panel(c), 'Cancel'));
    expect(c.querySelector('aside')).toBeNull();
  });

  it('shows the server’s reason when adding fails', async () => {
    const c = await open();
    await click(button(c, 'Add a person'));
    await setField(field(panel(c), 'Name'), 'Person C');
    fail = { status: 400, error: 'name is too long' };
    await click(button(panel(c), 'Add person'));
    expect(panel(c).querySelector('[role="alert"]')?.textContent).toBe('name is too long');
    expect(panel(c).getAttribute('aria-label')).toBe('Add a person');
  });
});

describe('editing a person', () => {
  it('changes the name and email', async () => {
    const c = await open();
    await openPerson(c, 'Person A');
    const save = button(panel(c), 'Save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await setField(field(panel(c), 'Name'), '');
    expect(save.disabled).toBe(true); // a name is required
    await setField(field(panel(c), 'Name'), ' Person AA ');
    await setField(field(panel(c), 'Email'), '');
    await click(save);
    expect(lastCall()).toMatchObject({ path: '/person/1', method: 'PUT', body: { name: 'Person AA', email: null } });
    await settle();
    expect(panel(c).querySelector('h2')?.textContent).toBe('Person AA');
    expect(panel(c).querySelector('[role="status"]')?.textContent).toContain('Saved');
  });
});

describe('roles on a person', () => {
  it('adds a role, newest event preselected', async () => {
    const c = await open();
    await openPerson(c, 'Person B');
    await click(button(panel(c), 'Add a role'));
    const form = panel(c).querySelector('form[aria-label="Add a role"]')!;
    expect(field(form, 'Event').value).toBe('1'); // 2025 is the newest
    expect([...field(form, 'Event').options].map((o) => o.textContent)).toEqual([
      '2025 Event One',
      '2024 Event Two',
      '2023 Empty Day',
    ]);
    expect((button(form, 'Add role') as HTMLButtonElement).disabled).toBe(true);
    await submit(form); // not ready: nothing sent
    expect(calls).toHaveLength(0);
    await setField(field(form, 'Event'), '2');
    await setField(field(form, 'Activity or class'), '3');
    await click(radio(form, 'role-type-new', 'partner'));
    await setField(field(form, 'How it went'), ' Lovely ');
    await click(button(form, 'Add role'));
    expect(lastCall()).toEqual({
      path: '/role',
      method: 'POST',
      body: { person_id: 2, activity_id: 3, event_id: 2, leadership_type: 'partner', how_it_went: 'Lovely' },
    });
    await settle();
    expect(panel(c).querySelector('form[aria-label="Add a role"]')).toBeNull(); // closed again
    expect(panel(c).textContent).toContain('Reel');
  });

  it('groups the activity choices by type and names classes', async () => {
    const c = await open();
    await openPerson(c, 'Person B');
    await click(button(panel(c), 'Add a role'));
    const groups = [...panel(c).querySelectorAll('optgroup')].map((g) => [
      g.label,
      [...g.querySelectorAll('option')].map((o) => o.textContent),
    ]);
    expect(groups).toEqual([
      ['Dancing', ['Reel']],
      ['Games', ['Games Class (class)', 'Tag (Active)']],
    ]);
  });

  it('explains a repeat in plain words, and cancels', async () => {
    const c = await open();
    await openPerson(c, 'Person A');
    await click(button(panel(c), 'Add a role'));
    const form = panel(c).querySelector('form[aria-label="Add a role"]')!;
    await setField(field(form, 'Activity or class'), '1');
    await click(radio(form, 'role-type-new', 'solo'));
    fail = { status: 409, error: 'already exists' };
    await click(button(form, 'Add role'));
    expect(form.querySelector('[role="alert"]')?.textContent).toBe(
      'That activity is already recorded for this person at this event.'
    );
    fail = { status: 400, error: 'bad' };
    await click(button(form, 'Add role'));
    expect(form.querySelector('[role="alert"]')?.textContent).toBe('bad');
    await click(button(form, 'Cancel'));
    expect(panel(c).querySelector('form[aria-label="Add a role"]')).toBeNull();
  });

  it('changes a role, keeping where it came from', async () => {
    const c = await open();
    await openPerson(c, 'Person A');
    await click(button(panel(c), 'Change Games Class'));
    const form = panel(c).querySelector('form[aria-label="Change role"]')!;
    expect(field(form, 'Activity or class').value).toBe('1');
    expect(field(form, 'How it went').value).toBe('Went well');
    await click(radio(form, 'role-type-1', 'partner'));
    await click(button(form, 'Save role'));
    expect(lastCall()).toEqual({
      path: '/role/1',
      method: 'PUT',
      body: {
        person_id: 1,
        activity_id: 1,
        event_id: 1,
        leadership_type: 'partner',
        how_it_went: 'Went well',
        source: 'sheet_import',
      },
    });
    await settle();
    expect(panel(c).querySelector('form[aria-label="Change role"]')).toBeNull();
  });

  it('cancels a change without saving', async () => {
    const c = await open();
    await openPerson(c, 'Person A');
    await click(buttons(panel(c)).find((b) => b.getAttribute('aria-label') === 'Change Games Class') ?? null);
    await click(button(panel(c).querySelector('form[aria-label="Change role"]')!, 'Cancel'));
    expect(panel(c).querySelector('form[aria-label="Change role"]')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('asks before removing a role, and Keep backs out', async () => {
    const c = await open();
    await openPerson(c, 'Person A');
    await click(button(panel(c), 'Remove Games Class'));
    expect(panel(c).querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Remove Games Class?');
    await click(button(panel(c), 'Keep'));
    expect(calls).toHaveLength(0);
    await click(button(panel(c), 'Remove Games Class'));
    await click(button(panel(c), 'Yes, remove'));
    expect(lastCall()).toEqual({ path: '/role/1', method: 'DELETE', body: undefined });
    await settle();
    expect(panel(c).textContent).not.toContain('Went well');
  });

  it('points to Events or Activities when there is nothing to attach a role to', async () => {
    current.events = [];
    const c = await open();
    await openPerson(c, 'Person A');
    await click(button(panel(c), 'Add a role'));
    expect(panel(c).textContent).toContain('Add an event before recording a role.');
    await click(button(panel(c), 'Go to Events'));
    expect(c.textContent).toContain('No events yet');
  });

  it('asks for an activity first when only events exist', async () => {
    current.activities = [];
    const c = await open();
    await openPerson(c, 'Person A');
    await click(button(panel(c), 'Add a role'));
    expect(panel(c).textContent).toContain('Add an activity before recording a role.');
    await click(button(panel(c), 'Go to Activities'));
    expect(c.textContent).toContain('No activities yet');
  });
});

describe('events', () => {
  it('lists events newest first with their counts', async () => {
    const c = await open();
    await tab(c, 'Events');
    const rows = [...c.querySelectorAll('li button[aria-pressed]')].map((b) => b.textContent);
    expect(rows).toEqual([
      '2025 Event One Extended2 roles, 2 people',
      '2024 Event Two Weekend1 role, 1 person',
      '2023 Empty Day One dayNo roles',
    ]);
  });

  it('adds an event', async () => {
    const c = await open();
    await tab(c, 'Events');
    await click(button(c, 'Add an event'));
    expect((button(panel(c), 'Add event') as HTMLButtonElement).disabled).toBe(true);
    await setField(field(panel(c), 'Name'), ' Spring Weekend ');
    await setField(field(panel(c), 'Year'), '2026');
    await click(radio(panel(c), 'event-type', 'weekend'));
    await click(button(panel(c), 'Add event'));
    expect(lastCall()).toEqual({
      path: '/event',
      method: 'POST',
      body: { name: 'Spring Weekend', event_type: 'weekend', year: 2026 },
    });
    await settle();
    expect(panel(c).getAttribute('aria-label')).toBe('2026 Spring Weekend details'); // now open
    expect(panel(c).textContent).toContain('No roles recorded yet.');
  });

  it('refuses a bad year, and explains a duplicate', async () => {
    const c = await open();
    await tab(c, 'Events');
    await click(button(c, 'Add an event'));
    await setField(field(panel(c), 'Name'), 'Camp');
    await click(radio(panel(c), 'event-type', 'extended'));
    await setField(field(panel(c), 'Year'), '1800');
    expect((button(panel(c), 'Add event') as HTMLButtonElement).disabled).toBe(true);
    await submit(panel(c).querySelector('form'));
    expect(calls).toHaveLength(0);
    await setField(field(panel(c), 'Year'), '2025');
    fail = { status: 409, error: 'already exists' };
    await click(button(panel(c), 'Add event'));
    expect(panel(c).querySelector('[role="alert"]')?.textContent).toBe(
      'An event with that name and year already exists.'
    );
    fail = { status: 500, error: 'server error' };
    await click(button(panel(c), 'Add event'));
    expect(panel(c).querySelector('[role="alert"]')?.textContent).toBe('server error');
    await click(button(panel(c), 'Cancel'));
    expect(c.querySelector('aside')).toBeNull();
  });

  it('edits an event and keeps its link to the public page', async () => {
    const c = await open();
    await tab(c, 'Events');
    await click(buttons(c).find((b) => b.textContent?.startsWith('2025 Event One')) ?? null);
    expect(field(panel(c), 'Name').value).toBe('Event One 2025');
    await setField(field(panel(c), 'Year'), '2026');
    await click(button(panel(c), 'Save'));
    expect(lastCall()).toEqual({
      path: '/event/1',
      method: 'PUT',
      body: { name: 'Event One 2025', event_type: 'extended', year: 2026, site_event_id: 'one' },
    });
    await settle();
    expect(panel(c).querySelector('[role="status"]')?.textContent).toBe('Saved');
  });

  it('lists the roles at an event and removes one', async () => {
    const c = await open();
    await tab(c, 'Events');
    await click(buttons(c).find((b) => b.textContent?.startsWith('2025 Event One')) ?? null);
    expect(panel(c).textContent).toContain('Games Class (class)');
    expect(panel(c).textContent).toContain('Person B');
    await click(button(panel(c), 'Remove Person B from Games Class'));
    await click(button(panel(c), 'Yes, remove'));
    expect(lastCall()).toEqual({ path: '/role/2', method: 'DELETE', body: undefined });
    await settle();
    expect(button(panel(c), 'Remove Person B from Games Class')).toBeNull(); // still in the picker, gone from the list
  });

  it('shows why a failed removal failed', async () => {
    const c = await open();
    await tab(c, 'Events');
    await click(buttons(c).find((b) => b.textContent?.startsWith('2025 Event One')) ?? null);
    fail = { status: 400, error: 'nope' };
    await click(button(panel(c), 'Remove Person B from Games Class'));
    await click(button(panel(c), 'Yes, remove'));
    expect(panel(c).querySelector('[role="alert"]')?.textContent).toBe('nope');
  });

  it('adds one activity’s roles for several people, skipping repeats', async () => {
    const c = await open();
    await tab(c, 'Events');
    await click(buttons(c).find((b) => b.textContent?.startsWith('2025 Event One')) ?? null);
    const form = panel(c).querySelector('form[aria-label="Add roles"]')!;
    expect((button(form, 'Add role') as HTMLButtonElement).disabled).toBe(true);
    await submit(form);
    expect(calls).toHaveLength(0);
    await setField(field(form, 'Activity or class'), '1');
    await click(radio(form, 'bulk-role', 'assisting'));
    await click(field(form, 'Person A')); // already solo here
    await click(field(form, 'Person B')); // already assisting here
    await click(field(form, 'Person B')); // unticked again
    await click(field(form, 'Person B'));
    expect(button(form, 'Add 2 roles')).not.toBeNull();
    await click(button(form, 'Add 2 roles'));
    expect(lastCall().path).toBe('/roles/bulk');
    expect(lastCall().body!.rows).toHaveLength(2);
    await settle();
    expect(form.querySelector('[role="status"]')?.textContent).toBe('Added 0 roles. 2 were already recorded.');

    await click(field(form, 'Person A'));
    await setField(field(form, 'Activity or class'), '3');
    await click(button(form, 'Add role'));
    await settle();
    expect(form.querySelector('[role="status"]')?.textContent).toBe('Added 1 role.');
    expect(field(form, 'Person A').checked).toBe(false); // people clear, activity and role stay
    expect(field(form, 'Activity or class').value).toBe('3');
  });

  it('says when one repeat was skipped', async () => {
    const c = await open();
    await tab(c, 'Events');
    await click(buttons(c).find((b) => b.textContent?.startsWith('2025 Event One')) ?? null);
    const form = panel(c).querySelector('form[aria-label="Add roles"]')!;
    await setField(field(form, 'Activity or class'), '1');
    await click(radio(form, 'bulk-role', 'solo'));
    await click(field(form, 'Person A'));
    await click(button(form, 'Add role'));
    await settle();
    expect(form.querySelector('[role="status"]')?.textContent).toBe('Added 0 roles. 1 was already recorded.');
  });

  it('finds people by name, and reports an empty search', async () => {
    const c = await open();
    await tab(c, 'Events');
    await click(buttons(c).find((b) => b.textContent?.startsWith('2025 Event One')) ?? null);
    const form = panel(c).querySelector('form[aria-label="Add roles"]')!;
    await setField(form.querySelector('input[type="search"]'), 'b');
    expect([...form.querySelectorAll('li label')].map((l) => l.textContent)).toEqual(['Person B']);
    await setField(form.querySelector('input[type="search"]'), 'zzz');
    expect(form.textContent).toContain('No one matches.');
  });

  it('shows a failure from adding roles', async () => {
    const c = await open();
    await tab(c, 'Events');
    await click(buttons(c).find((b) => b.textContent?.startsWith('2025 Event One')) ?? null);
    const form = panel(c).querySelector('form[aria-label="Add roles"]')!;
    await setField(field(form, 'Activity or class'), '3');
    await click(radio(form, 'bulk-role', 'solo'));
    await click(field(form, 'Person A'));
    fail = { status: 400, error: 'send between 1 and 200 roles' };
    await click(button(form, 'Add role'));
    expect(form.querySelector('[role="alert"]')?.textContent).toBe('send between 1 and 200 roles');
  });

  it('removes an event only when it has no roles', async () => {
    const c = await open();
    await tab(c, 'Events');
    await click(buttons(c).find((b) => b.textContent?.startsWith('2025 Event One')) ?? null);
    expect(panel(c).textContent).toContain('Has 2 roles. Remove them first.');
    await click(buttons(c).find((b) => b.textContent?.startsWith('2024 Event Two')) ?? null);
    expect(panel(c).textContent).toContain('Has 1 role. Remove them first.');
    await click(buttons(c).find((b) => b.textContent?.startsWith('2023 Empty Day')) ?? null);
    await click(button(panel(c), '2023 Empty Day'.replace(/^/, 'Remove ')));
    await click(button(panel(c), 'Yes, remove'));
    expect(lastCall()).toEqual({ path: '/event/3', method: 'DELETE', body: undefined });
    await settle();
    expect(c.querySelector('aside')).toBeNull();
    expect(c.textContent).not.toContain('Empty Day');
  });

  it('points to People or Activities when there is nothing to add roles from', async () => {
    current.activities = [];
    const c = await open();
    await tab(c, 'Events');
    await click(buttons(c).find((b) => b.textContent?.startsWith('2025 Event One')) ?? null);
    expect(panel(c).textContent).toContain('Add an activity before recording roles.');
    await click(button(panel(c), 'Go to Activities'));
    expect(c.textContent).toContain('No activities yet');

    current = structuredClone(base);
    current.people = [];
    const d = await open();
    await tab(d, 'Events');
    await click(buttons(d).find((b) => b.textContent?.startsWith('2025 Event One')) ?? null);
    const pane = [...d.querySelectorAll('aside')].pop()!;
    expect(pane.textContent).toContain('Add a person before recording roles.');
    await click(button(pane, 'Go to People'));
    expect(d.textContent).toContain('Showing');
  });

  it('shows an empty state, and an unknown kind of event as is', async () => {
    current.events = [{ id: 1, name: 'Odd', event_type: 'retreat', year: 2020 }];
    current.roles = [];
    const c = await open();
    await tab(c, 'Events');
    expect(c.textContent).toContain('2020 Odd');
    expect(c.textContent).toContain('retreat');
    current.events = [];
    const d = await open();
    await tab(d, 'Events');
    expect(d.textContent).toContain('No events yet. Add one to start recording roles.');
  });

  it('closes with Escape', async () => {
    const c = await open();
    await tab(c, 'Events');
    await click(buttons(c).find((b) => b.textContent?.startsWith('2025 Event One')) ?? null);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(c.querySelector('aside')).toBeNull();
  });
});

describe('activities', () => {
  it('groups by type with role counts', async () => {
    const c = await open();
    await tab(c, 'Activities');
    expect([...c.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['Dancing', 'Games']);
    expect([...c.querySelectorAll('li button[aria-pressed]')].map((b) => b.textContent)).toEqual([
      'Reel Activity0 roles',
      'Games Class Class2 roles',
      'Tag Activity, Active1 role',
    ]);
    expect(c.textContent).toContain('3 classes and activities in 2 types');
  });

  it('finds activities by name, type, or subtype', async () => {
    const c = await open();
    await tab(c, 'Activities');
    const find = (q: string) => setField(c.querySelector('input[type="search"]'), q);
    await find('tag');
    expect(c.textContent).toContain('Showing 1 of 3');
    expect([...c.querySelectorAll('li button[aria-pressed]')]).toHaveLength(1);
    await find('DANCING');
    expect([...c.querySelectorAll('li button[aria-pressed]')].map((b) => b.textContent)).toEqual([
      'Reel Activity0 roles',
    ]);
    await find('active'); // the subtype
    expect(c.textContent).toContain('Tag');
    await find('zzz');
    expect(c.textContent).toContain('No class or activity matches.');
    expect(c.textContent).toContain('Showing 0 of 3');
  });

  it('adds an activity, with a new type', async () => {
    const c = await open();
    await tab(c, 'Activities');
    await click(button(c, 'Add an activity'));
    expect((button(panel(c), 'Add activity') as HTMLButtonElement).disabled).toBe(true);
    await setField(field(panel(c), 'Name'), ' Shanty ');
    await click(radio(panel(c), 'scope', 'activity'));
    await setField(field(panel(c), 'Type'), 'Singing');
    expect(panel(c).textContent).toContain('A new type. It becomes a column in the People table.');
    await setField(field(panel(c), 'Type'), 'Music');
    expect(panel(c).textContent).not.toContain('A new type.');
    await setField(field(panel(c), 'Subtype'), 'Folk');
    await click(button(panel(c), 'Add activity'));
    expect(lastCall()).toEqual({
      path: '/activity',
      method: 'POST',
      body: { name: 'Shanty', scope: 'activity', type: 'Music', subtype: 'Folk' },
    });
    await settle();
    expect(panel(c).getAttribute('aria-label')).toBe('Shanty details');
  });

  it('suggests the subtypes already used under a type', async () => {
    const c = await open();
    await tab(c, 'Activities');
    await click(button(c, 'Add an activity'));
    await setField(field(panel(c), 'Type'), 'Games');
    expect([...panel(c).querySelectorAll('#activity-subtypes option')].map((o) => o.getAttribute('value'))).toEqual([
      'Active',
    ]);
  });

  it('refuses an incomplete form, explains a duplicate, and cancels', async () => {
    const c = await open();
    await tab(c, 'Activities');
    await click(button(c, 'Add an activity'));
    await submit(panel(c).querySelector('form'));
    expect(calls).toHaveLength(0);
    await setField(field(panel(c), 'Name'), 'Tag');
    await click(radio(panel(c), 'scope', 'activity'));
    await setField(field(panel(c), 'Type'), 'Games');
    fail = { status: 409, error: 'already exists' };
    await click(button(panel(c), 'Add activity'));
    expect(panel(c).querySelector('[role="alert"]')?.textContent).toBe(
      'A class or activity with that name already exists.'
    );
    fail = { status: 500, error: 'server error' };
    await click(button(panel(c), 'Add activity'));
    expect(panel(c).querySelector('[role="alert"]')?.textContent).toBe('server error');
    await click(button(panel(c), 'Cancel'));
    expect(c.querySelector('aside')).toBeNull();
  });

  it('edits an activity and keeps its link to the public page', async () => {
    const c = await open();
    await tab(c, 'Activities');
    await click(buttons(c).find((b) => b.textContent?.startsWith('Games Class')) ?? null);
    expect((button(panel(c), 'Save') as HTMLButtonElement).disabled).toBe(true);
    await setField(field(panel(c), 'Subtype'), 'Warm up');
    await click(button(panel(c), 'Save'));
    expect(lastCall()).toEqual({
      path: '/activity/1',
      method: 'PUT',
      body: { name: 'Games Class', scope: 'class', type: 'Games', subtype: 'Warm up', site_activity_id: 'games' },
    });
    await settle();
    expect(panel(c).querySelector('[role="status"]')?.textContent).toBe('Saved');
  });

  it('removes an activity only when no role uses it', async () => {
    const c = await open();
    await tab(c, 'Activities');
    await click(buttons(c).find((b) => b.textContent?.startsWith('Games Class')) ?? null);
    expect(panel(c).textContent).toContain('Used in 2 roles. Remove those roles first.');
    await click(buttons(c).find((b) => b.textContent?.startsWith('Tag')) ?? null);
    expect(panel(c).textContent).toContain('Used in 1 role. Remove those roles first.');
    await click(buttons(c).find((b) => b.textContent?.startsWith('Reel')) ?? null);
    await click(button(panel(c), 'Remove Reel'));
    await click(button(panel(c), 'Yes, remove'));
    expect(lastCall()).toEqual({ path: '/activity/3', method: 'DELETE', body: undefined });
    await settle();
    expect(c.querySelector('aside')).toBeNull();
    expect(c.textContent).not.toContain('Reel');
  });

  it('shows an empty state and a singular count', async () => {
    current.activities = [current.activities[2]];
    current.roles = [];
    const c = await open();
    await tab(c, 'Activities');
    expect(c.textContent).toContain('1 class or activity in 1 type');
    current.activities = [];
    const d = await open();
    await tab(d, 'Activities');
    expect(d.textContent).toContain('No activities yet. Add one to start recording roles.');
  });
});

describe('failed removals', () => {
  it('keeps an event open and says why', async () => {
    const c = await open();
    await tab(c, 'Events');
    await click(buttons(c).find((b) => b.textContent?.startsWith('2023 Empty Day')) ?? null);
    await click(button(panel(c), 'Remove 2023 Empty Day'));
    fail = { status: 400, error: 'It still has 1 role. Remove it first.' };
    await click(button(panel(c), 'Yes, remove'));
    expect(panel(c).textContent).toContain('It still has 1 role. Remove it first.');
  });

  it('keeps an activity open and says why', async () => {
    const c = await open();
    await tab(c, 'Activities');
    await click(buttons(c).find((b) => b.textContent?.startsWith('Reel')) ?? null);
    await click(button(panel(c), 'Remove Reel'));
    fail = { status: 400, error: 'It still has 1 role. Remove it first.' };
    await click(button(panel(c), 'Yes, remove'));
    expect(panel(c).textContent).toContain('It still has 1 role. Remove it first.');
  });
});

describe('moving between sections', () => {
  it('marks the current section and returns to People', async () => {
    const c = await open();
    const nav = c.querySelector('nav[aria-label="Sections"]')!;
    expect(button(nav, 'People')!.getAttribute('aria-current')).toBe('page');
    await tab(c, 'Events');
    expect(button(nav, 'Events')!.getAttribute('aria-current')).toBe('page');
    expect(button(nav, 'People')!.getAttribute('aria-current')).toBeNull();
    await tab(c, 'People');
    expect(c.textContent).toContain('Showing 2 of 2');
  });
});
