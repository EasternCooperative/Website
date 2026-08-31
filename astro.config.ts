import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { defineConfig } from 'astro/config';

import { unified } from '@astrojs/markdown-remark';

import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import icon from 'astro-icon';
import compress from 'astro-compress';
import pagefind from 'astro-pagefind';

import astrowind from './vendor/integration';

import { responsiveTablesRehypePlugin } from './src/utils/frontmatter';

import siteSettings from './src/data/settings/site.json';

import react from '@astrojs/react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Content collections aren't queryable from astro.config.ts, so read `draft: true`
// directly out of each entry's frontmatter to keep the sitemap in sync with the
// noIndex logic in the events/activities detail pages.
function draftSlugs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.md') || file.endsWith('.mdx'))
    .filter((file) => {
      const contents = fs.readFileSync(path.join(dir, file), 'utf-8');
      const frontmatter = contents.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
      return /^draft:\s*true\s*$/m.test(frontmatter);
    })
    .map((file) => file.replace(/\.mdx?$/, ''));
}

const draftEventSlugs = draftSlugs(path.join(__dirname, 'src/data/events'));
const draftActivitySlugs = draftSlugs(path.join(__dirname, 'src/data/activities'));

// Matches the slug as a full path segment (not a substring) so a draft like
// "foo" doesn't also exclude an unrelated live page like "foo-extended". Also
// matches one nested segment (e.g. /events/foo/schedule) so a draft event's
// sub-pages are excluded alongside its detail page.
function isDraftPage(page: string, sectionPrefix: string, slugs: string[]): boolean {
  const match = page.match(new RegExp(`${sectionPrefix}([^/]+)(?:/[^/]+)?/?$`));
  return !!match && slugs.includes(match[1]);
}

export default defineConfig({
  output: 'static',

  // Astro 7 changed the default from `true` to `'jsx'`; keep `true` to preserve existing behavior.
  compressHTML: true,

  integrations: [
    sitemap({
      // Exclude e2e fixtures, internal pages, and draft events/activities —
      // the sitemap should only list pages we want search engines to index.
      // /connections and /activities are each gated on the same flag their page
      // uses for its noIndex, so the sitemap and the robots meta tag can't drift
      // apart. The /activities pattern covers the catalogue and its detail pages
      // both — while the library is dark there is no way into it from search.
      filter: (page) =>
        !page.includes('/events/e2e-') &&
        !page.includes('/internal/') &&
        (siteSettings.featureFlags.connectionsPage || !/\/connections\/?$/.test(page)) &&
        (siteSettings.featureFlags.activitiesLibrary || !/\/activities(?:\/|$)/.test(page)) &&
        !isDraftPage(page, '/events/', draftEventSlugs) &&
        !isDraftPage(page, '/activities/', draftActivitySlugs),
    }),
    icon({
      include: {
        tabler: ['*'],
        'flat-color-icons': [
          'template',
          'gallery',
          'approval',
          'document',
          'advertising',
          'currency-exchange',
          'voice-presentation',
          'business-contact',
          'database',
        ],
      },
    }),
    compress({
      CSS: { csso: false, lightningcss: {} },
      HTML: {
        'html-minifier-terser': {
          removeAttributeQuotes: false,
        },
      },
      Image: false,
      JavaScript: true,
      SVG: false,
      Logger: 1,
    }), // Indexes the built HTML in dist/ after the build (and serves the index in
    // dev/preview). Placed after compress so it indexes the final output.
    pagefind(),
    astrowind({
      config: './src/config.yaml',
    }), // CF_PAGES_URL is the Cloudflare Pages deployment URL — always the *.pages.dev
    // address, even after a custom domain is added. Preview builds (non-main
    // branches) have no custom domain, so they override `site` to their own
    // pages.dev URL for correct OG image URLs and sitemaps. Production (main)
    // now serves at ecrs.org, so it keeps the canonical `site` from config.yaml
    // instead of overriding it to the pages.dev address.
    ...(process.env.CF_PAGES_URL && process.env.CF_PAGES_BRANCH !== 'main'
      ? [
          {
            name: 'cf-pages-site-override',
            hooks: {
              'astro:config:setup': ({ updateConfig }: { updateConfig: (cfg: { site: string }) => void }) =>
                updateConfig({ site: process.env.CF_PAGES_URL! }),
            },
          },
        ]
      : []),
    react(),
  ],

  image: {
    // Astro's default Sharp service handles local images.
    //
    // Most remote CDN images (Unsplash, Cloudinary, Imgix…) are routed by
    // src/components/common/Image.astro through `unpic`, which rewrites the
    // URL with CDN-side query parameters and serves it straight from the
    // provider — Astro never downloads it, so they don't need to be listed.
    //
    // `domains` only matters for remote URLs that fall through to Astro's
    // native <Image /> (i.e. providers Unpic can't detect, like Pixabay).
    // Listed entries are authorized to be processed by Sharp.
    domains: ['cdn.pixabay.com'],
  },

  markdown: {
    processor: unified({
      rehypePlugins: [responsiveTablesRehypePlugin],
    }),
  },

  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '~': path.resolve(__dirname, './src'),
      },
    },
    build: {
      // GenerateStep (pdfmake, with embedded fonts) and MemberHeatmap
      // (react-simple-maps) are both already lazy-loaded/deferred on demand
      // — the default 500kB warning is noise for these known-large,
      // properly-isolated third-party bundles.
      chunkSizeWarningLimit: 2000,
    },
  },
});
