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

import react from '@astrojs/react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  output: 'static',

  // Astro 7 changed the default from `true` to `'jsx'`; keep `true` to preserve existing behavior.
  compressHTML: true,

  integrations: [
    sitemap({
      // Exclude e2e fixtures and pages marked `robots: { index: false }` —
      // the sitemap should only list pages we want search engines to index.
      filter: (page) => !page.includes('/events/e2e-') && !page.includes('/internal/'),
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
  },
});
