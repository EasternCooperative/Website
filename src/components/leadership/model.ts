// Pure data logic for the leadership tracker: no React, no fetch. The dashboard
// shows raw experience (counts by activity type, scope, and role); it never
// computes a "ready" score. Readiness is a human judgment recorded as notes.

export type LeadershipType = 'solo' | 'partner' | 'assisting';
export type Scope = 'class' | 'activity';
export type Status = 'active' | 'hiatus' | 'do_not_ask' | 'mentor';

export const LEADERSHIP_TYPES: LeadershipType[] = ['solo', 'partner', 'assisting'];
export const STATUSES: Status[] = ['active', 'mentor', 'hiatus', 'do_not_ask'];
export const STATUS_LABELS: Record<Status, string> = {
  active: 'Active',
  mentor: 'Mentor',
  hiatus: 'On hiatus',
  do_not_ask: 'Do not ask',
};

export interface Person {
  id: number;
  name: string;
  email: string | null;
  leader_slug: string | null;
  status: Status;
  notes: string | null;
}
export interface Activity {
  id: number;
  name: string;
  scope: Scope;
  type: string;
  subtype: string | null;
}
export interface EventRow {
  id: number;
  name: string;
  event_type: string;
  year: number;
}
export interface Role {
  id: number;
  person_id: number;
  activity_id: number;
  event_id: number;
  leadership_type: LeadershipType;
  how_it_went: string | null;
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

const LETTER: Record<LeadershipType, string> = { solo: 'S', partner: 'P', assisting: 'A' };

/** "S2 P1" style summary, omitting zeros. Empty string when there is nothing. */
export function formatCounts(counts: Counts): string {
  return LEADERSHIP_TYPES.filter((t) => counts[t] > 0)
    .map((t) => `${LETTER[t]}${counts[t]}`)
    .join(' ');
}

/** 0 (none) to 3 (a lot): shading only, not a readiness score. */
export function intensity(total: number): 0 | 1 | 2 | 3 {
  if (total <= 0) return 0;
  if (total === 1) return 1;
  if (total <= 3) return 2;
  return 3;
}

export type SortKey = 'name' | 'total' | 'recent' | `type:${string}`;
export interface Filters {
  query: string;
  status: Status | 'all';
}

export function filterRows(rows: PersonRow[], { query, status }: Filters): PersonRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter(
    (r) => (status === 'all' || r.person.status === status) && (!q || r.person.name.toLowerCase().includes(q))
  );
}

export function sortRows(rows: PersonRow[], key: SortKey, descending: boolean): PersonRow[] {
  const value = (r: PersonRow): number => {
    if (key === 'total') return r.total;
    if (key === 'recent') return r.lastYear ?? -1;
    if (key.startsWith('type:')) return r.cells.get(key.slice(5))?.total ?? 0;
    return 0;
  };
  const sign = descending ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (key !== 'name') {
      const diff = value(a) - value(b);
      if (diff) return diff * sign;
    } else {
      const diff = a.person.name.localeCompare(b.person.name);
      if (diff) return diff * sign;
    }
    return a.person.name.localeCompare(b.person.name);
  });
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
  return lines.sort(
    (a, b) => (b.event?.year ?? 0) - (a.event?.year ?? 0) || a.activity.name.localeCompare(b.activity.name)
  );
}
