# ECRS Website Agent Instructions

## Project Overview

The ECRS website — a fully static site built with **Astro v7** and **Tailwind CSS v4**, derived from the AstroWind template. Content is managed through Sveltia CMS and the site deploys on Cloudflare Pages: see [docs/deployment-and-cms.md](./docs/deployment-and-cms.md) before touching CI, the CMS config, or branch settings.

**Stack:** Astro v7 | Tailwind CSS v4 | TypeScript | React (islands) | Sharp

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

Defined in `src/content.config.ts` using the Astro Content Layer API with `glob()` loaders: `event` (`src/data/events/`), `leader`, `site` (venues), `testimonial`, and `landingSettings` (`src/data/settings/landing.md`). The zod schemas double as validation for CMS commits — a build fails on invalid content. The full CMS ↔ collection mapping is in [docs/deployment-and-cms.md](./docs/deployment-and-cms.md); when adding a field, update `public/admin/config.yml` and the zod schema together.

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

## Known Issues / Resolved Upgrade Holds

### Astro 7 upgrade — CSS breakpoint regression (RESOLVED 2026-07-23)

The site is now on **Astro 7** (`astro@7.1.3`, `vite@8.1.5`, `@tailwindcss/vite@4.3.3`). This upgrade was held back for about a month after early Astro 7 versions appeared to silently drop every responsive Tailwind breakpoint (`md:`, `lg:`, `sm:`, `xl:`, custom breakpoints like `nav:`) from the production build only — `astro dev` looked fine because it uses a different CSS pipeline than `astro build`.

**Actual root cause (not what was originally suspected):** it was never Vite 8/Rolldown resolving `@import 'tailwindcss'` incorrectly, despite that being the initial working theory. Tailwind v4 compiles some breakpoints using the modern CSS range syntax `@media (width>=1110px)` instead of the older `@media (min-width:1110px)`. `astro-compress`'s default CSS minifier (`csso`) can't parse that syntax and **silently drops the entire rule** — deleting every utility class inside it — rather than erroring. Astro 6→7 didn't cause this directly; it just happened to coincide with a Tailwind version that emits the modern syntax.

**Fix:** `astro.config.ts`'s `compress()` CSS option was switched from `csso` to `lightningcss`, which understands the modern range syntax and leaves it intact:

```ts
compress({
  CSS: { csso: false, lightningcss: {} },
  // ...
});
```

**How to verify this doesn't regress:** don't judge by build CSS file size or `@media` query count alone — a broken build can still produce a large file with plenty of _non-breakpoint_ media queries (`hover`, `prefers-reduced-motion`, `print`, etc.) and look superficially fine. Check for the actual utility prefixes instead:

```bash
python3 -c "print(open('dist/_astro/PageLayout.<hash>.css').read().count('md\\:'))"
```

Compare `md:`/`lg:`/`sm:`/`xl:`/`nav:` counts against a known-good baseline build — they should be non-zero and roughly stable across builds of the same source tree.

**If this regresses again:** check whether `astro-compress`'s CSS step is still configured with `lightningcss` in `astro.config.ts`, and whether a newer Tailwind/astro-compress release changed how CSS range syntax is handled, before assuming it's another Rolldown/Vite issue.

### Dependabot: stale major-version PRs can bypass the ignore list

`.github/dependabot.yml` ignores `semver-major` updates for `astro`/`@astrojs/*`, but that only stops _new_ PRs from being opened — it does not auto-close PRs opened before the ignore rule existed or before it was last updated. A stale `dependabot/npm_and_yarn/astro-7.1.3` PR sat open for two days and was merged on 2026-07-23, initially appearing to break production (before the CSS fix above was identified and folded into that same PR). When updating `dependabot.yml`'s ignore rules, also check `gh pr list --author app/dependabot` for stale open PRs that predate the change and close/re-evaluate them explicitly.
