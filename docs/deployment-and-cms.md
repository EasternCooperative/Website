# Deployment & CMS

How the ECRS site gets content, builds, and deploys. Read this before
changing CI, the CMS config, or anything touching `main`.

## Hosting & deploys

- **Cloudflare Pages** builds and deploys via its native Git integration:
  every push to `main` triggers `npm run build` on CF's side. GitHub Actions
  does **not** deploy.
- **GitHub Actions is validation-only and does not gate deploys.** The real
  safety net is the build itself: the zod schemas in `src/content.config.ts`
  make `astro build` fail on invalid content, and Cloudflare keeps serving
  the last successful deployment when a build fails.
- **Do not add branch protection or required status checks to `main`.**
  Sveltia CMS commits directly to `main` (see below); required checks would
  block every content edit.
- **Weekly rebuild** (`.github/workflows/scheduled-deploy.yml`): Mondays
  08:00 UTC, a Cloudflare deploy hook rebuilds the site. The site is static,
  so date-dependent output (upcoming vs. past events) only changes at build
  time — the cron rolls events over even when nothing is committed.
- **Path-aware CI** (`.github/workflows/actions.yaml`): commits that only
  touch content (`src/data/**`, `public/images/**` — i.e. every Sveltia
  edit) run just the fast validators (`check` + `build`). Code changes also
  run unit tests, Playwright e2e (against the built site), and Lighthouse
  (accessibility/best-practices/SEO enforced at ≥ 0.9).
- **Schedule PDFs** (`.github/workflows/schedule-pdfs.yml`): when schedule
  code or event data changes, headless Chrome renders each
  `/events/<id>/schedule` page to `public/schedules/<id>.pdf` and commits it
  to `main` (the `chore(schedule): regenerate master-schedule PDFs` commits).
- Pages are plain static HTML: `public/_routes.json` sends only `/api/*` to
  Pages Functions. The consent banner's region check runs in the browser
  (`Analytics.astro` asks Cloudflare's `/cdn-cgi/trace` for the visitor's
  country once per session). An edge middleware used to stamp the region into
  every page, which ran a Function on each request and made HTML uncacheable;
  do not reintroduce a catch-all `functions/_middleware.js`.

## Donation conversion tracking (Google Ads / GA4)

`functions/api/track-purchase/{cognito,zeffy}.js` are Cloudflare Pages
Functions that receive payment webhooks and forward them to GA4 Measurement
Protocol as a `purchase` event, so the Google Ads "Donation Completed"
conversion action (imported from GA4's `purchase` event on the `www.ecrs.org`
property, measurement ID `G-TMYSFB9B9J`) gets real donation value instead of
a generic form-submit signal. Shared MP-sending logic and the shared-secret
auth check live in `functions/_lib/ga4.js`.

**Required Cloudflare Pages environment variables** (Pages dashboard →
project → Settings → Environment variables — set for both Production and
Preview, never committed to the repo):

| Variable               | Purpose                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GA4_MEASUREMENT_ID`   | `G-TMYSFB9B9J` — same property as `analytics.vendors.googleAnalytics.id` in `src/config.yaml`                                                                                                                                                                                                                                                                                                                   |
| `GA4_API_SECRET`       | GA4 Measurement Protocol API secret, nicknamed "server-side-webhooks (Cognito, Zeffy)" in GA4 admin (Data Streams → www.ecrs.org → Measurement Protocol API secrets)                                                                                                                                                                                                                                            |
| `TRACK_PURCHASE_KEY`   | Shared secret required as a `?key=` query param on both webhook URLs — without it, the endpoint is a public POST that can inject fake conversions into the Ads account's Primary bidding goal                                                                                                                                                                                                                   |
| `ZEFFY_WEBHOOK_SECRET` | Zeffy's webhook signing secret (`whsec_...`, from Zeffy account → Settings → Integrations → Webhooks). Used to verify the `zeffy-signature` header on every request — Zeffy's webhook is account-wide (not per-form), so this is the only source-authenticity check on that endpoint beyond the shared `?key=`. Cognito has no equivalent (it doesn't sign requests), so `TRACK_PURCHASE_KEY` is its only gate. |
| `WA_FORM_IDS`          | Comma-separated Cognito form ids that also send a `wa_purchase` event alongside `purchase` (e.g. `131`). Update it when next year's Winter Adventure registration form is created. Unset means no `wa_purchase`.                                                                                                                                                                                                |
| `GA4_DEBUG`            | Optional. `true` sends to GA4's validation endpoint (`/debug/mp/collect`) instead of the live one and logs the validation messages. Nothing reaches GA4. Never leave it on in Production.                                                                                                                                                                                                                       |

**Meta purchase value** (optional): the Cognito webhook also sends each payment
to Meta's Conversions API as a `Purchase` with its amount
(`functions/_lib/meta.js`). It stays off until both variables below are set and
the `TRACK_DEDUPE` KV namespace (below) is bound. No form changes are needed:
the page showing a form posts the visitor's Meta ids to `/api/track-ids`, which
stores them in that KV namespace under the visitor's GA client id, and the
webhook looks them up by the entry's `GAClientId`
(`functions/_lib/visitorIds.js`). The GA session id travels the same way, so a
new payment form needs only the one hidden `GAClientId` field. Zeffy payments
cannot be sent: its form is a cross-origin iframe.

| Variable               | Purpose                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| `META_PIXEL_ID`        | The pixel (dataset) id, same as `analytics.vendors.metaPixel.id` in `src/config.yaml`                          |
| `META_CAPI_TOKEN`      | Conversions API access token (Events Manager → the pixel → Settings → Conversions API → Generate access token) |
| `META_TEST_EVENT_CODE` | Optional. Sends events to Events Manager → Test events while checking the setup. Remove it afterwards.         |
| `META_API_VERSION`     | Optional. Overrides the Graph API version in `meta.js` if Meta retires it before the code is updated.          |

**KV binding** (Pages dashboard → project → Settings → Bindings → KV
namespace): bind a namespace as `TRACK_DEDUPE`. `cognito.js` records each
reported payment there, so a webhook retry, a submit plus a later update,
or a staff edit can't send `wa_purchase` twice (GA4 dedupes `purchase` by
`transaction_id`, but not custom events). Without the binding, the handler
falls back to a heuristic: it skips staff actions and payments older than
an hour before the update.

**Webhook setup (external, done by whoever administers each platform):**

- **Cognito Forms** — per form: Settings → Webhooks → **Submit Endpoint** →
  `https://ecrs.org/api/track-purchase/cognito?key=<TRACK_PURCHASE_KEY>`.
  On forms with a pay-later workflow (WA's "Register!" then "Pay"), set
  the **Update Endpoint** to the same URL too, so the later payment is
  reported. Staff "Update" and "Request Payment" actions are ignored by
  the handler, and the `TRACK_DEDUPE` KV binding stops repeats. Leave
  Delete blank. Each paid form also needs hidden Text fields named exactly
  `GAClientId` and `GASessionId` (Visible: Never) for ad-click attribution
  (see below). Wired up so far: Tax Deductible Donation (#24), 2026 Winter
  Adventure Event Registration (#131). Each year's new registration form
  needs these settings again, plus a `WA_FORM_IDS` update.
- **Zeffy** — account-wide, not per form: Settings → Integrations →
  Webhooks → subscribe to `payment.completed` →
  `https://ecrs.org/api/track-purchase/zeffy?key=<TRACK_PURCHASE_KEY>`.

**Field-name mappings verified 2026-08-25** against real $1 test donations
on both platforms — see the comments at the top of each function file for
the confirmed payload shapes. Event-registration payloads are still
unverified for both (only donation campaigns have been tested); re-check
`item_category` detection once a real ticketed event goes through either
platform.

**Ad-click attribution:** `CognitoForm.astro` prefills the hidden
`GAClientId` field from the visitor's `_ga` cookie and `GASessionId` from
the `_ga_TMYSFB9B9J` session cookie. `cognito.js` sends them as the GA4
`client_id` and `session_id`, so GA4 credits the purchase to the session
(and the ad click) that started it. Without `session_id`, GA4 reports
server-side purchases as "Unassigned" and Ads never imports them. If a
field is missing or empty
(consent declined, ad blocker, or a form without the field), a random
client_id is used: the conversion still counts but won't attribute. Zeffy
runs in a cross-origin iframe and can't read the cookie, so Zeffy purchases
always use a random client_id.

**Ads conversion goals:** the GA4-imported `purchase` action is the
**Primary** (bidding) conversion for both donations and event
registrations. `wa_purchase` (only forms in `WA_FORM_IDS`) is available
for a WA-only conversion action. The browser-side `form_submit_event` conversion
(`EventTracker.astro`) is **Secondary**, kept for reporting only, so one
registration isn't counted twice.

## CMS (Sveltia)

- Editors use **Sveltia CMS** at `/admin`. Configuration lives in
  `public/admin/config.yml` (GitHub backend, repo
  `EasternCooperative/Website`, branch `main`, media in `public/images/`).
- **Sveltia commits directly to `main`.** It does not support Decap's
  `editorial_workflow` (PR-based review), and nothing in this repo should
  assume PR-based content review.
- **OAuth** runs through an external Cloudflare Worker
  (`sveltia-cms-auth.isaac-cd9.workers.dev`) — not part of this repo.
- **The Sveltia bundle is version-pinned via npm**, not loaded from a CDN:
  `@sveltia/cms` is a devDependency, and `scripts/copy-sveltia-cms.mjs`
  (run by the `predev`/`prestart`/`prebuild` npm scripts) copies the bundle
  to `public/admin/sveltia-cms.js` (gitignored). Dependabot proposes
  upgrades like any other package. Never reintroduce an unpinned CDN URL.
- `local_backend: true` lets you edit against the local repo: run
  `npm run dev` and open `http://localhost:4321/admin`.

## Content model

| CMS collection | Target                                                                                                                                                         | Consumed via                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Events         | `src/data/events/*.md`                                                                                                                                         | `event` content collection                     |
| Leaders        | `src/data/leaders/*.md`                                                                                                                                        | `leader` content collection                    |
| Venues         | `src/data/sites/*.md`                                                                                                                                          | `site` content collection                      |
| Testimonials   | `src/data/testimonials/*.md`                                                                                                                                   | `testimonial` content collection               |
| Activities     | `src/data/activities/*.md` (game, dance, song entries)                                                                                                         | `activity` content collection                  |
| Gallery        | `src/data/gallery/*.md`, media in `public/images/gallery`                                                                                                      | `galleryPhoto` content collection              |
| Pages → Home   | `src/data/settings/landing.md`                                                                                                                                 | `landingSettings` content collection           |
| Pages → others | `src/data/settings/*.json` (about, connections, events-list, activities-list, gallery, contact, donation, membership, not-found), `src/data/pages/people.json` | direct ESM import by the page                  |
| Site Settings  | `src/data/settings/{site,navigation,footer}.json`                                                                                                              | direct ESM import by header/footer/event pages |

`src/data/staff/*.md` (`staff` collection) is edited in git only; it has no CMS collection.

When adding or changing a CMS field, update **both** sides: the field in
`public/admin/config.yml` and the zod schema in `src/content.config.ts`
(plus the component that renders it). A field that exists only in the CMS
saves to the file but is silently stripped by Astro and renders nowhere.

## E2E fixtures

`src/data/events/e2e-*.md` are `draft: true` fixtures used by the Playwright
suite (`e2e-past-event`, `e2e-future-event`, `e2e-popover-fixture`). Drafts
are excluded from listings, and the sitemap filters `/events/e2e-`. Don't
delete them, and keep new fixtures on the `e2e-` prefix.
