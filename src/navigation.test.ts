import { describe, it, expect, beforeEach, vi } from 'vitest';

// Both flags are always mocked explicitly. Mocking only one leaves the other
// `undefined`, and `undefined ?? true` shows the link — so a partial mock would
// silently assert the opposite of what it claims for the flag it left out.
function mockFlags(flags: { activitiesLibrary: boolean; connectionsPage: boolean }) {
  vi.doMock('./data/settings/site.json', () => ({
    default: { featureFlags: flags, socialLinks: [] },
  }));
}

const allOff = { activitiesLibrary: false, connectionsPage: false };
const allOn = { activitiesLibrary: true, connectionsPage: true };

describe('headerData', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('includes the Activities link when the activitiesLibrary flag is on', async () => {
    mockFlags({ ...allOff, activitiesLibrary: true });
    const { headerData } = await import('./navigation');
    expect(headerData.links.some((l) => l.href === '/activities')).toBe(true);
  });

  it('hides the Activities link when the activitiesLibrary flag is off', async () => {
    mockFlags(allOff);
    const { headerData } = await import('./navigation');
    expect(headerData.links.some((l) => l.href === '/activities')).toBe(false);
  });

  it('includes the Connections link when the connectionsPage flag is on', async () => {
    mockFlags({ ...allOff, connectionsPage: true });
    const { headerData } = await import('./navigation');
    expect(headerData.links.some((l) => l.href === '/connections')).toBe(true);
  });

  it('hides the Connections link when the connectionsPage flag is off', async () => {
    mockFlags(allOff);
    const { headerData } = await import('./navigation');
    expect(headerData.links.some((l) => l.href === '/connections')).toBe(false);
  });

  it('gates each link independently', async () => {
    mockFlags({ activitiesLibrary: true, connectionsPage: false });
    const { headerData } = await import('./navigation');
    const hrefs = headerData.links.map((l) => l.href);
    expect(hrefs).toContain('/activities');
    expect(hrefs).not.toContain('/connections');
  });

  it('keeps every other link regardless of the flags', async () => {
    mockFlags(allOff);
    const { headerData } = await import('./navigation');
    const hrefs = headerData.links.map((l) => l.href);
    expect(hrefs).toEqual(expect.arrayContaining(['/', '/events', '/about', '/our-people', '/contact', '/donate']));
  });
});

describe('footerData', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const footerHrefs = (data: { links: { links: { href: string }[] }[] }) =>
    data.links.flatMap((col) => col.links).map((l) => l.href);

  it('hides flagged links in the footer as well as the header', async () => {
    mockFlags(allOff);
    const { footerData } = await import('./navigation');
    const hrefs = footerHrefs(footerData);
    expect(hrefs).not.toContain('/activities');
    expect(hrefs).not.toContain('/connections');
  });

  it('shows flagged links in the footer when their flags are on', async () => {
    mockFlags(allOn);
    const { footerData } = await import('./navigation');
    const hrefs = footerHrefs(footerData);
    expect(hrefs).toContain('/activities');
    expect(hrefs).toContain('/connections');
  });

  it('keeps unflagged footer links and the external Facebook link untouched', async () => {
    mockFlags(allOff);
    const { footerData } = await import('./navigation');
    const hrefs = footerHrefs(footerData);
    expect(hrefs).toEqual(expect.arrayContaining(['/about', '/our-people', '/gallery', '/events', '/membership']));
    expect(hrefs).toContain('https://www.facebook.com/yay4ecrs');
  });

  it('drops a column left empty by gating rather than rendering a bare heading', async () => {
    mockFlags(allOff);
    const { footerData } = await import('./navigation');
    expect(footerData.links.every((col) => col.links.length > 0)).toBe(true);
  });
});
