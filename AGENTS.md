# ECRS Website Agent Instructions

## Project Overview

The ECRS website — a fully static site built with **Astro v6** and **Tailwind CSS v4**, derived from the AstroWind template. Content is managed through Sveltia CMS and the site deploys on Cloudflare Pages: see [docs/deployment-and-cms.md](./docs/deployment-and-cms.md) before touching CI, the CMS config, or branch settings.

**Stack:** Astro v6 | Tailwind CSS v4 | TypeScript | React (islands) | Sharp

## Quick Reference

| Command           | Purpose                             |
| ----------------- | ----------------------------------- |
| `npm run dev`     | Start dev server at localhost:4321  |
| `npm run build`   | Production build to `./dist/`       |
| `npm run preview` | Preview production build locally    |
| `npm run check`   | Run astro check + ESLint + Prettier |
| `npm run fix`     | Auto-fix ESLint + Prettier issues   |

**Node.js requirement:** >= 22.12.0

## Architecture

### Directory Structure

```
src/
  assets/styles/tailwind.css   # Tailwind v4 config (themes, utilities, plugins)
  components/
    common/        # Shared: Image, Metadata, Analytics, ToggleTheme
    ui/            # Primitives: Button, Headline, WidgetWrapper, ItemGrid
    widgets/       # Page sections: HeroText, VideoHero, Header, Footer, CognitoForm
    schedule/      # React schedule-generator island
    CustomStyles.astro  # CSS variables for colors and fonts
  content.config.ts    # Content Collections schema (zod — validates CMS content)
  data/                # CMS-managed content: events/, leaders/, sites/,
                       # testimonials/, settings/, pages/
  layouts/             # Layout.astro, PageLayout.astro, MarkdownLayout.astro
  pages/               # File-based routing (events/, og/, internal/, …)
  utils/               # images.ts, permalinks.ts, dates.ts, eventSections.ts
  config.yaml          # Site configuration (loaded as virtual module)
  navigation.ts        # Navigation structure
  types.d.ts           # TypeScript type definitions
public/admin/          # Sveltia CMS (config.yml + admin page)
scripts/               # Prebuild: Sveltia copy, image copy, member locations
functions/             # Cloudflare Pages Functions (edge middleware)
vendor/integration/    # Custom Astro integration for config loading
```

### Path Aliases

Use `~/` to import from `src/`:

```typescript
import Image from '~/components/common/Image.astro';
import { SITE } from 'astrowind:config';
```

### Configuration System

Site config lives in `src/config.yaml` and is loaded as a Vite virtual module `astrowind:config` by the custom integration in `vendor/integration/`. Exports in use: `SITE`, `I18N`, `METADATA`, `UI`, `ANALYTICS`.

## Tailwind CSS v4

Configuration is CSS-first in `src/assets/styles/tailwind.css`:

- **Theme tokens:** `@theme { --color-primary: var(--aw-color-primary); ... }`
- **Custom utilities:** `@utility bg-page { ... }`
- **Dark mode:** Class-based via `@variant dark (&:where(.dark, .dark *))`
- **Plugins:** `@plugin "@tailwindcss/typography"`
- **Custom variant:** `@custom-variant intersect (&:not([no-intersect]))`

CSS variables for colors/fonts are defined in `src/components/CustomStyles.astro` with light/dark theme variants.

The Vite plugin `@tailwindcss/vite` is configured in `astro.config.ts` (not as an Astro integration).

### Class Merging

Components use `twMerge` from `tailwind-merge` v3 for conditional class composition.

## Content Collections

Defined in `src/content.config.ts` using the Astro v6 Content Layer API with `glob()` loaders: `event` (`src/data/events/`), `leader`, `site` (venues), `testimonial`, and `landingSettings` (`src/data/settings/landing.md`). The zod schemas double as validation for CMS commits — a build fails on invalid content. The full CMS ↔ collection mapping is in [docs/deployment-and-cms.md](./docs/deployment-and-cms.md); when adding a field, update `public/admin/config.yml` and the zod schema together.

## Component Patterns

- Props extend interfaces from `~/types`
- Use `class:list` for conditional classes
- Use `twMerge()` when accepting className overrides
- Use named slots for layout composition
- Widget components accept standardized props (see `~/types`)

## Image Handling

`src/components/common/Image.astro` supports:

- Local images via `astro:assets` (optimized by Sharp)
- Remote images via Unpic CDN
- Allowed domains (for providers Unpic can't detect, processed by Sharp): `cdn.pixabay.com`

Hero images use `loading="eager"` and `fetchpriority="high"`.

## Verification Checklist

After changes, always verify:

1. `npm run build` succeeds
2. `npm run check` passes (astro check + ESLint + Prettier)
3. `npm test` passes (Vitest); `npm run test:e2e` for event-page/UI changes
4. Visual check in browser: homepage, events listing, an event detail page, dark mode, mobile menu

## Known Issues / Upgrade Holds

### Astro 7 (Vite 8 / Rolldown) — CSS regression, hold until upstream fix

**Symptom:** Production build (`astro build`) produces CSS with zero responsive `@media (min-width:…)` breakpoints. The dev server (`astro dev`) renders correctly because it uses Vite's dev pipeline, not Rolldown. Cloudflare Pages deploys the production build, so the deployed site would be stuck in "mobile-only" layout at all screen sizes.

**Root cause:** Astro 7 ships Vite 8, which uses Rolldown (a Rust-based bundler) instead of Rollup. Rolldown processes CSS files with its own native CSS bundler, which resolves `@import 'tailwindcss'` to `tailwindcss/index.css` — a 30 KB file of theme variables with no utility classes. The `@tailwindcss/vite` plugin correctly generates full utility CSS (101 KB, 23 breakpoint queries) in its `transform` hook, but Rolldown's native CSS bundler runs independently of the transform pipeline and its output replaces the plugin's output in the final asset.

The `@tailwindcss/postcss` route has the same problem: Vite 8's internal `postcss-import` resolves `@import 'tailwindcss'` before `@tailwindcss/postcss` can handle it.

**Versions tested:** `astro@7.0.0`, `astro@7.0.3`, `vite@8.1.0`, `@tailwindcss/vite@4.3.1` (all latest as of 2026-06-26). None resolved the issue.

**When to retry:** Watch for a release of `@tailwindcss/vite` that explicitly mentions Rolldown / Vite 8 CSS asset pipeline compatibility. The Dependabot bump is in the git history at commit `35719ef` (branch `feat/brighter-hero`) and can be cherry-picked once the upstream fix ships.

**Workaround (if urgently needed):** Run `npx tailwindcss -i src/assets/styles/tailwind.css -o src/assets/styles/tailwind.built.css` as a prebuild step, import the generated file in `Layout.astro`, and remove `@tailwindcss/vite` from `astro.config.ts`. Rolldown passes plain CSS through unchanged. Requires `tailwindcss --watch` alongside `astro dev` for hot-reloading during development.
