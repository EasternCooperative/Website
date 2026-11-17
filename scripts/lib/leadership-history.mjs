// Pure logic for importing historic event rosters into the leadership tracker.
// No file or network access here: scripts/import-leadership-history.mjs does the
// I/O, and src/__tests__/leadership-history.test.ts covers this file.

/** Lower-case, accent-free, punctuation-free form used to compare names. */
export const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’,]/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Trim and collapse whitespace but keep the original capitalization. */
export const tidy = (s) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();

export function levenshtein(a, b) {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/**
 * Builds a resolver from known people. `directory` is an array of { id?, name }
 * for leader and staff records; `existing` is the names already in the database.
 * `overrides` maps a raw name to the person it really is. Earlier names and
 * spelling variants belong there, in a private file, never in this repository.
 * The target is looked up, so the database's or the leader record's spelling wins.
 *
 * resolve({ id, name }) returns { name, how } where `how` is one of:
 *   id | override | leader | existing | new | new-from-id
 * "new" means no record matched, so a person is created from the raw name.
 */
export function makeResolver({ directory, existing, overrides = {} }) {
  const byId = new Map(directory.filter((d) => d.id).map((d) => [d.id, d.name]));
  const byNorm = new Map();
  for (const d of directory) byNorm.set(norm(d.name), { name: d.name, how: 'leader' });
  for (const n of existing) byNorm.set(norm(n), { name: n, how: 'existing' }); // the database's spelling wins
  const overrideByNorm = new Map(Object.entries(overrides).map(([k, v]) => [norm(k), v]));
  const created = new Map();

  const lookup = (n) => byNorm.get(norm(n)) ?? null;

  /** @param {{ id?: string, name?: string }} entry */
  return function resolve({ id, name }) {
    if (id && byId.has(id)) {
      const canonical = byId.get(id);
      return { name: lookup(canonical)?.name ?? canonical, how: 'id' };
    }
    const raw = tidy(name || (id ? id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : ''));
    if (!raw) return null;
    const key = norm(raw);

    if (overrideByNorm.has(key)) {
      const target = overrideByNorm.get(key);
      return { name: lookup(target)?.name ?? target, how: 'override' };
    }
    const hit = lookup(raw);
    if (hit) return hit;
    if (created.has(key)) return created.get(key);
    const fresh = { name: raw, how: id ? 'new-from-id' : 'new' };
    created.set(key, fresh);
    return fresh;
  };
}

/** Pairs of names that look like the same person spelled two ways. For review only. */
export function nearDuplicates(names) {
  const out = [];
  const list = [...new Set(names)];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = norm(list[i]);
      const b = norm(list[j]);
      const close = levenshtein(a, b) <= 2 && Math.min(a.length, b.length) > 6;
      const [af, ...ar] = a.split(' ');
      const [bf, ...br] = b.split(' ');
      const sameLast = ar.length > 0 && ar.join(' ') === br.join(' ');
      const firstAlias =
        sameLast && af[0] === bf[0] && (af.startsWith(bf) || bf.startsWith(af) || af.length === 1 || bf.length === 1);
      if (close || firstAlias) out.push([list[i], list[j]]);
    }
  }
  return out;
}

/**
 * The leaders of one class, mirroring src/utils/classes.ts: the `leaders` array
 * wins; otherwise the singular leaderId/leader fields. Returns raw entries.
 */
export function classEntries(cls) {
  const entries = cls.leaders?.length
    ? cls.leaders
    : cls.leaderId || cls.leader
      ? [{ id: cls.leaderId, name: cls.leader }]
      : [];
  return entries.filter((e) => e && (e.id || e.name));
}

const PRECEDENCE = { solo: 3, partner: 3, assisting: 1 };

/**
 * Roles for one class: one leader is solo, two or more are partners, and anyone
 * marked as an assistant is assisting. `resolve` turns an entry into a person.
 * A person listed twice keeps the stronger role.
 */
export function classRoles(cls, resolve) {
  const entries = classEntries(cls);
  const leads = entries.filter((e) => e.role !== 'assistant');
  const type = leads.length > 1 ? 'partner' : 'solo';
  const roles = new Map();
  for (const e of entries) {
    const person = resolve(e);
    if (!person) continue;
    const leadership_type = e.role === 'assistant' ? 'assisting' : type;
    const key = norm(person.name);
    const prior = roles.get(key);
    if (!prior || PRECEDENCE[leadership_type] > PRECEDENCE[prior.leadership_type]) {
      roles.set(key, { person, leadership_type });
    }
  }
  return [...roles.values()];
}

/** extended (4+ days), weekend (2 to 3), or one_day, from the event's dates. */
export function eventType(date, endDate) {
  const start = Date.parse(String(date).slice(0, 10));
  const end = endDate ? Date.parse(String(endDate).slice(0, 10)) : start;
  const days = Math.round((end - start) / 86_400_000) + 1;
  if (days >= 4) return 'extended';
  if (days >= 2) return 'weekend';
  return 'one_day';
}

// First matching rule wins, so order matters: more specific kinds come first.
// `weak` rules are broad words, so the review file flags them for a human look.
const TYPE_RULES = [
  // [type, pattern, weak, subtype]
  ['Play Parties', /play ?part(y|ies)/, false, ''],
  [
    'Music',
    /\b(sing|singing|singalong|sing along|song|songs|songlibs|beatlesing|chorus|choir|rounds?|harmon\w*)\b/,
    false,
    'Singing',
  ],
  [
    'Music',
    /ukulele|whistle|guitar|banjo|fiddle|recorder|harmonica|mandolin|dulcimer|instrument|orchestra/,
    false,
    'Instruments',
  ],
  ['Music', /\bdrum(s|ming)?\b|percussion|rhythm/, false, 'Rhythm'],
  ['Music', /\bmusic(al)?\b/, false, ''],
  ['Dancing', /danc|contra|square|waltz|\bfolk\b|swing|tango|salsa|cajun|\breel\b|ceilidh/, false, ''],
  [
    'Drama',
    /dram|improv|theat|scenes?\b|acting|story ?tell|skit|puppet|clown|\bmime\b|comedy|monologue|play ?writ|\bplays?\b/,
    false,
    '',
  ],
  ['Games', /game|\btag\b|team ?build|cooperative|initiative|icebreaker/, false, ''],
  [
    'Crafts',
    /craft|\bart\b|paint|draw|knit|sew|pottery|mosaic|collage|origami|jewel|weav|print ?making|sketch|bead|\bclay\b|woodwork|calligraph/,
    false,
    '',
  ],
  [
    'Movement',
    /yoga|movement|tai ?chi|qi ?gong|stretch|fitness|exercise|pilates|feldenkrais|walk|hik|swim|\bmove\b/,
    false,
    '',
  ],
  [
    'Personal Development',
    /mindful|meditat|empathy|encore|retire|journal|well ?being|heal|resilien|grief|gratitude|spiritual|reflect|\blife\b|coach|self/,
    false,
    '',
  ],
  ['Theory', /leader|facilitat|philosoph|history|theory|teaching|training|smorgasbord|\bdiscussion\b/, false, ''],
  ['Other', /child|kids|preschool|family|youth|teen|\bwrite\b|writing/, false, ''],
];

/**
 * A saved review row that is still only a proposal (not confirmed by a person) and
 * is typed Other can be refreshed when the rules learn something. Returns the new
 * { type, subtype, basis }, or null to leave the row exactly as it is. A row a
 * person has set (any basis not starting with "proposed") is never changed.
 */
export function refreshProposal(saved, guess) {
  const unconfirmed = /^proposed/.test(saved?.basis ?? '');
  if (!unconfirmed || saved.type !== 'Other' || guess.type === 'Other' || !guess.rule) return null;
  return { type: guess.type, subtype: guess.subtype, basis: `proposed: rule ${guess.rule}` };
}

/** { type, subtype, rule } for a class name, or { type: 'Other', rule: null } when nothing matches. */
export function classifyActivity(name) {
  const n = norm(name);
  for (const [type, re, weak, subtype] of TYPE_RULES) {
    const m = n.match(re);
    if (m) return { type, subtype, rule: m[0], weak };
  }
  return { type: 'Other', subtype: '', rule: null, weak: true };
}

/** Quote a field for CSV. */
export const csv = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** SQL string literal, or NULL. */
export const sql = (v) => (v === '' || v == null ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`);

/** The three leading statuses, matching the person table. */
export const STATUSES = ['active', 'hiatus', 'inactive'];

/** The activity types the database knows. */
export const TYPES = [
  'Drama',
  'Games',
  'Dancing',
  'Theory',
  'Movement',
  'Personal Development',
  'Other',
  'Crafts',
  'Music',
  'Play Parties',
];

// Singing used to be a type of its own. It is now a subtype of Music, so an old
// 'Singing' (in a review file or the sheet) becomes Music with the subtype Singing.
const LEGACY_TYPES = { Singing: { type: 'Music', subtype: 'Singing' } };

/** { type, subtype } with any retired type name translated to its replacement. */
export function normalizeType(type, subtype = '') {
  const legacy = LEGACY_TYPES[type];
  return legacy ? { type: legacy.type, subtype: subtype || legacy.subtype } : { type, subtype: subtype || '' };
}

/** In history-types.csv, marks a "class" that is not really one (such as a break), so it is left out. */
export const SKIP = 'SKIP';

/** Anyone who last led in this year or later gets a status from a person, not from a rule. */
export const JUDGMENT_FROM = 2018;

/**
 * A proposed status for someone who last led before JUDGMENT_FROM, or null when
 * a person has to decide. Only "led once, long ago" can be read from the data:
 * whether someone is deceased or retired cannot, so those stay for a human.
 */
export function defaultStatus({ events, lastYear }) {
  if (lastYear >= JUDGMENT_FROM) return null;
  return events <= 1
    ? { status: 'inactive', basis: `led once, not since ${lastYear}` }
    : { status: 'hiatus', basis: `led ${events} times, last in ${lastYear}` };
}

/** Parse CSV text into rows of strings. Handles quotes, escaped quotes, and CRLF. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f !== ''));
}

/** True for the ways a person might write "yes" in a spreadsheet cell. */
export const isYes = (v) => /^(y|yes|true|1|x)$/i.test(String(v ?? '').trim());
