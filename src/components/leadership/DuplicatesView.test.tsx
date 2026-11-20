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

beforeEach(() => {
  pairs = [{ a: { id: 1, name: 'Debra Dunn' }, b: { id: 2, name: 'Debbie Dunn' }, reasons: ['similar name'] }];
  calls = [];
  previewFails = false;
  listFails = false;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = url.replace('/api/internal/leadership', '');
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
              counts: { registration: 3, role: 0 },
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
