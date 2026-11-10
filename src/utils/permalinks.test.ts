import { describe, it, expect } from 'vitest';
import {
  trimSlash,
  getPermalink,
  getCanonical,
  getHomePermalink,
  getAsset,
  applyGetPermalinks,
  pagePathname,
} from './permalinks';

// Config loaded from src/config.yaml via vitest.config.ts virtual module:
//   SITE.site = 'https://ecrs.org', SITE.base = '/', SITE.trailingSlash = false

describe('trimSlash', () => {
  it('removes leading and trailing slashes', () => {
    expect(trimSlash('/foo/')).toBe('foo');
  });

  it('removes multiple slashes', () => {
    expect(trimSlash('///foo///')).toBe('foo');
  });

  it('leaves strings with no slashes unchanged', () => {
    expect(trimSlash('foo')).toBe('foo');
  });

  it('returns empty string for slash-only input', () => {
    expect(trimSlash('/')).toBe('');
    expect(trimSlash('')).toBe('');
  });
});

describe('pagePathname', () => {
  it('strips the .html that build.format "file" adds to Astro.url.pathname', () => {
    expect(pagePathname('/about.html')).toBe('/about');
    expect(pagePathname('/events/2026-winter-adventure/schedule.html')).toBe('/events/2026-winter-adventure/schedule');
  });

  it('maps an index file to its directory', () => {
    expect(pagePathname('/index.html')).toBe('/');
  });

  it('leaves an already-clean path alone', () => {
    expect(pagePathname('/about')).toBe('/about');
    expect(pagePathname('/')).toBe('/');
  });
});

describe('getCanonical', () => {
  it('returns absolute URL for a relative path', () => {
    expect(getCanonical('foo')).toBe('https://ecrs.org/foo');
  });

  it('strips trailing slash when trailingSlash is false', () => {
    expect(getCanonical('foo/')).toBe('https://ecrs.org/foo');
  });

  it('returns site root for empty path', () => {
    expect(getCanonical('')).toBe('https://ecrs.org/');
  });
});

describe('getPermalink', () => {
  it('passes through http URLs unchanged', () => {
    expect(getPermalink('https://example.com')).toBe('https://example.com');
    expect(getPermalink('http://example.com')).toBe('http://example.com');
  });

  it('passes through protocol-relative URLs unchanged', () => {
    expect(getPermalink('://example.com')).toBe('://example.com');
  });

  it('passes through hash anchors unchanged', () => {
    expect(getPermalink('#section')).toBe('#section');
  });

  it('passes through javascript: URIs unchanged', () => {
    expect(getPermalink('javascript:void(0)')).toBe('javascript:void(0)');
  });

  it('generates a page permalink', () => {
    expect(getPermalink('about')).toBe('/about');
    expect(getPermalink('about', 'page')).toBe('/about');
  });

  it('generates the home permalink', () => {
    expect(getPermalink('/', 'home')).toBe('/');
  });

  it('generates an asset path', () => {
    expect(getPermalink('images/logo.png', 'asset')).toBe('/images/logo.png');
  });
});

describe('getHomePermalink', () => {
  it('returns /', () => {
    expect(getHomePermalink()).toBe('/');
  });
});

describe('getAsset', () => {
  it('prepends a leading slash', () => {
    expect(getAsset('images/logo.png')).toBe('/images/logo.png');
  });

  it('handles paths that already have a leading slash', () => {
    expect(getAsset('/images/logo.png')).toBe('/images/logo.png');
  });
});

describe('applyGetPermalinks', () => {
  it('returns non-object values unchanged', () => {
    expect(applyGetPermalinks(null)).toBeNull();
    expect(applyGetPermalinks('foo')).toBe('foo');
    expect(applyGetPermalinks(42)).toBe(42);
  });

  it('returns empty object unchanged', () => {
    expect(applyGetPermalinks({})).toEqual({});
  });

  it('resolves a string href to a page permalink', () => {
    expect(applyGetPermalinks({ href: 'about' })).toEqual({ href: '/about' });
  });

  it('resolves href with type home', () => {
    expect(applyGetPermalinks({ href: { type: 'home' } })).toEqual({ href: '/' });
  });

  it('resolves href with type asset', () => {
    expect(applyGetPermalinks({ href: { type: 'asset', url: 'logo.png' } })).toEqual({ href: '/logo.png' });
  });

  it('resolves href with explicit url and type', () => {
    expect(applyGetPermalinks({ href: { type: 'page', url: 'about' } })).toEqual({
      href: '/about',
    });
  });

  it('recurses into arrays', () => {
    expect(applyGetPermalinks([{ href: 'foo' }, { href: 'bar' }])).toEqual([{ href: '/foo' }, { href: '/bar' }]);
  });

  it('recurses into nested objects', () => {
    expect(applyGetPermalinks({ nav: { href: 'about' } })).toEqual({ nav: { href: '/about' } });
  });

  it('passes through http hrefs unchanged', () => {
    expect(applyGetPermalinks({ href: 'https://example.com' })).toEqual({ href: 'https://example.com' });
  });

  it('passes through non-href keys unchanged', () => {
    expect(applyGetPermalinks({ label: 'Home', href: '/' })).toEqual({ label: 'Home', href: '/' });
  });
});
