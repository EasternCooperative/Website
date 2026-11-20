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
