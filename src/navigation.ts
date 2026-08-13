import { getPermalink } from './utils/permalinks';
import navData from './data/settings/navigation.json';
import footerData from './data/settings/footer.json';
import siteData from './data/settings/site.json';

// Links gated behind a publish flag, applied to both the header and the footer.
// Each flag is the single switch for its section: nav, footer, robots noindex,
// Pagefind, and the sitemap filter in astro.config.ts all read the same value,
// so a page can't be hidden in one place and exposed in another. The pages stay
// reachable by URL when hidden. Any href not listed here is always shown.
const flaggedLinks: Record<string, boolean> = {
  '/activities': siteData.featureFlags.activitiesLibrary,
  '/connections': siteData.featureFlags.connectionsPage,
};

export const headerData = {
  links: navData.links
    .filter((link) => flaggedLinks[link.href] ?? true)
    .map((link) => ({
      text: link.text,
      href: getPermalink(link.href),
    })),
  actions: [{ text: navData.cta.text, href: getPermalink(navData.cta.href), variant: 'primary' as const }],
};

export const footerData_ = {
  // Same flag gating as the header, so a hidden page can't leak into the footer.
  // Columns left empty by gating are dropped rather than rendering a bare heading.
  links: footerData.columns
    .map((col) => ({
      title: col.title,
      links: col.links
        .filter((link) => flaggedLinks[link.href] ?? true)
        .map((link) => ({
          text: link.text,
          href: link.href.startsWith('http') ? link.href : getPermalink(link.href),
        })),
    }))
    .filter((col) => col.links.length > 0),
  secondaryLinks: [{ text: 'Privacy Policy', href: getPermalink('/privacy') }],
  socialLinks: siteData.socialLinks.map((s) => ({
    ariaLabel: s.platform,
    icon: s.icon,
    href: s.url,
  })),
  footNote: footerData.footNote,
  address: footerData.address,
};

// Re-export as footerData for backward compat with any existing Layout imports
export { footerData_ as footerData };
