// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { buttonWithText, click, cleanup, render, settle } from '../../__tests__/react';
import LeadershipApp from './LeadershipApp';

// Placeholder names only.
const data = (isAdmin: boolean) => ({
  me: 'a@example.org',
  level: 'standard',
  isAdmin,
  people: [{ id: 5, name: 'Person A', email: null, leader_slug: null, status: 'active', mentor: 0, notes: null }],
  activities: [],
  events: [],
  roles: [],
  notes: [],
  service: [],
  volunteers: [],
  outreach: [],
  activityTypes: [],
});
let admin = false;
beforeEach(() => {
  admin = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(data(admin)), { status: 200 })))
  );
});
afterEach(cleanup);

const open = async (hash = '') => {
  window.history.replaceState(null, '', `/${hash}`);
  const c = await render(<LeadershipApp />);
  await settle();
  return c.container;
};
const current = (c: Element) => c.querySelector('nav [aria-current="page"]')?.textContent;

describe('addresses', () => {
  it('opens a person from a link, and a view from a link', async () => {
    const c = await open('#/people/5');
    expect(c.querySelector('aside, [aria-label*="Person A"]')).toBeTruthy();
    await cleanup();
    expect(current(await open('#/events'))).toBe('Events');
  });

  it('keeps the address in step as you move, and follows Back', async () => {
    const c = await open();
    expect(current(c)).toBe('Staff an event'); // the tool opens on staffing
    await click(buttonWithText(c, 'Events'));
    expect(window.location.hash).toBe('#/events');
    await click(buttonWithText(c, 'Outreach'));
    expect(window.location.hash).toBe('#/lists');
    await act(async () => {
      window.history.replaceState(null, '', '/#/events');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(current(c)).toBe('Events');
  });

  it('does not open an admin view from a link for someone who is not an admin', async () => {
    expect(current(await open('#/users'))).toBe('Staff an event');
  });
});

describe('the Admin menu', () => {
  beforeEach(() => {
    admin = true;
  });
  it('opens, picks a view, and marks itself current', async () => {
    const c = await open();
    expect(c.textContent).not.toContain('Duplicates');
    await click(buttonWithText(c, /^Admin/));
    await click(buttonWithText(c, 'Duplicates'));
    expect(window.location.hash).toBe('#/duplicates');
    expect(c.textContent).not.toContain('Access'); // the menu closed
    expect(buttonWithText(c, /^Admin/)!.className).toContain('border-primary');
    await click(buttonWithText(c, /^Admin/));
    expect(buttonWithText(c, 'Duplicates')!.getAttribute('aria-current')).toBe('page');
  });

  it('closes on Escape and on a click elsewhere', async () => {
    const c = await open();
    await click(buttonWithText(c, /^Admin/));
    expect(buttonWithText(c, 'Access')).toBeTruthy();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(buttonWithText(c, 'Access')).toBeNull();
    await click(buttonWithText(c, /^Admin/));
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(buttonWithText(c, 'Access')).toBeNull();
    await click(buttonWithText(c, /^Admin/));
    await act(async () => {
      buttonWithText(c, 'Access')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); // inside: stays open
    });
    expect(buttonWithText(c, 'Access')).toBeTruthy();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })); // other keys do nothing
    });
    expect(buttonWithText(c, 'Access')).toBeTruthy();
  });
});
