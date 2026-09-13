import { getPermalink } from './utils/permalinks';
import navData from './data/settings/navigation.json';
import footerData from './data/settings/footer.json';
import siteData from './data/settings/site.json';

// Links gated behind a publish flag, applied to both the header and the footer.
// Each flag is the single switch for its section: nav, footer, robots noindex,
// Pagefind, and the sitemap filter in astro.config.ts all read the same value,
// so a page can't be hidden in one place and exposed in another. The pages stay
// reachable by URL when hidden. Any href not listed here is always shown, and
// the gating reaches into dropdown submenus as well as top-level links.
const flaggedLinks: Record<string, boolean> = {
  '/activities': siteData.featureFlags.activitiesLibrary,
  '/connections': siteData.featureFlags.connectionsPage,
};

type NavLink = { text: string; href?: string; links?: NavLink[] };

const isVisible = (link: NavLink) => (link.href === undefined ? true : (flaggedLinks[link.href] ?? true));

// Dropdown parents carry no href of their own, so they're gated by their
// children: a parent whose entire submenu is hidden by flags is dropped rather
// than rendering a chevron that opens an empty menu. Same rule the footer uses
// for a column emptied by gating.
const resolveLink = (link: NavLink) => {
  // `?.length`, not `?.links`: the CMS gives every entry an optional Sub-links
  // list, and an empty array is truthy. A plain link saved as `links: []` would
  // otherwise take the dropdown branch, find no children, and vanish from the nav.
  if (link.links?.length) {
    const children = link.links.filter(isVisible).map((child) => ({
      text: child.text,
      href: getPermalink(child.href),
    }));
    return children.length > 0 ? { text: link.text, links: children } : null;
  }
  return { text: link.text, href: getPermalink(link.href) };
};

// The header CTA's available width is capped by the header's own layout (see
// the equal-width side columns in Header.astro) and doesn't grow past a fixed
// point no matter how wide the viewport gets, so a single label can't fit
// well everywhere. These three tiers were measured against the live rendered
// button, not estimated: "Join Our List" wraps below nav-md (1230px), and the
// full label wraps below xl (1280px). Below `nav` (1110px) the button instead
// renders in the full-width mobile menu, which is why the largest label is
// also the default (mobile-first) span.
const ctaText = [
  `<span class="inline nav:hidden xl:inline">${navData.cta.text}</span>`,
  `<span class="hidden nav-md:inline xl:hidden">${navData.cta.textMedium}</span>`,
  `<span class="hidden nav:inline nav-md:hidden">${navData.cta.textSmall}</span>`,
].join('');

export const headerData = {
  links: (navData.links as NavLink[])
    .filter(isVisible)
    .map(resolveLink)
    .filter((link): link is NonNullable<typeof link> => link !== null),
  actions: [{ text: ctaText, href: getPermalink(navData.cta.href), variant: 'primary' as const }],
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
