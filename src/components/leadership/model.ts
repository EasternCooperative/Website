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
export interface Data {
  me?: string;
  people: Person[];
  activities: Activity[];
  events: EventRow[];
  roles: Role[];
  notes: Note[];
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

export type View = 'people' | 'events' | 'activities';
