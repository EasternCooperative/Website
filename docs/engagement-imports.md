# Engagement imports

How real registration, donation, and membership data gets into the tracker. Everything
personal lives in `~/Documents/ECRS/engagement-export/` (owner-only), never in the
repository, and the extract is **temporary**: it holds names and emails, and the erase
action cannot reach files on disk. Delete it after a successful load.

## Rules

- **Pull to disk, never through a chat.** Scripts read the source and write reduced files.
  Output on screen is counts only.
- **Allowlist, not blocklist.** The extractor copies only named fields. Phone, address,
  dietary needs, vaccination records, and internal notes are never stored.
- **Children are never people.** A child's name is hashed in memory with a keyed hash
  (`~/.config/ecrs/child-token.key`) and only the token and an age band are kept. Back the
  key up in the password manager before any tokens reach production: losing it breaks
  matching, and it must not live in the database or the repository.
- **Nothing is guessed.** Near-matches go to a review file. Forms that do not clearly map to
  an event are left out until a person confirms the map.
- **Ask before production.** Rehearse on a copy of the production data, run twice, then
  take a backup and a Time Travel bookmark and ask for approval.

## Cognito event registrations

1. **Pull** (resumable; Cognito rate-limits, so it is slow):
   `node scripts/engagement/pull-cognito.mjs --resume`
2. **Map forms to events.** Proposes by year and name, then you check it:
   `node scripts/engagement/map-forms.mjs`, edit `cognito/form-event-map.json`, then
   `node scripts/engagement/map-forms.mjs --confirm`.
3. **Export the people already in the database** (read-only) to `db-people.json`:
   `[{ "id": 1, "name": "...", "emails": ["..."] }]`, from `person` and `person_email`.
4. **Build:**
   `node scripts/engagement/build-registrations.mjs --people db-people.json --new-status inactive`
   It refuses to write SQL while anyone needs a decision. It writes `cognito/review.csv`.
   Fill in the `decision` column (`new`, `skip`, or `match:<id>`), then rerun with
   `--decisions cognito/review.csv`.
5. **Rehearse** the SQL on a local copy of production, twice, and compare counts.
6. **Back up, bookmark, ask, apply, verify.** Then delete `cognito/registrations.json`.

Class-registration forms are not imported: they list the same people for the same events.

## Opt-outs, gifts, memberships, merging

Same pattern for each: build prints counts only, refuses while anyone needs a decision, and writes SQL that
is safe to run twice. Rehearse on a local copy of production, then back up, bookmark, load, verify, and delete
the files that hold names, emails, or amounts.

- **Newsletter opt-outs:** `scripts/engagement/import-optouts.mjs` marks people as do-not-contact (an outreach row).
- **Gifts:** `scripts/engagement/build-donations.mjs --zeffy <xlsx> --people db-people.json --new-status inactive`.
  Reads the Zeffy export and the Cognito donation form (24). Gifts under $2 are dropped as test payments.
- **Memberships:** `scripts/engagement/build-membership.mjs --people db-people.json --new-status inactive`.
  Reads Cognito form 16. Paid, completed entries only. The member and any household members named count for the
  year submitted (annual, ending December 31), or a lifetime membership. Unpaid, refunded, and incomplete entries
  are tallied and left out.
- **Duplicates:** admins use the Duplicates tab. A merge moves a person's history to the record kept, keeps the
  other name as an alias so imports still match, and writes an append-only `person_merge` row (counts only).

## Cognito API budget

The Cognito plan includes 10,000 API requests a month and bills $20 per 100,000 beyond that. The API has no
list endpoint, so reading a form costs one request per entry number plus about 50 to find the end, and
retries count too. Every script that calls the API shares `scripts/lib/cognito-budget.mjs`, which counts each
request in `~/.config/ecrs/cognito-usage.json` and stops a run before it crosses a cap:

- 300 requests per run (`COGNITO_MAX_REQUESTS`) and 6,000 per month (`COGNITO_MONTH_CAP`).
- Raising either is deliberate: say how many requests you expect to need first.
- Never re-read a form to redo work. The builders print the SQL they produced; keep it until it is loaded.
