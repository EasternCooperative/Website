# ECRS Website — Design & Technical Audit

_Date: 2026-06-19 (findings), updated 2026-07-02 (status refresh) · Branch:
`ecrs-initial` · Scope: real ECRS surface only_

This audit covers UX, accessibility, maintainability, SEO, performance, and
monitoring for the live ECRS pages: **home, events (list + detail), about,
contact, donate, membership, privacy, terms, 404**. AstroWind template demos
(`homes/`, `landing/`, `services`, `pricing`, demo blog) are treated as
out-of-scope content slated for deletion (see §2).

Overall the build is in good shape: it already does the hard accessibility work
(skip link, WCAG 2.2.2 video pause toggle, `prefers-reduced-motion` handling,
ARIA labelling, focus-visible rings), ships event `JSON-LD`, and uses
`astro-seo` for per-page metadata, Open Graph, Twitter cards, and canonicals.
Brand colors are already chosen for WCAG AA contrast. The findings below are
refinements, not a rescue.

Severity: 🔴 high · 🟡 medium · 🟢 low/polish

---

## 1. Monitoring (page views + load times) — _not yet in place_

🔴 **No analytics is configured** (`config.yaml` → `analytics.vendors.googleAnalytics.id: null`).
Decision: install **both** Cloudflare Web Analytics (RUM — page views, Core Web
Vitals, real load times, no cookie banner) **and** GA4 (engagement events).

- ✅ **DONE** — Cloudflare Web Analytics beacon wired via config
  (`analytics.vendors.cloudflareWebAnalytics.token`) +
  `CloudflareWebAnalytics.astro` in the head. Cookieless, loads everywhere, no
  consent. Covers page views + Core Web Vitals / load times. Token currently
  scoped to `website-alc.pages.dev`; add `ecrs.org` to the same CF site at cutover.
- ✅ **DONE** — GA4 (`G-TMYSFB9B9J`) wired via `Analytics.astro`, consent-gated.
  A Cloudflare Pages Function (`functions/_middleware.js`) stamps
  `data-consent-region` on `<html>` at the edge; policy is **gate everywhere
  except the US** (unknown country defaults to gated). `ConsentBanner.astro`
  shows only in gated regions until the visitor chooses; GA4 loads only after
  Accept (US loads immediately). Choice persisted in `localStorage`; page_view
  re-sent on View Transition navigations; skipped on localhost.

---

## 2. Maintainability — dead template content

✅ **DONE** — All AstroWind demo content has been deleted: `services.astro`,
`pricing.astro`, `homes/*`, `landing/*`, the demo blog posts, and
`SplitbeeAnalytics.astro`. Blog is disabled in `config.yaml`
(`apps.blog.isEnabled: false`). The sitemap now lists only real ECRS URLs.

Current widget inventory (`src/components/widgets/`): `Content`, `Features`,
`Features2`, `Stats`, `HeroText`, `VideoHero`, `EventCard`, `CognitoForm`,
`CallToAction`, `Header`, `Footer`, `Testimonials` (used on the homepage,
`src/pages/index.astro`), and the member-map widgets
(`InternalMemberMap`, `MemberHeatmap`, `MemberLocationsUploader`,
`SiteEvaluator`). No orphaned demo widgets remain.

✅ **DONE** — The homepage "More Upcoming Events" block now renders the shared
`EventCard.astro` widget instead of hand-rolling a duplicate card.

---

## 3. Performance

> ⚠️ This section is **static-analysis inference** (asset weights + code review),
> not measured Core Web Vitals. The Cloudflare Web Analytics RUM added in §1 will
> provide real LCP/INP/CLS field data once deployed; run a Lighthouse pass on
> home + one event page if a point-in-time lab measurement is needed sooner.

🟡 **Hero videos** (`public/videos/`): first `.webm` is ~1.2–2.1 MB and autoplays.
`preload="metadata"` on the first video + `none` on the rest is correct; posters
are present. Acceptable, but it is the single heaviest above-the-fold payload —
keep encodes lean and consider a mobile poster-only fallback.

- ✅ The 7.3 GB `.mov` source files in `public/videos/` are correctly
  `.gitignore`d (`public/videos/*.mov`), so they are not in the repo and CF
  builds (from git) won't ship them. Only risk: a direct local `dist/` deploy.

✅ **DONE** — Raster images no longer skip Sharp. `src/components/common/Image.astro`
now routes every local/CMS image (`~/assets/...` imports and `/images/...` CMS
string paths alike) through Astro's native `<Image>` / Sharp pipeline
(`findImage()` in `src/utils/images.ts`), producing AVIF/WebP and a responsive
`srcset`. A `prebuild` step (`scripts/copy-public-images.mjs`) copies
CMS-uploaded files from `public/images/` into `src/assets/images/` before each
build specifically so Sharp can process them. Only true CDN URLs (Unsplash,
Cloudinary, etc.) bypass Sharp, by design. Surveyed `public/images/` — all
current files are already under 300 KB and well under 2000px, so there's
nothing to pre-compress.

✅ **DONE** — `public/_headers` now sets security headers globally
(`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS,
`Permissions-Policy`) and caching: `immutable` for hashed `/_astro/*`, a 30-day
cache for `/fonts/*`, and `max-age + stale-while-revalidate` for the
CMS-editable `/images/*` and `/videos/*` (so same-name swaps still refresh).

✅ **DONE** — Countdown timer (`VideoHero.astro`) now caches the value `<span>`
elements per render and only rebuilds the DOM when the unit set changes (e.g.
"days/hrs" → "hrs/min/sec"); a normal 1s tick just updates `textContent` on
the cached nodes instead of rebuilding `innerHTML`.

---

## 4. Accessibility — _strong; minor gaps_

✅ Already handled: skip-to-content link, `prefers-reduced-motion`, WCAG 2.2.2
video pause/play toggle, `aria-label`/`aria-current`/`role="list"`, focus-visible
rings, semantic headings, dark mode.

✅ **DONE** — `--aw-color-text-muted` (`#363031 @ 72%` light / `66%` dark) was
below AA against the old cool-gray-50 background at audit time. The
background-brightening pass (`c16dbc7`, 2026-06-26) switched pages to a warm
off-white (`rgb(252 250 248)`), which lifts the same muted-text token to
~5.2:1 light / ~6.6:1 dark — both clear of the 4.5:1 AA threshold.

🟢 Event-detail description is injected with `Fragment set:html=...` (CMS content,
`\n`→`<br>`). Org-controlled so low risk, but it bypasses sanitization — document
or sanitize.

🟢 Event hero `<img>` sits inside an `aria-hidden="true"` wrapper while carrying
meaningful `alt` text that duplicates the `<h1>`. Fine as decorative, but the
`alt` could be `""` to match intent.

---

## 5. SEO — _strong; small wins_

✅ Per-page `astro-seo` metadata, Open Graph + Twitter cards, canonicals,
`@astrojs/sitemap`, event `JSON-LD`, default OG image, sensible title template.

✅ `robots.txt` advertises the sitemap directly:
`public/robots.txt` includes `Sitemap: https://ecrs.org/sitemap-index.xml`.
Sitemap (via `@astrojs/sitemap`) now lists only real ECRS URLs post-cleanup.

✅ **DONE** — Added Organization/NGO `JSON-LD` to the homepage (legal name
"Eastern Cooperative Recreation School", `alternateName` ECRS, logo, mission,
`sameAs` → Facebook + Instagram), generated from `site.json`.

🟢 Event `JSON-LD` `eventStatus` ternary returns `EventScheduled` on both
branches — harmless redundancy; past events could map to a distinct status.

---

## 6. UX — _solid_

✅ Clear hero with featured-event card + countdown, sensible CTAs, breadcrumb on
event detail, native share with clipboard fallback, `.ics` calendar export,
maps deep-link with desktop fallback.

✅ **DONE** — Contact and Donate pages now show a short "Trouble loading the
form? Email us directly at contact@ecrs.org" note alongside the intro copy,
so visitors aren't stuck if the Cognito iframe fails to load.

✅ **DONE** — `404.astro` now uses `PageLayout` (header/footer present) instead
of the bare `Layout`.

---

## Suggested execution order

1. ~~**Cleanup:** delete demo pages/blog/Splitbee + orphan widgets, disable
   blog.~~ ✅ Done.
2. ~~**Monitoring:** Cloudflare Web Analytics + GA4 + consent banner.~~ ✅ Done.
3. ~~**Headers & SEO quick wins:** `_headers` (cache + security), `robots.txt`
   sitemap line, homepage Organization JSON-LD.~~ ✅ Done.
4. ~~**Accessibility:** muted-text contrast bump.~~ ✅ Done (resolved as a
   side effect of `c16dbc7`).
5. ~~**Performance:** image compression/optimization pass.~~ ✅ Done — CMS/
   local images already route through Sharp; no oversized source files found.
6. ~~**Polish:** EventCard DRY, countdown diffing, Cognito fallbacks.~~ ✅ Done.

All items from this audit are now resolved. Re-audit if the site grows
significant new surface area.
