# Site audit, November 2026

An audit of ecrs.org and its staff tools covering performance, SEO, leftover code, ad tracking, and the schedule generator. Low-risk fixes were made on the `audit/site-and-schedule` branch alongside this report. Anything that needs a decision, a dashboard change, or carries real risk is listed as a recommendation and was not changed.

Measurements come from a production build on 2026-11-09 and from requests to the live site on the same day.

## Summary

| Area               | Fixed on this branch                                                                                     | Left as a recommendation                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| SEO                | Redirect on every page URL, staff page in the sitemap, robots rules, `llms.txt`                          | `www` duplicate host (dashboard change, steps below)          |
| Performance        | HTML served without a Function, animation library not downloaded on mobile, unused font file             | About page map weight, search script, hero video, hero poster |
| Leftover code      | Template skill files, unused icon set, dead share handler, `.pnpmrc`                                     | Local-only folders                                            |
| Tracking           | Consent signals, pixel opt-out, mailing list signups, Ads conversion value, Meta mapping, Meta purchases | Zeffy attribution                                             |
| Schedule generator | Tool screens, attendee PDFs, master schedule print, one-paste publishing, black and white                | Nothing outstanding                                           |

## Check after this deploys

1. Open `https://ecrs.org/internal` in a private window. It should redirect to `/internal/tools` and then ask for a login. See "Staff tools index moved" below for why.
2. In Google Search Console, resubmit `sitemap-index.xml` and spot check that `/about` reports as the canonical URL with no redirect.
3. Load any page, open the site search, and confirm a result opens the right page.
4. From a US connection, confirm no cookie banner appears and GA4 Realtime shows the visit. Through a VPN exit outside the US, confirm the banner appears.
5. In Google Ads, set the "form submit" conversion action to Secondary (see Tracking below).
6. To turn on Meta purchase values, follow "Meta purchase value" in `docs/deployment-and-cms.md`.

## SEO

### Fixed: every page URL redirected first

Every canonical tag, sitemap entry, and internal link on the site uses a slash-less URL such as `/about`. Cloudflare Pages was serving those pages from `about/index.html`, which it only answers at `/about/`, so each request to `/about` got a 308 redirect before the page loaded. Measured on the live site:

```
/about                          308 -> /about/
/events                         308 -> /events/
/events/2026-winter-adventure   308 -> /events/2026-winter-adventure/
```

That is an extra round trip on every navigation, and it meant the URL the site declares as canonical was never the URL that returned the page.

`astro.config.ts` now sets `build.format: 'file'`, which emits `about.html`. Cloudflare serves that at `/about` directly. Verified with Cloudflare's local Pages runtime: `/about` returns 200, `/about/` redirects once to `/about`, and the old WordPress redirects in `public/_redirects` still land in one hop.

Supporting changes: `pagePathname()` in `src/utils/permalinks.ts` strips the `.html` that Astro now puts on `Astro.url.pathname` during a build (used for canonicals, the active nav link, and structured data URLs), `src/utils/searchUrlFix.ts` does the same for search results, and `scripts/render-schedule-pdfs.mjs` finds schedule pages in either output format.

### Fixed: a staff page was in the sitemap

`/internal` was listed in `sitemap-0.xml`. The sitemap filter only excluded paths containing `/internal/`, which the index page did not match. The filter now matches `/internal` as a path segment, and `robots.txt` disallows `/admin/` and `/internal/`.

### Staff tools index moved

The Cloudflare Access login for staff tools covers `/internal/*`. That pattern does not match a bare `/internal`, which today is only protected by accident: the request is redirected to `/internal/` and that URL is covered. With slash-less URLs the index would have been served without a login.

The index page is now `/internal/tools`, inside the protected pattern, and `/internal` redirects to it. The two tools themselves were always covered. A cleaner long-term fix is to add `ecrs.org/internal` as a second path on the Access application.

### Fixed: `llms.txt` was wrong

`public/llms.txt` said ECRS was based in the greater Boston area and that newcomers get 50% off. It now gives the Philadelphia mailing address, the states where events are held, and the free first multi-day event that the site itself advertises. It also lists the pages it was missing (Activities, Gallery, Connections, the mailing list) and points to the `.txt` and `.ics` versions of event pages.

### Recommended

- **`www.ecrs.org` serves a full copy of the site** with a 200 response. Canonical tags point search engines at the apex, so this is not harmful, but it splits analytics across two hosts. This cannot be fixed from the repo: Pages `_redirects` cannot match on hostname, and doing it in a Function would put a Function back in front of every page. In the Cloudflare dashboard for the ecrs.org zone: Rules, Redirect Rules, Create rule, choose the "Redirect from WWW to root" template, and deploy. It issues a 301 that keeps the path and query string.
- Structured data is in good shape: event pages carry `Event` markup with offers, people pages carry `Person`, and activity pages carry `HowTo`. Running one event URL through Google's Rich Results Test after deploy is a worthwhile five minute check.

## Performance

### Fixed: animation library downloaded on mobile for nothing

`src/utils/scrollReveal.ts` imported the `motion` library on every page (75 KB, 27 KB gzipped), then returned immediately on phones and for visitors who prefer reduced motion. It now loads the library only when there is something to animate. Mobile visitors no longer download it. On desktop it arrives as a separate 66 KB chunk, and content that is about to animate is hidden up front so nothing flashes while it loads.

### Fixed: every page request ran a Function

`functions/_middleware.js` ran on every page request to stamp the visitor's country into the HTML for the consent banner, and marked every page `Cache-Control: private, no-cache`. No page could be served from Cloudflare's static asset cache, and each page view counted against the Functions quota.

The middleware is gone. `public/_routes.json` now sends only `/api/*` to Functions, so pages are served as static assets. The consent script asks Cloudflare's own `/cdn-cgi/trace` endpoint for the country, once per browser session. The policy is unchanged: the banner shows everywhere except the US, and an unknown country is treated as gated. A returning visitor who already accepted is measured immediately without waiting for the lookup.

### Fixed: unused font file

The hero font shipped a 105 KB `.ttf` fallback behind the `.woff2`. Every browser the site supports uses the `.woff2`, so the fallback is removed.

### Recommended

- **The About page is the heaviest page on the site.** Its HTML is 474 KB (177 KB gzipped) against 56 KB for the homepage. About 400 KB of that is the member map, rendered on the server as 74 SVG paths and then rendered again in the browser by an 876 KB script chunk. The source geometry, `src/data/us-ca-admin1.json`, is 1.2 MB. Options, in order of effort: simplify the geometry (a map this size does not need that precision), or draw the map once at build time as a static SVG and keep the script for the interactive staff version only.
- **The search script loads eagerly on every page**: 155 KB, 38 KB gzipped. It could load on first use of the search button. Not attempted because of the known fragile interaction between Pagefind and view transitions.
- **`toss-game.webm` is larger than its `.mp4`** (9.0 MB against 8.8 MB) and is offered to browsers first. Re-encode it or drop it. The hero videos total 39 MB in the repo, though they are fetched lazily.
- **The homepage hero poster** is the likely largest paint and has no preload or `fetchpriority`. Measure with Lighthouse before changing it.
- **Scroll animation**: the standing plan is to move to native CSS scroll-driven animations once Safari and Firefox support them. Worth rechecking support now, since that would remove the library entirely.

For reference, the remaining page weights are reasonable: one 170 KB stylesheet (30 KB gzipped), and HTML of 143 KB for the events list, 281 KB for the Winter Adventure page, and 295 KB for Our People.

## Leftover code

### Removed

- `.agents/skills/`: four AstroWind template guides, including one for adding blog posts to a blog this site does not have. Superseded by `.claude/skills/`.
- `.pnpmrc`: the project uses npm.
- The `flat-color-icons` icon set, its dev dependency, and its include list in `astro.config.ts`. No icon from it is used.
- The social share click handler in `BasicScripts.astro`. Nothing in the site renders a share button.

### Checked and kept

- `.vscode/astrowind/config-schema.json` is used by the editor settings for `config.yaml`.
- The `.jpg` video posters are the fallback when a `.webp` poster is missing.
- The types in `src/types.d.ts` that look unused are referenced by other types in the same file.

### Not in the repo

`perf-audit/`, `coverage/`, and `test-results/` are git-ignored local folders. They can be deleted locally at any time.

## Ad tracking and digital marketing

### How it works today

GA4 and the Meta Pixel load immediately for US visitors and after an accepted banner everywhere else. The Google Ads tag is deferred until the visitor's first interaction. Payments reach GA4 from the server: Cognito Forms and Zeffy call webhooks in `functions/api/track-purchase/`, which send a `purchase` event with the real amount. Cognito purchases carry the visitor's GA client and session ids, so they attribute to the ad click.

This is a sound setup. The gaps are at the edges.

### Fixed

- **Mailing list signups were not tracked at all.** The Mailchimp form posts straight to Mailchimp with no script, so neither GA4 nor Meta saw a signup, including those arriving through the `/join` short link on printed material. A submit now sends `form_submit_newsletter` to GA4 and a `Lead` event to Meta. To count it as a conversion, mark `form_submit_newsletter` as a key event in GA4.
- **Google consent signals.** The site decided whether to load Google's tag but never told the tag what the visitor had agreed to. Google now requires those signals (Consent Mode v2) before it will use data from European visitors for conversions or audiences. `Analytics.astro` now sets them and updates them if a visitor changes their choice.
- **Meta Pixel opt-out.** A visitor who accepted and later chose "No thanks" in cookie settings stopped GA but not the pixel. The pixel now receives a revoke.

- **Ads conversion value.** `EventTracker.astro` sent a Google Ads conversion with a fixed value of 1.00 USD whenever an event form was submitted, on top of the real `purchase` from the webhook. The made-up value is removed, so Ads only ever sees real revenue. One dashboard step remains: if that conversion action and the GA4 purchase are both Primary goals, a paid registration still counts as two conversions. Set the form submit action to Secondary. It is still worth keeping, because it is the only signal for free events.
- **Meta counted a page view as a registration.** For events with no signup form, opening the event page fired `event_view_conversion`, mapped to Meta's `CompleteRegistration`. It now maps to `ViewContent`. Expect the registration count in Meta to drop to the real figure.
- **Meta now learns what a registration is worth.** The Cognito webhook sends each payment to Meta's Conversions API as a `Purchase` with its amount. It is dormant until a pixel id and access token are set in Cloudflare and two hidden fields (`FBP`, `FBC`) are added to each Cognito payment form. Setup is in `docs/deployment-and-cms.md`. It only sends for visitors who already have the pixel's cookie, so it follows the same consent rule as the pixel.

### Recommended

- **Zeffy payments cannot be attributed.** The Zeffy form is a cross-origin iframe, so the site cannot pass it the visitor's GA or Meta id. Each Zeffy purchase is recorded in GA4 against a random id and is not sent to Meta at all. The revenue is counted but never tied to a campaign. Worth knowing when comparing campaigns that drive Zeffy events against those that drive Cognito events.
- **Each new Cognito registration form** needs the Submit webhook and the hidden `GAClientId`, `GASessionId`, `FBP`, and `FBC` fields added by hand. A line in the `new-event` skill would make that harder to forget.

## Schedule generator

### What changed

**The tool** (`/internal/schedule`)

- A numbered stepper with clear done, current, and upcoming states, and a summary line showing how many classes there are, how many still need a room, and how many attendees are loaded.
- Classes with no room are highlighted and counted. Previously nothing flagged them, and the public schedule page silently stayed hidden.
- The message under a disabled Continue button now names what is wrong. It used to say "resolve timeslot conflicts" even when the problem was two classes in one room.
- The print cards show page counts and are disabled, with an explanation, until registrations are loaded.

**Bug fixed: saved rooms overrode published ones.** The tool kept one room list in the browser, shared across every event, and applied it over whatever the event file said each time the page opened. A room published by one person could be silently replaced on another person's screen by a stale local value. Edits are now saved per event, remember which published value they were made against, and are dropped once that published value changes. Timeslot edits are saved the same way, where before they were lost on reload. A banner says when unpublished edits were restored and offers to discard them.

**Bug fixed: the wrong year could print.** Attendee PDFs took the year from the day they were generated. Winter Adventure runs across New Year, so schedules reprinted on January 1 would have been headed with the following year. They now use the event's own year.

**One-paste publishing.** Publishing rooms used to mean pasting the timeslot block, then copying each room into its class in the CMS one at a time. The exported block now carries a `rooms` list, so one paste publishes the whole plan. A room typed on a class in the CMS still wins over the list, and the tool warns when one does and disagrees. Entries include the period, because Winter Adventure has two classes named "Children's Program".

**Attendee PDFs**

- Individual schedules have a Time, Class, and Room column, in place of the room being appended to the class name.
- A class that runs only two of the four days is labelled with its days, and the other half shows as free. Before, a single "Days 1–2" class printed with no day label and read as running all week.
- Time ranges no longer wrap mid-time, and long names shrink to stay on one line so the facility map always stays on the same page.
- Rosters have drawn check boxes (they were typed brackets), a rule under each name, and the day range for half-length classes.

**Master schedule** (`/events/<id>/schedule` and its PDF)

- Dates and venue under the title, and an "as of" date with the page address at the foot, so two printouts can be told apart.
- Times stack as start over end and never wrap.

### Black and white printing

Everything printable now assumes a black-and-white printer:

- The PDFs use black and grays, nothing else. A unit test fails if a color is introduced.
- The master schedule PDF previously printed the site's warm page tint across the whole sheet. It now prints on white, with heavier black rules marking each period and each meal row, so the structure survives a printer that drops light fills.
- Printing any page while browsing in dark mode used to put the dark theme's pale text on white paper. Shared print rules in `src/assets/styles/print-base.css` force black text on white.
- Activity sheets drop their tinted card and pill backgrounds when printed and keep gray outlines.

### Verified

The tool was driven in a browser against the 2026 Winter Adventure classes with a test registration export of 11 attendees, including one with every period split and a 44 character name. Both PDFs were generated and read back: 11 attendees produced 11 pages, each with its map.
