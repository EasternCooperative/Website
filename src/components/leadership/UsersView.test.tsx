// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, cleanup, render, settle, type } from '../../__tests__/react';
import LeadershipApp from './LeadershipApp';
import type { AppUser, Data } from './model';

const data = (extra: Partial<Data> = {}): Data => ({
  me: 'Admin@example.org',
  level: 'standard',
  isAdmin: true,
  people: [],
  activities: [],
  events: [],
  roles: [],
  notes: [],
  activityTypes: [],
  ...extra,
});

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

let boot: Data;
let users: AppUser[];
let calls: { path: string; method: string; body?: Record<string, unknown> }[];
let fail: { status: number; error: string } | null;
let listFails: boolean;

beforeEach(() => {
  boot = data();
  users = [
    { email: 'admin@example.org', level: 'standard', is_admin: 1 },
    { email: 'treasurer@example.org', level: 'finance', is_admin: 0 },
  ];
  calls = [];
  fail = null;
  listFails = false;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = url.replace('/api/internal/engagement', '');
      const method = init?.method ?? 'GET';
      if (path === '/bootstrap') return json(boot);
      if (path === '/users' && method === 'GET') return listFails ? json({ error: 'nope' }, 403) : json({ users });
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ path, method, body });
      if (fail) return json({ error: fail.error }, fail.status);
      if (method === 'POST') {
        const at = users.findIndex((u) => u.email === body.email.toLowerCase());
        const row = { email: body.email.toLowerCase(), level: body.level, is_admin: body.is_admin ? 1 : 0 };
        if (at >= 0) users[at] = row;
        else users.push(row);
      } else users = users.filter((u) => u.email !== decodeURIComponent(path.split('/')[2]));
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
async function open() {
  const { container } = await render(<LeadershipApp />);
  await settle();
  return container;
}
const accessTab = async (c: Element) => {
  await click(button(c, 'Access'));
  await settle();
};

describe('who is signed in', () => {
  it('shows the level and admin status', async () => {
    const c = await open();
    expect(c.textContent).toContain('Signed in as Admin@example.org, Standard access, admin');
  });

  it('shows Finance access for the treasurer, with no Access tab', async () => {
    boot = data({ me: 'treasurer@example.org', level: 'finance', isAdmin: false });
    const c = await open();
    expect(c.textContent).toContain('Signed in as treasurer@example.org, Finance access');
    expect(c.textContent).not.toContain('admin');
    expect(button(c, 'Access')).toBeNull();
  });

  it('shows no level when the server did not send one', async () => {
    boot = data({ level: undefined, isAdmin: undefined });
    const c = await open();
    expect(c.textContent).toContain('Signed in as Admin@example.org');
    expect(c.textContent).not.toContain('access,');
  });

  it('explains how to get in when the server refuses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => json({ error: 'You are signed in, but not on the access list. Ask an admin to add you.' }, 403))
    );
    const c = await open();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Ask an admin to add you');
  });
});

describe('the access list when the server omits who you are', () => {
  it('still opens, with nobody marked as you', async () => {
    boot = data({ me: undefined });
    const c = await open();
    await accessTab(c);
    expect(c.textContent).not.toContain('(you)');
  });
});

describe('a protected owner', () => {
  it('is marked, and offers no way to change or remove them', async () => {
    users = [
      { email: 'admin@example.org', level: 'standard', is_admin: 1 },
      { email: 'owner@example.org', level: 'finance', is_admin: 1, protected: 1 },
    ];
    const c = await open();
    await accessTab(c);
    expect(c.textContent).toContain('owner@example.orgFinance, admin, protected');
    await click(buttons(c).find((b) => b.textContent?.startsWith('owner@')) ?? null);
    expect(panel(c).textContent).toContain('Protected. This access can’t be changed or removed.');
    expect(button(panel(c), 'Save')).toBeNull();
    expect(button(panel(c), 'Remove owner@example.org')).toBeNull();
  });
});

describe('the access list', () => {
  it('lists everyone, marking you', async () => {
    const c = await open();
    await accessTab(c);
    const rows = [...c.querySelectorAll('li button[aria-pressed]')].map((b) => b.textContent);
    expect(rows).toEqual(['admin@example.org(you)Standard, admin', 'treasurer@example.orgFinance']);
  });

  it('adds someone as Finance, and an admin', async () => {
    const c = await open();
    await accessTab(c);
    await click(button(c, 'Add someone'));
    expect((button(panel(c), 'Add person') as HTMLButtonElement).disabled).toBe(true);
    await type(panel(c).querySelector('input[type="email"]'), ' New@Example.org ');
    await click(panel(c).querySelector('input[name="access-level"][value="finance"]'));
    expect(panel(c).textContent).toContain('Sees exact donation amounts');
    await click(panel(c).querySelector('input[type="checkbox"]'));
    await click(button(panel(c), 'Add person'));
    expect(calls.at(-1)).toEqual({
      path: '/users',
      method: 'POST',
      body: { email: 'New@Example.org', level: 'finance', is_admin: true },
    });
    await settle();
    expect(c.textContent).toContain('new@example.orgFinance, admin');
    expect(c.querySelector('aside')).toBeNull(); // closes after saving
  });

  it('does nothing on an empty submit, and cancels', async () => {
    const c = await open();
    await accessTab(c);
    await click(button(c, 'Add someone'));
    await act(async () => {
      panel(c)
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(calls).toHaveLength(0);
    await click(button(panel(c), 'Cancel'));
    expect(c.querySelector('aside')).toBeNull();
  });

  it('changes someone’s level', async () => {
    const c = await open();
    await accessTab(c);
    await click(buttons(c).find((b) => b.textContent?.startsWith('treasurer')) ?? null);
    await click(panel(c).querySelector('input[name="access-level"][value="standard"]'));
    expect(panel(c).textContent).toContain('Giving shows as a broad tier');
    await click(button(panel(c), 'Save'));
    expect(calls.at(-1)?.body).toEqual({ email: 'treasurer@example.org', level: 'standard', is_admin: false });
  });

  it('removes someone after asking', async () => {
    const c = await open();
    await accessTab(c);
    await click(buttons(c).find((b) => b.textContent?.startsWith('treasurer')) ?? null);
    await click(button(panel(c), 'Remove treasurer@example.org'));
    await click(button(panel(c), 'Yes, remove'));
    expect(calls.at(-1)).toEqual({ path: '/users/treasurer%40example.org', method: 'DELETE', body: undefined });
    await settle();
    expect(c.textContent).not.toContain('treasurer@example.org');
  });

  it('does not offer to change or remove yourself', async () => {
    const c = await open();
    await accessTab(c);
    await click(buttons(c).find((b) => b.textContent?.startsWith('admin@')) ?? null);
    expect(panel(c).textContent).toContain('This is you. Ask another admin to change your access.');
    expect(button(panel(c), 'Save')).toBeNull();
    expect(button(panel(c), 'Remove admin@example.org')).toBeNull();
    await act(async () => {
      panel(c)
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(calls).toHaveLength(0);
  });

  it('shows the server’s reason when saving fails', async () => {
    const c = await open();
    await accessTab(c);
    await click(button(c, 'Add someone'));
    await type(panel(c).querySelector('input[type="email"]'), 'x@example.org');
    fail = { status: 400, error: 'enter a valid email address' };
    await click(button(panel(c), 'Add person'));
    expect(panel(c).querySelector('[role="alert"]')?.textContent).toBe('enter a valid email address');
  });

  it('keeps the panel open when a removal fails', async () => {
    const c = await open();
    await accessTab(c);
    await click(buttons(c).find((b) => b.textContent?.startsWith('treasurer')) ?? null);
    await click(button(panel(c), 'Remove treasurer@example.org'));
    fail = { status: 400, error: 'could not remove' };
    await click(button(panel(c), 'Yes, remove'));
    expect(panel(c).textContent).toContain('could not remove');
  });

  it('says so when the list cannot be loaded', async () => {
    listFails = true;
    const c = await open();
    await accessTab(c);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('nope');
  });
});
