import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('headerData', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('includes the Activities link when the activitiesNavLink flag is on', async () => {
    vi.doMock('./data/settings/site.json', () => ({
      default: { featureFlags: { activitiesNavLink: true }, socialLinks: [] },
    }));
    const { headerData } = await import('./navigation');
    expect(headerData.links.some((l) => l.href === '/activities')).toBe(true);
  });

  it('hides the Activities link when the activitiesNavLink flag is off', async () => {
    vi.doMock('./data/settings/site.json', () => ({
      default: { featureFlags: { activitiesNavLink: false }, socialLinks: [] },
    }));
    const { headerData } = await import('./navigation');
    expect(headerData.links.some((l) => l.href === '/activities')).toBe(false);
  });

  it('keeps every other link regardless of the flag', async () => {
    vi.doMock('./data/settings/site.json', () => ({
      default: { featureFlags: { activitiesNavLink: false }, socialLinks: [] },
    }));
    const { headerData } = await import('./navigation');
    const hrefs = headerData.links.map((l) => l.href);
    expect(hrefs).toEqual(expect.arrayContaining(['/', '/events', '/about', '/our-people', '/contact', '/donate']));
  });
});
