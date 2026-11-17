// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, cleanup, render, settle, type } from '../../__tests__/react';
import LeadershipApp from './LeadershipApp';
import type { Data } from './model';

// Placeholder names only.
const base: Data = {
  me: 'board@example.org',
  people: [
    { id: 1, name: 'Person A', email: 'a@example.org', leader_slug: null, status: 'active', mentor: 0, notes: null },
    { id: 2, name: 'Person B', email: null, leader_slug: null, status: 'hiatus', mentor: 1, notes: null },
  ],
  activities: [{ id: 1, name: 'Games Class', scope: 'class', type: 'Games', subtype: null }],
  events: [{ id: 1, name: 'Event One', event_type: 'extended', year: 2025 }],
  roles: [{ id: 1, person_id: 1, activity_id: 1, event_id: 1, leadership_type: 'solo', how_it_went: null }],
  notes: [],
  activityTypes: ['Games', 'Dancing'],
};

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

let calls: { url: string; method: string; body?: string }[];
let current: Data;
let failWrites: string | null;
let rawWrite: (() => Promise<Response>) | null;

beforeEach(() => {
  calls = [];
  failWrites = null;
  rawWrite = null;
  current = structuredClone(base);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body as string | undefined });
      if (method !== 'GET' && rawWrite) return rawWrite();
      if (method !== 'GET' && failWrites) return json({ error: failWrites }, 400);
      if (url.endsWith('/note') && method === 'POST') {
        const n = JSON.parse(init!.body as string);
        current.notes.push({ id: 9, author: 'board@example.org', created_at: '2025-11-17T00:00:00Z', ...n });
        return json({ id: 9 }, 201);
      }
      const person = url.match(/\/person\/(\d+)$/);
      if (person && method === 'PUT') {
        const p = current.people.find((x) => x.id === Number(person[1]))!;
        const body = JSON.parse(init!.body as string);
        Object.assign(p, { ...body, mentor: body.mentor ? 1 : 0 });
        return json({ ok: true });
      }
      const note = url.match(/\/note\/(\d+)$/);
      if (note && method === 'DELETE') {
        current.notes = current.notes.filter((n) => n.id !== Number(note[1]));
        return json({ ok: true });
      }
      return json(current);
    })
  );
});

const button = (root: Element, label: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) ?? null;

/** Sets a controlled textarea or select the way a user would. */
async function setField(el: HTMLTextAreaElement | HTMLSelectElement | HTMLInputElement | null, value: string) {
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

const rowNames = (root: Element) => [...root.querySelectorAll('tbody th button')].map((b) => b.textContent);

afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe('LeadershipApp', () => {
  it('loads and shows each person with their experience', async () => {
    const { container } = await render(<LeadershipApp />);
    await settle();
    expect(container.textContent).toContain('Person A');
    expect(container.textContent).toContain('Person B');
    expect(container.textContent).toContain('Class S1');
    expect(container.textContent).toContain('Signed in as board@example.org');
  });

  it('shows a readable error when the API refuses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => json({ error: 'unauthorized' }, 401))
    );
    const { container } = await render(<LeadershipApp />);
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('unauthorized');
  });

  it('filters by name', async () => {
    const { container } = await render(<LeadershipApp />);
    await settle();
    await type(container.querySelector('input[type="search"]'), 'person b');
    expect(container.textContent).not.toContain('Person A');
    expect(container.textContent).toContain('Person B');
  });

  it('opens a person and adds a readiness note, then reloads', async () => {
    const { container } = await render(<LeadershipApp />);
    await settle();
    await click([...container.querySelectorAll('button')].find((b) => b.textContent === 'Person A') ?? null);
    expect(container.querySelector('aside')?.textContent).toContain('Experience');

    const textarea = container.querySelector('textarea[aria-label="Note"]') as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(textarea, 'Ready to co-lead');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click([...container.querySelectorAll('button')].find((b) => b.textContent === 'Add note') ?? null);
    await settle();

    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/internal/leadership/note');
    expect(JSON.parse(post.body!)).toMatchObject({ person_id: 1, kind: 'note', body: 'Ready to co-lead' });
    expect(container.querySelector('aside')?.textContent).toContain('Ready to co-lead');
  });
});

describe('LeadershipApp: dashboard controls', () => {
  it('sorts by clicking a header, toggling direction', async () => {
    const { container } = await render(<LeadershipApp />);
    await settle();
    expect(rowNames(container)).toEqual(['Person A', 'Person B']);

    await click(button(container, 'Total'));
    expect(button(container, 'Total ▼')).not.toBeNull(); // biggest first
    expect(rowNames(container)).toEqual(['Person A', 'Person B']);
    await click(button(container, 'Total ▼'));
    expect(button(container, 'Total ▲')).not.toBeNull(); // flipped
    expect(rowNames(container)).toEqual(['Person B', 'Person A']);
    await click(button(container, 'Person')); // back to names, A to Z
    expect(rowNames(container)).toEqual(['Person A', 'Person B']);
    await click(button(container, 'Person ▲'));
    expect(rowNames(container)).toEqual(['Person B', 'Person A']); // names flip too
  });

  it('filters by status and says so when no one matches', async () => {
    const { container } = await render(<LeadershipApp />);
    await settle();
    await setField(container.querySelector('select'), 'hiatus');
    expect(rowNames(container)).toEqual(['Person B']);
    expect(container.textContent).toContain('On hiatus');
    await setField(container.querySelector('select'), 'inactive');
    expect(container.textContent).toContain('No one matches.');
  });

  it('shows mentors, and can list only mentors whatever their leading status', async () => {
    const { container } = await render(<LeadershipApp />);
    await settle();
    expect(container.querySelector('tbody')?.textContent).toContain('On hiatus · Mentor');
    await click(container.querySelector('input[type="checkbox"]'));
    expect(rowNames(container)).toEqual(['Person B']);
    await click(container.querySelector('input[type="checkbox"]'));
    expect(rowNames(container)).toEqual(['Person A', 'Person B']);
  });

  it('shows the latest "ready" note on the person’s row', async () => {
    current.notes.push({
      id: 3,
      person_id: 1,
      kind: 'ready',
      focus: 'games class',
      body: 'Ready to co-lead',
      author: 'x@example.org',
      created_at: '2025-06-01T00:00:00Z',
    });
    const { container } = await render(<LeadershipApp />);
    await settle();
    expect(container.querySelector('tbody')?.textContent).toContain('games class: Ready to co-lead');
  });

  it('reports a network failure with a hint to reload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    );
    const { container } = await render(<LeadershipApp />);
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('sign-in may have expired');
  });
});

describe('LeadershipApp: person panel', () => {
  const open = async (container: Element) => {
    await settle();
    await click(button(container, 'Person A'));
    return container.querySelector('aside') as HTMLElement;
  };

  it('saves a changed status and private note, enabling Save only when dirty', async () => {
    const { container } = await render(<LeadershipApp />);
    const aside = await open(container);
    expect((button(aside, 'Save') as HTMLButtonElement).disabled).toBe(true);

    await setField(aside.querySelector('select'), 'inactive');
    await click(aside.querySelector('input[type="checkbox"]'));
    await setField(aside.querySelector('textarea'), 'Knows the games well');
    expect((button(aside, 'Save') as HTMLButtonElement).disabled).toBe(false);
    await click(button(aside, 'Save'));
    await settle();

    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toBe('/api/internal/leadership/person/1');
    expect(JSON.parse(put.body!)).toMatchObject({
      status: 'inactive',
      mentor: true,
      notes: 'Knows the games well',
      name: 'Person A',
    });
    expect(container.querySelector('tbody')?.textContent).toContain('Inactive · Mentor');
  });

  it('treats a mentoring change alone as unsaved, and undoing it as clean', async () => {
    const { container } = await render(<LeadershipApp />);
    const aside = await open(container);
    const save = () => button(aside, 'Save') as HTMLButtonElement;
    await click(aside.querySelector('input[type="checkbox"]'));
    expect(save().disabled).toBe(false);
    await click(aside.querySelector('input[type="checkbox"]'));
    expect(save().disabled).toBe(true);
  });

  it('adds a "ready" note with a focus', async () => {
    const { container } = await render(<LeadershipApp />);
    const aside = await open(container);
    await setField(aside.querySelector('select[aria-label="Note type"]'), 'ready');
    await setField(aside.querySelector('input[aria-label="Focus (optional)"]'), 'dance class');
    await setField(aside.querySelector('textarea[aria-label="Note"]'), 'Partnered well');
    await click(button(aside, 'Add note'));
    await settle();

    const post = calls.find((c) => c.method === 'POST')!;
    expect(JSON.parse(post.body!)).toMatchObject({ kind: 'ready', focus: 'dance class', body: 'Partnered well' });
    expect(container.querySelector('aside')?.textContent).toContain('dance class: Partnered well');
  });

  it('deletes a note', async () => {
    current.notes.push({
      id: 5,
      person_id: 1,
      kind: 'note',
      focus: null,
      body: 'Temporary remark',
      author: 'x@example.org',
      created_at: '2025-06-01T00:00:00Z',
    });
    const { container } = await render(<LeadershipApp />);
    const aside = await open(container);
    expect(aside.textContent).toContain('Temporary remark');
    await click(button(aside, 'Delete'));
    await settle();

    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/note/5'))).toBe(true);
    expect(container.querySelector('aside')?.textContent).not.toContain('Temporary remark');
    expect(container.querySelector('aside')?.textContent).toContain('No notes yet.');
  });

  it('shows the server’s message when a save fails, and keeps the form', async () => {
    const { container } = await render(<LeadershipApp />);
    const aside = await open(container);
    failWrites = 'body is too long';
    await setField(aside.querySelector('textarea[aria-label="Note"]'), 'x');
    await click(button(aside, 'Add note'));
    await settle();
    expect(container.querySelector('aside [role="alert"]')?.textContent).toContain('body is too long');
    expect((container.querySelector('textarea[aria-label="Note"]') as HTMLTextAreaElement).value).toBe('x');
  });

  it('ignores an empty note and closes the panel', async () => {
    const { container } = await render(<LeadershipApp />);
    const aside = await open(container);
    expect((button(aside, 'Add note') as HTMLButtonElement).disabled).toBe(true);
    await click(button(aside, 'Close'));
    expect(container.querySelector('aside')).toBeNull();
    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  it('shows a person with no roles and an empty history message', async () => {
    const { container } = await render(<LeadershipApp />);
    await settle();
    await click(button(container, 'Person B'));
    expect(container.querySelector('aside')?.textContent).toContain('No roles recorded.');
  });
});

describe('LeadershipApp: unusual data and failures', () => {
  const openByName = async (container: Element, name: string) => {
    await settle();
    await click(button(container, name));
    return container.querySelector('aside') as HTMLElement;
  };

  it('shows a plain message when a successful response is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('<html>oops</html>', { status: 200 })))
    );
    const { container } = await render(<LeadershipApp />);
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not load the leadership data.');
  });

  it('shows activity-level experience, subtype, notes, and a role with no known event', async () => {
    current.activities.push({ id: 2, name: 'Tag', scope: 'activity', type: 'Games', subtype: 'Active' });
    current.roles.push({
      id: 2,
      person_id: 2,
      activity_id: 2,
      event_id: 99,
      leadership_type: 'partner',
      how_it_went: 'Went smoothly',
    });
    const { container } = await render(<LeadershipApp />);
    await settle();
    expect(container.querySelector('tbody')?.textContent).toContain('Act. P1');
    await click(button(container, 'Person B'));
    const text = container.querySelector('aside')?.textContent ?? '';
    expect(text).toContain('Tag');
    expect(text).toContain('Partner · Activity · Games / Active');
    expect(text).toContain('Went smoothly');
    expect(text).not.toContain('Event One');
  });

  it('lists a person’s notes newest first', async () => {
    const note = (id: number, body: string, created_at: string) =>
      ({ id, person_id: 1, kind: 'note', focus: null, body, author: 'x@example.org', created_at }) as const;
    current.notes.push(
      note(5, 'Older remark', '2025-01-01T00:00:00Z'),
      note(6, 'Newer remark', '2025-09-01T00:00:00Z')
    );
    const { container } = await render(<LeadershipApp />);
    const aside = await openByName(container, 'Person A');
    const text = aside.textContent ?? '';
    expect(text.indexOf('Newer remark')).toBeLessThan(text.indexOf('Older remark'));
  });

  it('saves a cleared private note as empty', async () => {
    current.people[0].notes = 'Old private note';
    const { container } = await render(<LeadershipApp />);
    const aside = await openByName(container, 'Person A');
    await setField(aside.querySelector('textarea'), '   ');
    await click(button(aside, 'Save'));
    await settle();
    expect(JSON.parse(calls.find((c) => c.method === 'PUT')!.body!).notes).toBeNull();
  });

  it('does nothing when the note form is submitted empty', async () => {
    const { container } = await render(<LeadershipApp />);
    const aside = await openByName(container, 'Person A');
    await act(async () => {
      aside.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  it('falls back to the status code when an error response has no JSON body', async () => {
    const { container } = await render(<LeadershipApp />);
    const aside = await openByName(container, 'Person A');
    rawWrite = () => Promise.resolve(new Response('Bad gateway', { status: 502 }));
    await setField(aside.querySelector('textarea[aria-label="Note"]'), 'x');
    await click(button(aside, 'Add note'));
    await settle();
    expect(container.querySelector('aside [role="alert"]')?.textContent).toContain('Request failed (502)');
  });

  it('shows a generic message for an unexpected failure', async () => {
    const { container } = await render(<LeadershipApp />);
    const aside = await openByName(container, 'Person A');
    rawWrite = () => Promise.resolve(new Response('not json', { status: 200 }));
    await setField(aside.querySelector('textarea[aria-label="Note"]'), 'x');
    await click(button(aside, 'Add note'));
    await settle();
    expect(container.querySelector('aside [role="alert"]')?.textContent).toContain('Something went wrong.');
  });
});
