# ECRS Website Agent Instructions

## Project Overview

The ECRS website — a fully static site built with **Astro v7** and **Tailwind CSS v4**, derived from the AstroWind template. Content is managed through Sveltia CMS and the site deploys on Cloudflare Pages: see [docs/deployment-and-cms.md](./docs/deployment-and-cms.md) before touching CI, the CMS config, or branch settings.

**Stack:** Astro v7 | Tailwind CSS v4 | TypeScript | React (islands) | Sharp

## Quick Reference

| Command                    | Purpose                                                |
| -------------------------- | ------------------------------------------------------ |
| `npm run dev`              | Start dev server at localhost:4321                     |
| `npm run build`            | Production build to `./dist/`                          |
| `npm run preview`          | Preview production build locally                       |
| `npm run check`            | Run YAML + astro check + ESLint + Prettier             |
| `npm run fix`              | Auto-fix ESLint + Prettier issues                      |
| `npm test`                 | Unit tests (Vitest); `test:e2e` runs Playwright        |
| `npm run render:schedules` | Re-render master-schedule PDFs (CI normally does this) |
| `npm run audit:bios`       | List leader/staff bios that may be stale               |

**Node.js requirement:** >= 22.12.0

**Git hooks (lefthook):** pre-commit runs `prettier --check`; pre-push runs `npm run check` and `npm run test:coverage`.

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
  data/                # CMS-managed content: events/, leaders/, staff/, sites/,
                       # testimonials/, activities/, gallery/, settings/, pages/
  layouts/             # Layout.astro, PageLayout.astro, MarkdownLayout.astro
  pages/               # File-based routing (events/, activities/, gallery/, og/, internal/, …)
  __tests__/           # Vitest suites (utils and components also colocate *.test.ts)
  utils/               # images.ts, permalinks.ts, dates.ts, eventSections.ts
  config.yaml          # Site configuration (loaded as virtual module)
  navigation.ts        # Navigation structure
  types.d.ts           # TypeScript type definitions
public/admin/          # Sveltia CMS (config.yml + admin page)
scripts/               # Prebuild: Sveltia copy, image copy, member locations
functions/             # Cloudflare Pages Functions (edge middleware, api/track-purchase webhooks)
e2e/                   # Playwright specs (event page, hero badge, accessibility)
docs/                  # Deployment/CMS, disaster recovery, design audit
.claude/skills/        # Repeatable chores (see Skills below)
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

Defined in `src/content.config.ts` using the Astro Content Layer API with `glob()` loaders: `event`, `leader`, `staff` (git-only, not in the CMS), `site` (venues), `testimonial`, `landingSettings` (`src/data/settings/landing.md`), `activity` (games/dances/songs in `src/data/activities/`), and `galleryPhoto` (`src/data/gallery/`). The zod schemas double as validation for CMS commits — a build fails on invalid content. The full CMS ↔ collection mapping is in [docs/deployment-and-cms.md](./docs/deployment-and-cms.md); when adding a field, update `public/admin/config.yml` and the zod schema together.

Gotcha: in dev, a new schema field can be silently stripped from cached data. Clear `node_modules/.astro` and `.astro/data-store.json`, then run `astro sync`.

## Skills

Check `.claude/skills/` before improvising a recurring chore: `add-cms-field`, `new-page`, `new-event`, `update-bio`, `audit-bios`, `content-audit`, `optimise-images`.

## Component Patterns

- Props extend interfaces from `~/types`
- Use `class:list` for conditional classes
- Use `twMerge()` when accepting className overrides
- Use named slots for layout composition
- Widget components accept standardized props (see `~/types`)
- With `ClientRouter` view transitions, page-level `<script>` handlers don't re-run after navigation; use document-level event delegation
- Don't put `not-prose` on a wrapper around `.prose` blocks: it silently disables every nested one

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

## Known Issues

### CSS minifier must be `lightningcss`, not `csso`

Tailwind v4 emits modern range media queries (`@media (width>=1110px)`). `astro-compress`'s default `csso` minifier can't parse them and **silently drops the whole rule**, deleting every `md:`/`lg:`/`nav:` utility from the production build (`astro dev` looks fine because it uses a different CSS pipeline). `astro.config.ts` therefore sets `compress({ CSS: { csso: false, lightningcss: {} } })`. Keep it that way.

To check for a regression, don't trust file size or `@media` counts (non-breakpoint queries pad them). Count the actual prefixes and compare against a known-good build:

```bash
python3 -c "print(open('dist/_astro/PageLayout.<hash>.css').read().count('md\\:'))"
```

### Dependabot: stale major-version PRs can bypass the ignore list

`.github/dependabot.yml` ignores `semver-major` updates for `astro`/`@astrojs/*`, but that only stops _new_ PRs; it doesn't close ones opened earlier. When changing the ignore rules, check `gh pr list --author app/dependabot` for stale open PRs and close or re-evaluate them.
