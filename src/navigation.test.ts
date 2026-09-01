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

// Flagged links now live inside a dropdown, so an assertion against the
// top-level array alone would pass no matter what the submenu contains.
type HeaderLink = { text: string; href?: string; links?: { text: string; href: string }[] };
const allHrefs = (links: HeaderLink[]) => links.flatMap((l) => (l.links ? l.links.map((c) => c.href) : [l.href!]));

describe('headerData', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('includes the Activities link when the activitiesLibrary flag is on', async () => {
    mockFlags({ ...allOff, activitiesLibrary: true });
    const { headerData } = await import('./navigation');
    expect(allHrefs(headerData.links)).toContain('/activities');
  });

  it('hides the Activities link when the activitiesLibrary flag is off', async () => {
    mockFlags(allOff);
    const { headerData } = await import('./navigation');
    expect(allHrefs(headerData.links)).not.toContain('/activities');
  });

  it('includes the Connections link when the connectionsPage flag is on', async () => {
    mockFlags({ ...allOff, connectionsPage: true });
    const { headerData } = await import('./navigation');
    expect(allHrefs(headerData.links)).toContain('/connections');
  });

  it('hides the Connections link when the connectionsPage flag is off', async () => {
    mockFlags(allOff);
    const { headerData } = await import('./navigation');
    expect(allHrefs(headerData.links)).not.toContain('/connections');
  });

  it('gates each link independently', async () => {
    mockFlags({ activitiesLibrary: true, connectionsPage: false });
    const { headerData } = await import('./navigation');
    const hrefs = allHrefs(headerData.links);
    expect(hrefs).toContain('/activities');
    expect(hrefs).not.toContain('/connections');
  });

  it('keeps every other link regardless of the flags', async () => {
    mockFlags(allOff);
    const { headerData } = await import('./navigation');
    const hrefs = allHrefs(headerData.links);
    expect(hrefs).toEqual(expect.arrayContaining(['/', '/events', '/about', '/our-people', '/contact', '/donate']));
  });

  it('keeps the flagged links inside the Get Involved dropdown rather than at the top level', async () => {
    mockFlags(allOn);
    const { headerData } = await import('./navigation');
    const topLevel = (headerData.links as HeaderLink[]).map((l) => l.href);
    expect(topLevel).not.toContain('/activities');
    expect(topLevel).not.toContain('/connections');

    const about = (headerData.links as HeaderLink[]).find((l) => l.text === 'About');
    expect(about?.href).toBeUndefined();
    expect(about?.links?.map((c) => c.href)).toEqual(['/about', '/our-people', '/gallery']);

    const getInvolved = (headerData.links as HeaderLink[]).find((l) => l.text === 'Get Involved');
    expect(getInvolved?.href).toBeUndefined();
    expect(getInvolved?.links?.map((c) => c.href)).toEqual(['/membership', '/activities', '/connections']);
  });

  // The real menu always keeps About/Our People/Gallery, so only a synthetic nav
  // can reach the empty-parent branch. Without it a future flag on every child
  // would ship a chevron that opens nothing.
  it('drops a dropdown whose children are all hidden by flags', async () => {
    mockFlags(allOff);
    vi.doMock('./data/settings/navigation.json', () => ({
      default: {
        links: [
          { text: 'Events', href: '/events' },
          { text: 'About', links: [{ text: 'Activities', href: '/activities' }] },
        ],
        cta: { text: 'See Events', href: '/events' },
      },
    }));
    const { headerData } = await import('./navigation');
    expect(headerData.links.map((l) => l.text)).toEqual(['Events']);
  });

  // The CMS offers a Sub-links list on every entry, so a plain link can come back
  // carrying an empty array. That must stay a link, not become an empty dropdown.
  it('treats a link with an empty sub-link list as an ordinary link', async () => {
    mockFlags(allOff);
    vi.doMock('./data/settings/navigation.json', () => ({
      default: {
        links: [{ text: 'Home', href: '/', links: [] }],
        cta: { text: 'See Events', href: '/events' },
      },
    }));
    const { headerData } = await import('./navigation');
    expect(headerData.links).toEqual([{ text: 'Home', href: '/' }]);
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
