# Disaster Recovery

What it actually takes to bring `ecrs.org` back if something goes wrong —
and the honest answer to "can we restore from the repo alone?" (mostly, but
not entirely). Read this alongside [deployment-and-cms.md](./deployment-and-cms.md),
which covers the same environment-variable table referenced below in more
depth.

## What "restore from the repo" actually covers

Cloning `EasternCooperative/Website` and running `npm ci && npm run build`
fully reproduces:

- All page/content source and the Astro build pipeline.
- `public/_redirects` and `public/_headers` — Cloudflare Pages config-as-code,
  committed to the repo.
- `functions/` — the Pages Functions (donation webhook handlers,
  `_middleware.js` consent-region stamping).
- The Sveltia CMS config (`public/admin/config.yml`).

Rebuilding the **code and content** is trivial and low-risk: worst case is
re-cloning and re-deploying to a fresh Pages project.

## What is NOT in the repo

Everything below has to be reconstructed from outside the repo — from the
Cloudflare dashboard, third-party admin consoles, or local notes. None of it
is recoverable by `git clone` alone.

### Cloudflare Pages project configuration

- Custom domain attachments (`ecrs.org`, `www.ecrs.org`) and their TLS
  certificate issuance.
- Environment variables/secrets (Settings → Environment variables, Production
  - Preview). Names are documented in
    [deployment-and-cms.md](./deployment-and-cms.md#donation-conversion-tracking-google-ads--ga4):
    `GA4_MEASUREMENT_ID`, `GA4_API_SECRET`, `TRACK_PURCHASE_KEY`,
    `ZEFFY_WEBHOOK_SECRET`. Values are not, and should never be, committed.
- The `sveltia-cms-auth` OAuth Worker (separate Cloudflare Worker, not in this
  repo) — its `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`/`ALLOWED_DOMAINS`
  secrets gate CMS login.

### DNS zone (Cloudflare, registrar Bluehost)

The zone itself — MX (Google Workspace), SPF, the three sets of DKIM CNAMEs
(Google, Mailchimp, Zeffy's SendGrid-branded `zeffy.ecrs.org`), the
`ghs.googlehosted.com` service CNAMEs, and the Pages custom-domain CNAMEs —
lives entirely in Cloudflare's DNS product, not in git. Losing the zone
without a current export breaks mail (SPF/DKIM/DMARC) before it breaks the
website. There is no automated export of this zone checked in anywhere;
a manual `dig`-based re-audit would be needed to rebuild it correctly (a
straight cPanel-style export is not safe — see the record-by-record
history below).

### Third-party service configuration

- **Zeffy** — webhook subscription (account-wide, `payment.completed` →
  `/api/track-purchase/zeffy`), the signing secret, and the branded-domain
  mail setup.
- **Cognito Forms** — per-form webhook config
  (`/api/track-purchase/cognito`), form definitions themselves.
- **Google Ads / GA4** — conversion actions, campaign/ad-group structure,
  the GA4 property and Measurement Protocol secret.
- **Mailchimp** — subscriber lists, DKIM delegation.
- **Sveltia CMS OAuth Worker** — a separate Cloudflare Worker outside this
  repo, holding the GitHub OAuth app credentials that let editors log into
  `/admin`.

### GitHub repository metadata

Issues, PR history, Actions run history, and repo settings (e.g., the
deliberate absence of branch protection on `main` — see
[deployment-and-cms.md](./deployment-and-cms.md)) are GitHub-side state, not
part of a git clone.

### Internal-only recovery notes

Sensitive planning documents (board communications, specific DNS record
dumps, credentials used during the 2026 WordPress→Cloudflare cutover) are
deliberately kept **outside this public repo**, under `~/Documents/ECRS/` on
the maintainer's machine. This repo is public; that directory is not. If
you're rebuilding the zone or the comms plan from scratch, start there before
reconstructing anything from history.

## Recovery runbook (rough order)

1. Clone the repo, `npm ci`, confirm `npm run build` succeeds locally.
2. Create/attach a Cloudflare Pages project pointed at this repo (native Git
   integration — no separate CI deploy step required).
3. Re-add environment variables/secrets (names above; values come from each
   service's own admin console, not from any repo history).
4. Re-attach custom domains (`ecrs.org`, `www.ecrs.org`) and wait for TLS
   issuance to show active _before_ pointing DNS at Pages — flipping DNS
   first serves a TLS warning.
5. Rebuild/re-point the DNS zone: MX, SPF, DKIM (all three providers), Google
   service CNAMEs, then the two Pages CNAMEs last.
6. Re-verify Sveltia CMS OAuth (`sveltia-cms-auth` Worker `ALLOWED_DOMAINS`
   includes the live hostnames) so editors can log into `/admin`.
7. Re-subscribe the Zeffy account-wide webhook and re-check each Cognito
   form's webhook URL; both carry a shared-secret query param
   (`TRACK_PURCHASE_KEY`) that must match step 3's value.
8. Spot-check: `/_redirects` rules resolve, `/gallery` loads, a real `$1`
   test donation on each platform round-trips to GA4/Ads (see
   deployment-and-cms.md for the verified payload shapes).

## Bottom line

Realistically, GitHub and Cloudflare both disappearing outright is a low
enough probability to not plan around directly. The higher-probability risks
this doc actually protects against are narrower: someone fat-fingering a DNS
record, a Pages project misconfiguration, losing track of which webhook
secret lives where, or an OAuth worker's allowed-domains list going stale.
Those are exactly the pieces that don't come back from `git clone` alone.
