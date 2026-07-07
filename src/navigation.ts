import { getPermalink } from './utils/permalinks';
import navData from './data/settings/navigation.json';
import footerData from './data/settings/footer.json';
import siteData from './data/settings/site.json';

export const headerData = {
  links: navData.links
    .filter((link) => siteData.featureFlags.activitiesNavLink || link.href !== '/activities')
    .map((link) => ({
      text: link.text,
      href: getPermalink(link.href),
    })),
  actions: [{ text: navData.cta.text, href: getPermalink(navData.cta.href), variant: 'primary' as const }],
};

export const footerData_ = {
  links: footerData.columns.map((col) => ({
    title: col.title,
    links: col.links.map((link) => ({
      text: link.text,
      href: link.href.startsWith('http') ? link.href : getPermalink(link.href),
    })),
  })),
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
