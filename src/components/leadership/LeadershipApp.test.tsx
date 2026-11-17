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
    { id: 1, name: 'Person A', email: 'a@example.org', leader_slug: null, status: 'active', notes: null },
    { id: 2, name: 'Person B', email: null, leader_slug: null, status: 'hiatus', notes: null },
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

beforeEach(() => {
  calls = [];
  current = structuredClone(base);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined });
      if (url.endsWith('/note') && init?.method === 'POST') {
        const n = JSON.parse(init.body as string);
        current.notes.push({ id: 9, author: 'board@example.org', created_at: '2025-11-17T00:00:00Z', ...n });
        return json({ id: 9 }, 201);
      }
      return json(current);
    })
  );
});

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
