// Pure data logic for the leadership tracker: no React, no fetch. The dashboard
// shows raw experience (counts by activity type, scope, and role); it never
// computes a "ready" score. Readiness is a human judgment recorded as notes.

export type LeadershipType = 'solo' | 'partner' | 'assisting';
export type Scope = 'class' | 'activity';
// Whether someone is available to LEAD. Mentoring is a separate yes/no on Person.
export type Status = 'active' | 'hiatus' | 'inactive';

export const LEADERSHIP_TYPES: LeadershipType[] = ['solo', 'partner', 'assisting'];
export const EVENT_TYPES: EventType[] = ['extended', 'weekend', 'one_day'];
export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  extended: 'Extended',
  weekend: 'Weekend',
  one_day: 'One day',
};
export const STATUSES: Status[] = ['active', 'hiatus', 'inactive'];
export const STATUS_LABELS: Record<Status, string> = {
  active: 'Active',
  hiatus: 'On hiatus',
  inactive: 'Inactive',
};

export interface Person {
  id: number;
  name: string;
  email: string | null;
  leader_slug: string | null;
  status: Status;
  /** 1 when available as a mentor (D1 stores yes/no as 1/0). */
  mentor: number;
  notes: string | null;
}
export interface Activity {
  id: number;
  name: string;
  scope: Scope;
  type: string;
  subtype: string | null;
  /** Link to the public /activities page. The editor passes it back unchanged. */
  site_activity_id?: string | null;
}
export type EventType = 'extended' | 'weekend' | 'one_day';
export interface EventRow {
  id: number;
  name: string;
  event_type: string;
  year: number;
  /** Link to the public event page. The editor passes it back unchanged. */
  site_event_id?: string | null;
  /** When and where it happened, when known (ISO date; venue slug). */
  start_date?: string | null;
  end_date?: string | null;
  site_id?: string | null;
}
export interface Role {
  id: number;
  person_id: number;
  activity_id: number;
  event_id: number;
  leadership_type: LeadershipType;
  how_it_went: string | null;
  /** Where the role came from. The editor passes it back unchanged. */
  source?: string;
}
export interface Note {
  id: number;
  person_id: number;
  kind: 'note' | 'ready';
  focus: string | null;
  body: string;
  author: string;
  created_at: string;
}
export interface Service {
  id: number;
  person_id: number;
  body: string;
  title: string | null;
  started_on: string | null;
  ended_on: string | null;
  note: string | null;
  source?: string | null;
}
export interface Volunteer {
  id: number;
  person_id: number;
  event_id: number | null;
  task: string;
  hours: number | null;
  note: string | null;
}

export interface Outreach {
  id: number;
  person_id: number;
  goal: string;
  status: string;
  contacted_on: string | null;
  snooze_until: string | null;
  note: string | null;
  /** For a staffing ask: the event and the slot (for example "Games class"). */
  event_id?: number | null;
  slot?: string | null;
}

export type AccessLevel = 'finance' | 'standard';
export interface AppUser {
  email: string;
  level: AccessLevel;
  is_admin: number;
  /** An owner: the database refuses to remove or downgrade them. */
  protected?: number;
}

/** Where someone lives, to about a kilometer: city, state, and a rounded point. No street, no postal code. */
export interface PersonLocation {
  person_id: number;
  city: string | null;
  state: string | null;
  lat: number;
  lng: number;
}

/** A venue added in the tool. The site's own venues come from the content. */
export interface VenueRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  lat: number;
  lng: number;
}
/** Someone the team knows is an expert in a type, set by hand. */
export interface Expertise {
  id: number;
  person_id: number;
  type: string;
  note: string | null;
}

export interface Data {
  me?: string;
  /** What the signed-in person may see: finance sees donation amounts. */
  level?: AccessLevel;
  isAdmin?: boolean;
  people: Person[];
  activities: Activity[];
  events: EventRow[];
  roles: Role[];
  notes: Note[];
  /** Board and committee service, and who helped at events. Neither is money. */
  service?: Service[];
  volunteers?: Volunteer[];
  outreach?: Outreach[];
  locations?: PersonLocation[];
  venues?: VenueRow[];
  expertise?: Expertise[];
  activityTypes: string[];
}

export type Counts = Record<LeadershipType, number>;
export interface Cell {
  class: Counts;
  activity: Counts;
  total: number;
}
export interface PersonRow {
  person: Person;
  cells: Map<string, Cell>;
  total: number;
  lastYear: number | null;
  latestReady: Note | null;
}

const emptyCounts = (): Counts => ({ solo: 0, partner: 0, assisting: 0 });
const emptyCell = (): Cell => ({ class: emptyCounts(), activity: emptyCounts(), total: 0 });

/** One row per person: counts of roles by activity type, split by scope and role. */
export function buildRows(data: Data): PersonRow[] {
  const activities = new Map(data.activities.map((a) => [a.id, a]));
  const years = new Map(data.events.map((e) => [e.id, e.year]));

  const rows = new Map<number, PersonRow>(
    data.people.map((person) => [person.id, { person, cells: new Map(), total: 0, lastYear: null, latestReady: null }])
  );

  for (const role of data.roles) {
    const row = rows.get(role.person_id);
    const activity = activities.get(role.activity_id);
    if (!row || !activity) continue;
    const cell = row.cells.get(activity.type) ?? emptyCell();
    cell[activity.scope][role.leadership_type] += 1;
    cell.total += 1;
    row.cells.set(activity.type, cell);
    row.total += 1;
    const year = years.get(role.event_id);
    if (year !== undefined && (row.lastYear === null || year > row.lastYear)) row.lastYear = year;
  }

  for (const note of data.notes) {
    if (note.kind !== 'ready') continue;
    const row = rows.get(note.person_id);
    if (row && (!row.latestReady || note.created_at > row.latestReady.created_at)) row.latestReady = note;
  }

  return [...rows.values()];
}

export const ROLE_LABELS: Record<LeadershipType, string> = { solo: 'Solo', partner: 'Partner', assisting: 'Assisting' };

/** "2 solo, 1 assisting", omitting zeros. Used for screen readers and tooltips. */
export function describeCounts(counts: Counts): string {
  return LEADERSHIP_TYPES.filter((t) => counts[t] > 0)
    .map((t) => `${counts[t]} ${ROLE_LABELS[t].toLowerCase()}`)
    .join(', ');
}

/** 0 (none) to 3 (a lot): shading only, not a readiness score. */
export function intensity(total: number): 0 | 1 | 2 | 3 {
  if (total <= 0) return 0;
  if (total === 1) return 1;
  if (total <= 3) return 2;
  return 3;
}

/** Which roles count: classes and activities together, or one of them. */
export type ScopeFilter = 'all' | Scope;

/** A cell's counts for the chosen scope, with their total. */
export function scopedCounts(cell: Cell | undefined, scope: ScopeFilter): { counts: Counts; total: number } {
  if (!cell) return { counts: emptyCounts(), total: 0 };
  const counts =
    scope === 'all'
      ? {
          solo: cell.class.solo + cell.activity.solo,
          partner: cell.class.partner + cell.activity.partner,
          assisting: cell.class.assisting + cell.activity.assisting,
        }
      : cell[scope];
  return { counts, total: counts.solo + counts.partner + counts.assisting };
}

export type SortKey = 'name' | 'total' | 'recent' | `type:${string}`;
export interface Filters {
  query: string;
  /** Leading statuses to show. Inactive people are hidden until asked for. */
  statuses: Status[];
  mentorsOnly: boolean;
  scope: ScopeFilter;
}
export const DEFAULT_FILTERS: Filters = { query: '', statuses: ['active', 'hiatus'], mentorsOnly: false, scope: 'all' };

export function filterRows(rows: PersonRow[], { query, statuses, mentorsOnly }: Filters): PersonRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter(
    (r) =>
      statuses.includes(r.person.status) &&
      (!mentorsOnly || r.person.mentor === 1) &&
      (!q || r.person.name.toLowerCase().includes(q))
  );
}

/** How many people have each leading status, and how many mentor. */
export function statusCounts(rows: PersonRow[]): Record<Status | 'mentor', number> {
  const counts = { active: 0, hiatus: 0, inactive: 0, mentor: 0 };
  for (const { person } of rows) {
    counts[person.status] += 1;
    if (person.mentor === 1) counts.mentor += 1;
  }
  return counts;
}

export function sortRows(
  rows: PersonRow[],
  key: SortKey,
  descending: boolean,
  scope: ScopeFilter = 'all'
): PersonRow[] {
  const byName = (a: PersonRow, b: PersonRow) => a.person.name.localeCompare(b.person.name);
  const value = (r: PersonRow): number => {
    if (key === 'total') return scope === 'all' ? r.total : totalIn(r, scope);
    if (key === 'recent') return r.lastYear ?? -1;
    return scopedCounts(r.cells.get(key.slice(5)), scope).total; // "type:<name>"
  };
  const sign = descending ? -1 : 1;
  if (key === 'name') return [...rows].sort((a, b) => byName(a, b) * sign);
  return [...rows].sort((a, b) => (value(a) - value(b)) * sign || byName(a, b));
}

/** A person's roles in one scope, across every activity type. */
export function totalIn(row: PersonRow, scope: Scope): number {
  let total = 0;
  for (const cell of row.cells.values()) total += scopedCounts(cell, scope).total;
  return total;
}

export interface RoleLine {
  role: Role;
  activity: Activity;
  event: EventRow | undefined;
}

/** A person's roles, newest event first, then by activity name. */
export function roleHistory(data: Data, personId: number): RoleLine[] {
  const activities = new Map(data.activities.map((a) => [a.id, a]));
  const events = new Map(data.events.map((e) => [e.id, e]));
  const lines: RoleLine[] = [];
  for (const role of data.roles) {
    if (role.person_id !== personId) continue;
    const activity = activities.get(role.activity_id);
    if (activity) lines.push({ role, activity, event: events.get(role.event_id) });
  }
  // Same-year events stay apart (by name, then id) so the history can group by event.
  return lines.sort(
    (a, b) =>
      (b.event?.year ?? 0) - (a.event?.year ?? 0) ||
      (a.event?.name ?? '').localeCompare(b.event?.name ?? '') ||
      (a.event?.id ?? 0) - (b.event?.id ?? 0) ||
      a.activity.name.localeCompare(b.activity.name)
  );
}

export interface EventGroup {
  event: EventRow | undefined;
  lines: RoleLine[];
}

/** Role history grouped by event, keeping roleHistory's order (newest first). */
export function groupByEvent(lines: RoleLine[]): EventGroup[] {
  const groups: EventGroup[] = [];
  for (const line of lines) {
    const last = groups[groups.length - 1];
    if (last && last.event?.id === line.event?.id) last.lines.push(line);
    else groups.push({ event: line.event, lines: [line] });
  }
  return groups;
}

export interface TypeSummary {
  type: string;
  counts: Counts;
  total: number;
}

/** A person's roles per activity type, busiest type first. */
export function summarizeByType(lines: RoleLine[]): TypeSummary[] {
  const byType = new Map<string, TypeSummary>();
  for (const { role, activity } of lines) {
    const entry = byType.get(activity.type) ?? { type: activity.type, counts: emptyCounts(), total: 0 };
    entry.counts[role.leadership_type] += 1;
    entry.total += 1;
    byType.set(activity.type, entry);
  }
  return [...byType.values()].sort((a, b) => b.total - a.total || a.type.localeCompare(b.type));
}

/** An event's name without its year, which the history already shows beside it. */
export function eventLabel(event: EventRow): string {
  const trimmed = event.name
    .replace(new RegExp(`\\b${event.year}\\b`, 'g'), '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return trimmed || event.name;
}

/** Events newest first, then by name. */
export function sortedEvents(events: EventRow[]): EventRow[] {
  return [...events].sort((a, b) => b.year - a.year || a.name.localeCompare(b.name) || a.id - b.id);
}

/** Events for the "For event" picker: upcoming ones first (soonest first), then past ones, newest first. */
export function pickerEvents(events: EventRow[], today: string): EventRow[] {
  const upcoming = events.filter((e) => e.start_date && e.start_date >= today);
  const rest = events.filter((e) => !(e.start_date && e.start_date >= today));
  upcoming.sort((a, b) => a.start_date!.localeCompare(b.start_date!) || a.id - b.id);
  return [...upcoming, ...sortedEvents(rest)];
}

/** "2026-10-17 Fall Fun Day", or the year when the date is not known. */
export const pickerLabel = (event: EventRow): string => `${event.start_date ?? event.year} ${eventLabel(event)}`;

/** "2025 Winter Adventure": the year first, so same-named events stay apart. */
export const eventTitle = (event: EventRow): string => `${event.year} ${eventLabel(event)}`;

export interface ActivityGroup {
  type: string;
  activities: Activity[];
}

/** Activities by type (A to Z), each type's activities by name. Types with none are left out. */
export function groupActivities(activities: Activity[]): ActivityGroup[] {
  const byType = new Map<string, Activity[]>();
  for (const a of activities) byType.set(a.type, [...(byType.get(a.type) ?? []), a]);
  return [...byType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, list]) => ({ type, activities: list.sort((a, b) => a.name.localeCompare(b.name)) }));
}

export type View = 'people' | 'lists' | 'events' | 'activities' | 'journey' | 'staff' | 'duplicates' | 'users';

export interface TimelineItem {
  type: 'role' | 'registration' | 'volunteer' | 'service' | 'membership' | 'outreach' | 'note' | 'gift';
  id: number;
  /** A year, a month, or a date; sorted newest first by the server. */
  at: string;
  title: string;
  detail?: string | null;
  /** The event, for roles, registrations, and volunteering. */
  event?: string | null;
  leadership_type?: LeadershipType;
  note?: string | null;
  body?: string;
  author?: string;
  attended?: number | null;
  hours?: number | null;
  started_on?: string | null;
  ended_on?: string | null;
  ends_on?: string | null;
  snooze_until?: string | null;
  /** Only present for the finance level. */
  amount_cents?: number;
  recurring?: number;
}
export interface Timeline {
  person: { id: number; name: string };
  /** Finance sees a total. Everyone else sees only a tier. */
  giving: { tier?: string | null; total_cents?: number };
  items: TimelineItem[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2024" stays "2024", "2024-06" becomes "Jun 2024", "2024-06-30" becomes "Jun 30, 2024". */
export function formatPartialDate(value: string): string {
  const [y, mo, d] = value.split('-');
  if (!mo) return y;
  const month = MONTHS[Number(mo) - 1] ?? mo;
  return d ? `${month} ${Number(d)}, ${y}` : `${month} ${y}`;
}

/** A term in words: "Jan 2024 to Dec 2027", "since Jan 2023", "until Dec 2021", "2025", or "current". */
export function formatTerm(started: string | null, ended: string | null): string {
  if (started && ended)
    return started === ended
      ? formatPartialDate(started)
      : `${formatPartialDate(started)} to ${formatPartialDate(ended)}`;
  if (started) return `since ${formatPartialDate(started)}`;
  if (ended) return `until ${formatPartialDate(ended)}`;
  return 'current';
}

/** Timeline items grouped by year, in the order given. Items with no date go last. */
export function groupByYear(items: TimelineItem[]): { year: string; items: TimelineItem[] }[] {
  const groups: { year: string; items: TimelineItem[] }[] = [];
  for (const item of items) {
    const year = item.at ? item.at.slice(0, 4) : 'Undated';
    const last = groups[groups.length - 1];
    if (last && last.year === year) last.items.push(item);
    else groups.push({ year, items: [item] });
  }
  return groups;
}

/** Dollars from cents, for the finance level. */
export const dollars = (cents: number): string =>
  (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 ? 2 : 0,
  });

export const OUTREACH_GOAL_LABELS: Record<string, string> = {
  invite_back: 'Invite back',
  invite_lead: 'Invite to lead',
  invite_committee: 'Invite to a committee',
  invite_board: 'Invite to the board',
  thank_donor: 'Thank for a gift',
};
export const OUTREACH_STATUS_LABELS: Record<string, string> = {
  suggested: 'Suggested',
  contacted: 'Contacted',
  accepted: 'Accepted',
  declined: 'Declined',
  snoozed: 'Snoozed',
  do_not_contact: 'Do not contact',
};

const ROLE_VERBS: Record<LeadershipType, string> = { solo: 'Led', partner: 'Co-led', assisting: 'Assisted' };

/** One timeline entry in words: a short label, the main text, and a quieter second line. */
export function describeItem(item: TimelineItem): { label: string; text: string; sub: string } {
  const join = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(', ');
  switch (item.type) {
    case 'role':
      return { label: ROLE_VERBS[item.leadership_type ?? 'solo'], text: item.title, sub: item.event ?? '' };
    case 'registration': {
      const label = item.attended === 1 ? 'Attended' : item.attended === 0 ? 'Did not attend' : 'Registered';
      return { label, text: item.title, sub: item.detail === 'cancelled' ? 'Cancelled' : '' };
    }
    case 'volunteer':
      return { label: 'Helped', text: item.title, sub: join(item.event, item.hours != null && `${item.hours} hours`) };
    case 'service':
      return {
        label: 'Served',
        text: join(item.detail, item.title),
        sub: formatTerm(item.started_on ?? null, item.ended_on ?? null),
      };
    case 'membership':
      return { label: 'Member', text: item.title, sub: item.ends_on ? `until ${formatPartialDate(item.ends_on)}` : '' };
    case 'outreach':
      return {
        label: 'Outreach',
        text: OUTREACH_GOAL_LABELS[item.title] ?? item.title,
        sub: join(OUTREACH_STATUS_LABELS[item.detail ?? ''] ?? item.detail, item.note),
      };
    case 'note':
      return {
        label: item.title === 'ready' ? 'Ready for' : 'Note',
        text: join(item.detail, item.body),
        sub: item.author ?? '',
      };
    case 'gift':
      return {
        label: 'Gift',
        text: item.amount_cents != null ? join(dollars(item.amount_cents), item.title) : '',
        sub: item.recurring ? 'Recurring' : '',
      };
  }
}

/** One person's engagement facts, as the server sends them. Money appears only for the finance level. */
export interface EngagementRow {
  person_id: number;
  name: string;
  status: Status;
  mentor: number;
  events_registered: number;
  events_attended: number;
  last_event_year: number | null;
  roles_led: number;
  roles_total: number;
  last_led_year: number | null;
  volunteer_count: number;
  member_now: number;
  serving_now: number;
  gift_count: number;
  giving_tier: string | null;
  giving_tier_rank?: number;
  last_contacted_on: string | null;
  do_not_contact: number;
  /** With a target event: events they registered for near that time of year, and at that venue. */
  similar_time_events?: number;
  similar_venue_events?: number;
  total_cents?: number;
}
export interface EngagementPage {
  people: EngagementRow[];
  total: number;
  limit: number;
  offset: number;
}

export type ListId = 'back' | 'lead' | 'committee' | 'donors' | 'firstgift' | 'lapsed';
export type ListControl = { key: string; label: string } & (
  { kind: 'number'; min: number; max: number } | { kind: 'toggle' }
);
export interface ListDef {
  id: ListId;
  label: string;
  /** What "Mark contacted" records this as. */
  goal: string;
  blurb: string;
  controls: ListControl[];
  defaults: Record<string, number | boolean>;
  empty: string;
}

export const LISTS: ListDef[] = [
  {
    id: 'back',
    label: 'Invite back',
    goal: 'invite_back',
    blurb: 'Came to several events, but not lately.',
    controls: [
      { key: 'minEvents', label: 'Registered for at least', kind: 'number', min: 1, max: 50 },
      { key: 'quietYears', label: 'None in the last (years)', kind: 'number', min: 1, max: 20 },
    ],
    defaults: { minEvents: 2, quietYears: 2 },
    empty: 'No one matches. Try fewer events, or a shorter time away.',
  },
  {
    id: 'lead',
    label: 'Invite to lead',
    goal: 'invite_lead',
    blurb: 'Regulars who have never led a class or activity.',
    controls: [
      { key: 'minEvents', label: 'Registered for at least', kind: 'number', min: 1, max: 50 },
      { key: 'recentYears', label: 'Came within the last (years)', kind: 'number', min: 1, max: 20 },
      { key: 'readyOnly', label: 'Only people with a “ready for” note', kind: 'toggle' },
    ],
    defaults: { minEvents: 3, recentYears: 3, readyOnly: false },
    empty: 'No one matches. Try fewer events, or a longer window.',
  },
  {
    id: 'committee',
    label: 'Committee and board',
    goal: 'invite_committee',
    blurb: 'Long-time regulars who are not serving now.',
    controls: [
      { key: 'minEvents', label: 'Registered for at least', kind: 'number', min: 1, max: 50 },
      { key: 'recentYears', label: 'Came within the last (years)', kind: 'number', min: 1, max: 20 },
      { key: 'mustHaveLed', label: 'Has led before', kind: 'toggle' },
      { key: 'membersOnly', label: 'Members only', kind: 'toggle' },
    ],
    defaults: { minEvents: 4, recentYears: 3, mustHaveLed: true, membersOnly: false },
    empty: 'No one matches. Try fewer events, or turn off “Has led before”.',
  },
  {
    id: 'donors',
    label: 'Thank donors',
    goal: 'thank_donor',
    blurb: 'People who have given, so they can be thanked.',
    controls: [],
    defaults: {},
    empty: 'No gifts are recorded yet.',
  },
  {
    id: 'firstgift',
    label: 'First-time donors',
    goal: 'thank_donor',
    blurb: 'Gave once, recently. A good moment for a personal thank-you.',
    controls: [{ key: 'recentYears', label: 'Gave within the last (years)', kind: 'number', min: 1, max: 20 }],
    defaults: { recentYears: 1 },
    empty: 'No first-time donors in that window.',
  },
  {
    id: 'lapsed',
    label: 'Lapsed donors',
    goal: 'thank_donor',
    blurb: 'Gave before, but not lately.',
    controls: [{ key: 'quietYears', label: 'No gift in the last (years)', kind: 'number', min: 1, max: 20 }],
    defaults: { quietYears: 2 },
    empty: 'No one has gone quiet for that long.',
  },
];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** The server query for a list, with its criteria filled in. Nobody contacted lately or snoozed or opted out is left out. */
export function listQuery(list: ListDef, values: Record<string, number | boolean>, today: Date, offset = 0): string {
  const year = today.getFullYear();
  const v = { ...list.defaults, ...values };
  const q = new URLSearchParams({
    exclude_do_not_contact: '1',
    exclude_snoozed: '1',
    limit: '25',
    offset: String(offset),
  });
  const waited = new Date(today);
  waited.setDate(waited.getDate() - 180);
  if (!['donors', 'firstgift', 'lapsed'].includes(list.id)) q.set('not_contacted_since', isoDay(waited));
  if (list.id === 'back') {
    q.set('min_events', String(v.minEvents));
    q.set('max_last_event_year', String(year - Number(v.quietYears)));
    q.set('sort', 'events_registered');
    q.set('dir', 'desc');
  } else if (list.id === 'lead') {
    q.set('min_events', String(v.minEvents));
    q.set('max_roles_led', '0');
    q.set('min_last_event_year', String(year - Number(v.recentYears)));
    if (v.readyOnly) q.set('has_ready', '1');
    q.set('sort', 'events_registered');
    q.set('dir', 'desc');
  } else if (list.id === 'committee') {
    q.set('min_events', String(v.minEvents));
    q.set('serving', '0');
    q.set('min_last_event_year', String(year - Number(v.recentYears)));
    if (v.mustHaveLed) q.set('min_roles_led', '1');
    if (v.membersOnly) q.set('member', '1');
    q.set('sort', 'events_registered');
    q.set('dir', 'desc');
  } else if (list.id === 'firstgift') {
    q.set('min_gift_count', '1');
    q.set('max_gift_count', '1');
    q.set('min_last_gift_year', String(year - Number(v.recentYears)));
    q.set('sort', 'name');
  } else if (list.id === 'lapsed') {
    q.set('min_gift_count', '1');
    q.set('max_last_gift_year', String(year - Number(v.quietYears)));
    q.set('sort', 'giving_tier');
    q.set('dir', 'desc');
  } else {
    q.set('min_tier', '1');
    q.set('sort', 'giving_tier');
    q.set('dir', 'desc');
  }
  const target = Number(v.targetEvent);
  if (target > 0 && ['back', 'lead'].includes(list.id)) {
    q.set('target_event', String(target));
    q.set('similar', (['either', 'time', 'venue'] as const)[Number(v.similar) || 0]);
    if (v.similarOnly) q.set('similar_only', '1');
  }
  return q.toString();
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The plain facts behind a person being on a list, in the order they matter. */
export function factsFor(row: EngagementRow): string[] {
  const facts: string[] = [];
  if (row.events_registered > 0) {
    facts.push(
      `Registered for ${plural(row.events_registered, 'event', 'events')}${row.last_event_year ? `, last in ${row.last_event_year}` : ''}`
    );
  }
  if (row.events_attended > 0) facts.push(`Attended ${row.events_attended}`);
  facts.push(
    row.roles_led > 0 ? `Led ${row.roles_led}${row.last_led_year ? `, last in ${row.last_led_year}` : ''}` : 'Never led'
  );
  if (row.volunteer_count > 0) facts.push(`Helped ${plural(row.volunteer_count, 'time', 'times')}`);
  if (row.member_now) facts.push('Member');
  if (row.serving_now > 0) facts.push('Serving now');
  if (row.gift_count > 0) {
    const tier = row.giving_tier ?? '';
    facts.push(row.total_cents !== undefined ? `Giving: ${tier} (${dollars(row.total_cents)})` : `Giving: ${tier}`);
  }
  const [near, here] = [row.similar_time_events ?? 0, row.similar_venue_events ?? 0];
  if (near > 0 || here > 0) {
    facts.push(
      `Came to ${[
        near > 0 && `${plural(near, 'event', 'events')} near this time of year`,
        here > 0 && `${plural(here, 'event', 'events')} at this venue`,
      ]
        .filter(Boolean)
        .join(', ')}`
    );
  }
  if (row.last_contacted_on) facts.push(`Last contacted ${formatPartialDate(row.last_contacted_on)}`);
  return facts;
}

// ---------------------------------------------------------------------------
// The optional score. Off by default. Every point comes from a visible weight and the
// breakdown is shown beside the number, so it explains a ranking and never hides anyone.
// Giving counts by tier, never by amount, so it is safe at every access level.

export const SCORE_FIELDS = [
  { key: 'registered', label: 'Per event registered' },
  { key: 'attended', label: 'Per event attended' },
  { key: 'led', label: 'Per class or activity led' },
  { key: 'volunteer', label: 'Per time helped' },
  { key: 'member', label: 'Current member' },
  { key: 'tier', label: 'Per giving tier' },
  { key: 'recent', label: 'Came in the last two years' },
  { key: 'similarTime', label: 'Per event near this time of year (up to 3)' },
  { key: 'similarVenue', label: 'Per event at this venue (up to 3)' },
] as const;
export type ScoreKey = (typeof SCORE_FIELDS)[number]['key'];
export type ScoreWeights = Record<ScoreKey, number>;
export const DEFAULT_WEIGHTS: ScoreWeights = {
  registered: 1,
  attended: 1,
  led: 3,
  volunteer: 2,
  member: 3,
  tier: 2,
  recent: 3,
  similarTime: 2,
  similarVenue: 2,
};

export function scoreFor(row: EngagementRow, w: ScoreWeights, year: number) {
  const parts: { label: string; points: number }[] = [
    { label: `${row.events_registered} registered`, points: row.events_registered * w.registered },
    { label: `${row.events_attended} attended`, points: row.events_attended * w.attended },
    { label: `${row.roles_led} led`, points: row.roles_led * w.led },
    { label: `${row.volunteer_count} helped`, points: row.volunteer_count * w.volunteer },
    { label: 'member', points: row.member_now ? w.member : 0 },
    { label: 'giving', points: (row.giving_tier_rank ?? 0) * w.tier },
    { label: 'recent', points: row.last_event_year && row.last_event_year >= year - 2 ? w.recent : 0 },
    { label: 'near this time', points: Math.min(row.similar_time_events ?? 0, 3) * w.similarTime },
    { label: 'at this venue', points: Math.min(row.similar_venue_events ?? 0, 3) * w.similarVenue },
  ].filter((p) => p.points !== 0);
  return { total: parts.reduce((n, p) => n + p.points, 0), parts };
}

// ---------------------------------------------------------------------------
// The engagement journey: a stage derived from records, and a hand-set plan.

export type JourneyStage = 'supporter' | 'attendee' | 'volunteer' | 'activity' | 'class';
/** The pipeline, in order. Serving on a committee or the board is a separate lane. */
export const JOURNEY_STAGES: { id: JourneyStage; label: string }[] = [
  { id: 'supporter', label: 'Supporter' },
  { id: 'attendee', label: 'Attendee' },
  { id: 'volunteer', label: 'Volunteer' },
  { id: 'activity', label: 'Leads an activity' },
  { id: 'class', label: 'Leads a class' },
];
export type JourneyTarget = 'activity' | 'class' | 'committee' | 'board';
export const TARGET_LABELS: Record<JourneyTarget, string> = {
  activity: 'Lead an activity',
  class: 'Lead a class',
  committee: 'Join a committee',
  board: 'Join the board',
};

export interface JourneyRow {
  person_id: number;
  name: string;
  status: Status;
  mentor: number;
  stage: JourneyStage | null;
  first_attended_year: number | null;
  first_volunteer_year: number | null;
  first_activity_year: number | null;
  first_class_year: number | null;
  first_service_year: number | null;
  activities_led: number;
  classes_led: number;
  volunteer_count: number;
  events_registered: number;
  service_terms: number;
  serving_now: number;
  on_board_now: number;
  last_active_year: number | null;
  do_not_contact: number;
  target: JourneyTarget | null;
  next_step: string | null;
  due_on: string | null;
  owner: string | null;
}
export interface JourneyFunnel {
  supporter: number;
  attendee: number;
  volunteer: number;
  activity: number;
  class: number;
  serving_now: number;
  served_ever: number;
  attendee_new: number;
  volunteer_new: number;
  activity_new: number;
  class_new: number;
  serving_new: number;
}
export interface JourneyColumn {
  people: JourneyRow[];
  total: number;
  limit: number;
  offset: number;
}
export interface JourneyBoard {
  funnel: JourneyFunnel;
  year: number | null;
  thisYear: number;
  columns: Record<JourneyStage | 'serving', JourneyColumn>;
}

/** The year a person first reached each step, for the strip. Supporter has no year. */
export const STEP_YEARS: {
  id: 'attendee' | 'volunteer' | 'activity' | 'class';
  label: string;
  key: keyof JourneyRow;
}[] = [
  { id: 'attendee', label: 'Attended', key: 'first_attended_year' },
  { id: 'volunteer', label: 'Volunteered', key: 'first_volunteer_year' },
  { id: 'activity', label: 'Led an activity', key: 'first_activity_year' },
  { id: 'class', label: 'Led a class', key: 'first_class_year' },
];

export const isOverdue = (due: string | null, today: string): boolean => due !== null && due < today;

/** What a person has done, in words, for the card in their column. */
export function journeyEvidence(row: JourneyRow): string {
  const bits: string[] = [];
  if (row.events_registered > 0) bits.push(`Registered for ${plural(row.events_registered, 'event', 'events')}`);
  if (row.volunteer_count > 0) bits.push(`Helped ${plural(row.volunteer_count, 'time', 'times')}`);
  if (row.activities_led > 0) bits.push(`Led ${plural(row.activities_led, 'activity', 'activities')}`);
  if (row.classes_led > 0) bits.push(`Led ${plural(row.classes_led, 'class', 'classes')}`);
  if (row.serving_now > 0) bits.push(row.on_board_now ? 'On the board' : 'On a committee');
  if (!bits.length) bits.push('Member or donor, no events yet');
  return bits.join(' · ');
}

/** The five parts of a staffing fit, as they are named on screen. */
export const SEGMENT_NAMES = {
  experience: 'Experience',
  readiness: 'Ready',
  availability: 'Available',
  nearness: 'Near',
  timing: 'Timing',
} as const;
