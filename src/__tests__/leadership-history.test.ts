import { describe, expect, it } from 'vitest';
import {
  TYPES,
  classEntries,
  classRoles,
  classifyActivity,
  csv,
  dedupeRoles,
  defaultStatus,
  eventType,
  extraAssistingRoles,
  isYes,
  levenshtein,
  makeResolver,
  nearDuplicates,
  norm,
  normalizeType,
  parseCsv,
  refreshProposal,
  sql,
  personName,
  tidy,
} from '../../scripts/lib/leadership-history.mjs';

// Placeholder names only. The real former-name map is exercised through its ids.
const directory = [
  { id: 'person-a', name: 'Person A' },
  { id: 'allie-cliffe', name: 'Allie Cliffe' },
  { id: 'carolyn-peters-michener', name: 'Carolyn Peters Michener' },
  { id: 'marko-schmale', name: 'Marko Schmale' },
];

describe('names', () => {
  it('normalizes case, accents, punctuation, and hyphens', () => {
    expect(norm("  J.P.  McDévitt-O'Neil ")).toBe('jp mcdevitt oneil');
    expect(norm(null)).toBe('');
    expect(tidy('  A   B  ')).toBe('A B');
    // Placeholder names only.
    expect(personName('Person A (Caller)')).toBe('Person A');
    expect(personName(' Person  A ')).toBe('Person A');
    expect(personName('Person (A) B')).toBe('Person (A) B'); // only a trailing note
    expect(personName('(Caller)')).toBe('(Caller)'); // never empties a name
    expect(personName(undefined)).toBe('');
  });

  it('measures edit distance', () => {
    expect(levenshtein('kitten', 'kitten')).toBe(0);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
  });

  it('flags near-duplicate names for review, but not unrelated ones', () => {
    const pairs = nearDuplicates(['Debra Roberts', 'Debra Robert', 'Sam Lee', 'Samuel Lee', 'Pat Quinn', 'Zoe Adams']);
    const flat = pairs.map((p: string[]) => p.join('|'));
    expect(flat).toContain('Debra Roberts|Debra Robert');
    expect(flat).toContain('Sam Lee|Samuel Lee');
    expect(flat.some((p: string) => p.includes('Pat Quinn'))).toBe(false);
  });
});

describe('makeResolver: role notes', () => {
  it('matches a leader whose name carries a note about their part', () => {
    const resolve = makeResolver({ directory: [], existing: ['Person A'] });
    expect(resolve({ name: 'Person A (Caller)' })).toMatchObject({ name: 'Person A' });
  });
});

describe('makeResolver', () => {
  const resolve = makeResolver({
    directory,
    existing: ['Person A', 'Existing Person'],
    overrides: { 'Typo Name': 'Existing Person' },
  });

  it('prefers a leader id, using the database spelling when one exists', () => {
    expect(resolve({ id: 'person-a' })).toEqual({ name: 'Person A', how: 'id' });
  });

  it('maps an earlier name or a spelling variant to the current record via the private overrides', () => {
    const withOverrides = makeResolver({
      directory,
      existing: [],
      overrides: { 'Old Name': 'Person A', 'Pesron A': 'person  a' },
    });
    expect(withOverrides({ name: 'old name' })).toEqual({ name: 'Person A', how: 'override' });
    expect(withOverrides({ name: 'Pesron A' })).toEqual({ name: 'Person A', how: 'override' }); // target is looked up too
  });

  it('uses an override target as written when no record matches it', () => {
    const bare = makeResolver({ directory: [], existing: [], overrides: { 'Old Name': 'Somebody Else' } });
    expect(bare({ name: 'Old Name' })).toEqual({ name: 'Somebody Else', how: 'override' });
  });

  it('matches by name to a leader or an existing person, ignoring case and punctuation', () => {
    expect(resolve({ name: 'allie cliffe' })).toEqual({ name: 'Allie Cliffe', how: 'leader' });
    expect(resolve({ name: 'EXISTING  person' })).toEqual({ name: 'Existing Person', how: 'existing' });
  });

  it('applies a confirmed override before anything else', () => {
    expect(resolve({ name: 'typo name' })).toEqual({ name: 'Existing Person', how: 'override' });
  });

  it('creates a new person once, and reuses it', () => {
    const a = resolve({ name: 'Brand New' });
    expect(a).toEqual({ name: 'Brand New', how: 'new' });
    expect(resolve({ name: 'brand  new' })).toBe(a);
  });

  it('derives a name from an unknown leader id, and skips empty entries', () => {
    expect(resolve({ id: 'some-person' })).toEqual({ name: 'Some Person', how: 'new-from-id' });
    expect(resolve({})).toBeNull();
  });
});

describe('class roles', () => {
  const resolve = makeResolver({ directory, existing: [] });
  const roles = (cls: object) =>
    classRoles(cls, resolve).map((r: { person: { name: string }; leadership_type: string }) => [
      r.person.name,
      r.leadership_type,
    ]);

  it('reads the leaders array first, then the singular fields', () => {
    expect(classEntries({ leaders: [{ id: 'person-a' }], leaderId: 'x', leader: 'y' })).toEqual([{ id: 'person-a' }]);
    expect(classEntries({ leaderId: 'person-a', leader: 'Someone' })).toEqual([{ id: 'person-a', name: 'Someone' }]);
    expect(classEntries({ leader: 'Someone' })).toEqual([{ id: undefined, name: 'Someone' }]);
    expect(classEntries({})).toEqual([]);
    expect(classEntries({ leaders: [{}, { name: 'A' }] })).toEqual([{ name: 'A' }]);
  });

  it('makes one leader solo and two or more partners', () => {
    expect(roles({ leaders: [{ id: 'person-a' }] })).toEqual([['Person A', 'solo']]);
    expect(roles({ leaders: [{ id: 'person-a' }, { name: 'Pat Two' }] })).toEqual([
      ['Person A', 'partner'],
      ['Pat Two', 'partner'],
    ]);
  });

  it('marks assistants as assisting without making the leader a partner', () => {
    expect(roles({ leaders: [{ id: 'person-a' }, { name: 'Pat Two', role: 'assistant' }] })).toEqual([
      ['Person A', 'solo'],
      ['Pat Two', 'assisting'],
    ]);
  });

  it('keeps the stronger role when someone is listed twice', () => {
    expect(roles({ leaders: [{ id: 'person-a', role: 'assistant' }, { id: 'person-a' }] })).toEqual([
      ['Person A', 'solo'],
    ]);
    expect(roles({ leaders: [{ id: 'person-a' }, { id: 'person-a', role: 'assistant' }] })).toEqual([
      ['Person A', 'solo'],
    ]);
  });

  it('gives a class with no leader no roles', () => {
    expect(roles({ name: 'Orphan class' })).toEqual([]);
  });
});

describe('extraAssistingRoles', () => {
  const r = (person: string, activity: string, leadership_type: string) => ({ person, activity, leadership_type });
  const known = new Set(['childrens program', 'games']);
  const have = new Set(['person a|games']);

  it('keeps an assisting role on a known class that the database lacks', () => {
    expect(extraAssistingRoles([r('Person B', "Children's Program", 'assisting')], have, known)).toHaveLength(1);
  });

  it('skips roles the database already records, whatever the person did there', () => {
    expect(extraAssistingRoles([r('Person A', 'Games', 'assisting')], have, known)).toEqual([]);
  });

  it('skips classes the database does not have, so no new class is invented', () => {
    expect(extraAssistingRoles([r('Person B', 'Brand New Class', 'assisting')], have, known)).toEqual([]);
  });

  it('never overrides a leader’s role, so solo and partner disagreements are left alone', () => {
    expect(
      extraAssistingRoles([r('Person B', 'Games', 'solo'), r('Person C', 'Games', 'partner')], have, known)
    ).toEqual([]);
  });
});

describe('dedupeRoles', () => {
  const role = (person: string, activity: string, event: string, leadership_type: string) => ({
    person,
    activity,
    event,
    leadership_type,
  });

  it('collapses the same person leading the same class twice in one event', () => {
    const out = dedupeRoles([
      role('Person A', "Children's Program", 'e1', 'solo'),
      role('person  a', "children's program", 'e1', 'solo'),
    ]);
    expect(out).toHaveLength(1);
  });

  it('keeps roles that differ by person, class, or event', () => {
    const out = dedupeRoles([
      role('Person A', 'Games', 'e1', 'solo'),
      role('Person B', 'Games', 'e1', 'solo'),
      role('Person A', 'Crafts', 'e1', 'solo'),
      role('Person A', 'Games', 'e2', 'solo'),
    ]);
    expect(out).toHaveLength(4);
  });

  it('keeps the stronger role when two disagree, in either order', () => {
    expect(
      dedupeRoles([role('A', 'Games', 'e1', 'assisting'), role('A', 'Games', 'e1', 'partner')]).map(
        (r) => r.leadership_type
      )
    ).toEqual(['partner']);
    expect(
      dedupeRoles([role('A', 'Games', 'e1', 'partner'), role('A', 'Games', 'e1', 'assisting')]).map(
        (r) => r.leadership_type
      )
    ).toEqual(['partner']);
  });
});

describe('eventType', () => {
  it('uses the length in days', () => {
    expect(eventType('2024-06-07', '2024-06-09')).toBe('weekend');
    expect(eventType('2024-12-27', '2025-01-01')).toBe('extended');
    expect(eventType('2024-03-14', undefined)).toBe('one_day');
    expect(eventType('2024-03-14', '2024-03-14')).toBe('one_day');
    expect(eventType('2024-06-07', '2024-06-08')).toBe('weekend');
  });
});

describe('classifyActivity', () => {
  it.each([
    ['Folk Dancing', 'Dancing'],
    ['Evening Sing', 'Music'],
    ['Informal Dramatics', 'Drama'],
    ['Water Games', 'Games'],
    ['Chair Yoga', 'Movement'],
    ['Crafts', 'Crafts'],
    ['Play Parties', 'Play Parties'],
    ['Leadership Smorgasbord', 'Theory'],
    ['Mindfulness Hour', 'Personal Development'],
    ["Children's Program", 'Other'],
  ])('%s is %s', (name, type) => {
    const out = classifyActivity(name);
    expect(out.type).toBe(type);
    expect(TYPES).toContain(out.type);
  });

  it('puts the more specific kind first, so a waltz is dancing and not a game', () => {
    expect(classifyActivity('Waltz Time is Play Time').type).toBe('Dancing');
  });

  it('reports no rule when nothing matches', () => {
    expect(classifyActivity('Quarterly Zorp')).toEqual({ type: 'Other', subtype: '', rule: null, weak: true });
  });
});

describe('Music and its subtypes', () => {
  it.each([
    ['Evening Sing', 'Singing'],
    ['Beatlesing Plus', 'Singing'],
    ['Songlibs', 'Singing'],
    ['Introduction to the Ukulele', 'Instruments'],
    ['Introduction to the Tin Whistle', 'Instruments'],
    ['African Drumming for Beginners!', 'Rhythm'],
    ['Body Percussion', 'Rhythm'],
    ['Make Music Together', ''],
  ])('%s is Music with subtype "%s"', (name, subtype) => {
    expect(classifyActivity(name)).toMatchObject({ type: 'Music', subtype });
  });

  it('does not mistake a drummer in a title for a drum class', () => {
    expect(classifyActivity('Moving to a Different Drummer').type).toBe('Other');
  });

  it('has Music as a type and no longer Singing', () => {
    expect(TYPES).toContain('Music');
    expect(TYPES).not.toContain('Singing');
  });

  it('turns an old Singing type into Music with the subtype Singing, and keeps any subtype', () => {
    expect(normalizeType('Singing')).toEqual({ type: 'Music', subtype: 'Singing' });
    expect(normalizeType('Singing', 'Rounds')).toEqual({ type: 'Music', subtype: 'Rounds' });
    expect(normalizeType('Games', 'Active')).toEqual({ type: 'Games', subtype: 'Active' });
    expect(normalizeType('Drama')).toEqual({ type: 'Drama', subtype: '' });
  });
});

describe('refreshProposal', () => {
  const music = { type: 'Music', subtype: 'Rhythm', rule: 'drumming' };

  it('refreshes an unconfirmed Other proposal when a rule now matches', () => {
    expect(refreshProposal({ type: 'Other', basis: 'proposed: review' }, music)).toEqual({
      type: 'Music',
      subtype: 'Rhythm',
      basis: 'proposed: rule drumming',
    });
  });

  it('never touches a row a person has set', () => {
    expect(refreshProposal({ type: 'Other', basis: 'you' }, music)).toBeNull();
    expect(refreshProposal({ type: 'Other', basis: '' }, music)).toBeNull();
  });

  it('leaves proposals alone unless they are Other and the rules have a real match', () => {
    expect(refreshProposal({ type: 'Crafts', basis: 'proposed: review' }, music)).toBeNull();
    expect(refreshProposal({ type: 'Other', basis: 'proposed: review' }, { type: 'Other', rule: null })).toBeNull();
    expect(
      refreshProposal({ type: 'Other', basis: 'proposed: review' }, { type: 'Music', subtype: '', rule: null })
    ).toBeNull();
    expect(refreshProposal(undefined, music)).toBeNull();
  });
});

describe('defaultStatus', () => {
  it('leaves anyone who led in 2018 or later for a person to decide', () => {
    expect(defaultStatus({ events: 3, lastYear: 2018 })).toBeNull();
    expect(defaultStatus({ events: 1, lastYear: 2026 })).toBeNull();
  });

  it('proposes inactive for led-once-long-ago, and hiatus for repeat leaders', () => {
    expect(defaultStatus({ events: 1, lastYear: 2012 })).toEqual({
      status: 'inactive',
      basis: 'led once, not since 2012',
    });
    expect(defaultStatus({ events: 4, lastYear: 2017 })).toEqual({
      status: 'hiatus',
      basis: 'led 4 times, last in 2017',
    });
  });
});

describe('csv and sql helpers', () => {
  it('quotes csv fields only when needed', () => {
    expect(csv('plain')).toBe('plain');
    expect(csv('a,b')).toBe('"a,b"');
    expect(csv('say "hi"')).toBe('"say ""hi"""');
    expect(csv(null)).toBe('');
    expect(csv(7)).toBe('7');
  });

  it('round-trips csv, including quotes, commas, newlines, and CRLF', () => {
    const rows = [
      ['name', 'note'],
      ['A, B', 'said "hi"'],
      ['C', 'line one\nline two'],
    ];
    expect(parseCsv(rows.map((r) => r.map(csv).join(',')).join('\n') + '\n')).toEqual(rows);
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseCsv('x,y')).toEqual([['x', 'y']]);
    expect(parseCsv('')).toEqual([]);
  });

  it('escapes sql strings and writes NULL for empty values', () => {
    expect(sql("O'Brien")).toBe("'O''Brien'");
    expect(sql('')).toBe('NULL');
    expect(sql(null)).toBe('NULL');
  });

  it('reads the ways a person writes yes', () => {
    expect(['yes', 'Y', 'true', '1', 'x', ' YES '].every(isYes)).toBe(true);
    expect(['', 'no', 'n', undefined].some(isYes)).toBe(false);
  });
});
