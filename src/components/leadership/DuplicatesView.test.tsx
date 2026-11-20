// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buttonWithText, click, cleanup, render, settle } from '../../__tests__/react';
import LeadershipApp from './LeadershipApp';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

let pairs: unknown[];
let calls: string[];
let previewFails: boolean;
let listFails: boolean;
let counts: Record<string, number>;

beforeEach(() => {
  pairs = [{ a: { id: 1, name: 'Debra Dunn' }, b: { id: 2, name: 'Debbie Dunn' }, reasons: ['similar name'] }];
  calls = [];
  previewFails = false;
  listFails = false;
  counts = { registration: 3, role: 0 };
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = url.replace('/api/internal/engagement', '');
      const method = init?.method ?? 'GET';
      if (path === '/bootstrap')
        return json({
          me: 'a@example.org',
          level: 'standard',
          isAdmin: true,
          people: [],
          activities: [],
          events: [],
          roles: [],
          notes: [],
          activityTypes: [],
        });
      if (path === '/duplicates') return listFails ? json({ error: 'nope' }, 500) : json({ pairs });
      calls.push(`${method} ${path}`);
      if (method === 'GET')
        return previewFails
          ? json({ error: 'gone' }, 404)
          : json({
              from: { id: 2, name: 'Debbie Dunn' },
              into: { id: 1, name: 'Debra Dunn' },
              counts: counts,
            });
      pairs = [];
      return json({ into: 1 });
    })
  );
});
afterEach(cleanup);

const open = async () => {
  const c = await render(<LeadershipApp />);
  await settle();
  await click(buttonWithText(c.container, 'Duplicates'));
  await settle();
  return c;
};

describe('Duplicates view', () => {
  it('previews what moves, then merges and refreshes the list', async () => {
    const c = await open();
    expect(c.container.textContent).toContain('Debra Dunn and Debbie Dunn');
    await click(buttonWithText(c.container, 'Keep Debra Dunn'));
    await settle();
    expect(c.container.textContent).toContain('Move 3 registrations from Debbie Dunn to Debra Dunn');
    await click(buttonWithText(c.container, 'Merge into Debra Dunn'));
    await settle();
    expect(calls).toContain('POST /merge/2/1');
    expect(c.container.textContent).toContain('No likely duplicates');
  });

  it('can be cancelled, and can keep the other record', async () => {
    const c = await open();
    await click(buttonWithText(c.container, 'Keep Debbie Dunn'));
    await settle();
    expect(calls).toContain('GET /merge/1/2');
    await click(buttonWithText(c.container, 'Cancel'));
    expect(buttonWithText(c.container, 'Keep Debra Dunn')).toBeTruthy();
  });

  it('reports a failed preview and a failed list', async () => {
    previewFails = true;
    const c = await open();
    await click(buttonWithText(c.container, 'Keep Debra Dunn'));
    await settle();
    expect(c.container.textContent).toContain('gone');
    await click(buttonWithText(c.container, 'Back'));
    expect(buttonWithText(c.container, 'Keep Debra Dunn')).toBeTruthy();
    await cleanup();
    listFails = true;
    const d = await open();
    expect(d.container.textContent).toContain('nope');
  });
});

describe('Duplicates view wording', () => {
  it('names unknown record kinds as they are, and says when nothing else moves', async () => {
    counts = { mystery: 2 };
    const c = await open();
    await click(buttonWithText(c.container, 'Keep Debra Dunn'));
    await settle();
    expect(c.container.textContent).toContain('Move 2 mystery from');
    await cleanup();
    counts = { registration: 0 };
    const d = await open();
    await click(buttonWithText(d.container, 'Keep Debra Dunn'));
    await settle();
    expect(d.container.textContent).toContain('Move nothing else from');
  });
});
