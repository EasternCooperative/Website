// Finding people to staff a class or activity at an event. Everything here is computed in
// the browser from what the tool already holds (roles, events, outreach, locations), and every
// score comes with the words that explain it. Nothing is hidden because of a score.

import type { Data, EventRow, Expertise, Outreach, Person, PersonLocation, Role, Scope } from './model';

export interface Brief {
  /** Where, and optionally when. Staffing does not depend on how long the event runs. */
  venue: string | null;
  date: string | null;
  type: string;
}
export const EMPTY_BRIEF: Brief = {
  venue: null,
  date: null,
  type: '',
};

export type SegmentKey = 'experience' | 'availability' | 'nearness' | 'timing';
export type Weights = Record<SegmentKey, number>;
export const DEFAULT_STAFF_WEIGHTS: Weights = {
  experience: 4,
  availability: 2,
  nearness: 1.5,
  timing: 1,
};

export interface Segment {
  key: SegmentKey;
  /** 0 to 1. */
  value: number;
  /** In words, or empty when there is nothing to say. */
  detail: string;
}
/** One class or activity someone has led or helped with, with how often and when last. */
export interface HistoryItem {
  title: string;
  type: string;
  scope: Scope;
  led: number;
  assisted: number;
  last: number;
  /** Whether it is the type being staffed. */
  sameType: boolean;
}

export interface Candidate {
  /** Everything they have led, the type being staffed first, then newest. */
  history: HistoryItem[];
  person: Person;
  segments: Segment[];
  /** 0 to 100. */
  total: number;
  /** The staffing ask for this venue, date, and slot, if there is one. */
  ask: Outreach | null;
  /** When they were last contacted for anything, if lately. */
  lastContacted: string | null;
  /** The mark that says they are an expert in this type, if one was set. */
  expert: Expertise | null;
  /** "Ottsville, PA", when their location is known. */
  place: string | null;
  experience: number;
  ledHere: number;
  mentor: boolean;
}

export interface StaffFilters {
  /** Only people known to live within this many miles. People with no known location stay in. */
  maxMiles: number | null;
  hasLed: boolean;
  ledHere: boolean;
  mentorsOnly: boolean;
  includeAway: boolean;
}
export const DEFAULT_STAFF_FILTERS: StaffFilters = {
  maxMiles: null,
  hasLed: false,
  ledHere: false,
  mentorsOnly: false,
  includeAway: false,
};

/** Straight-line miles between two points. */
export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

/** Each located person's distance to a venue. */
export function milesTo(locations: PersonLocation[] | undefined, venue: { lat: number; lng: number } | undefined) {
  const out = new Map<number, number>();
  if (venue) for (const l of locations ?? []) out.set(l.person_id, milesBetween(l, venue));
  return out;
}

const doy = (iso: string): number => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Math.round((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000) + 1;
};
const near = (a: string, b: string): boolean => {
  const d = Math.abs(doy(a) - doy(b));
  return Math.min(d, 365 - d) <= 42;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const slotLabel = (b: Brief): string => b.type;

/** Activities count for half of what a class does, whether someone led or helped. */
const ACTIVITY_WEIGHT = 0.5;

const LED = new Set(['solo', 'partner']);

/**
 * Everyone who could fill the slot, best first. `miles` (optional) is each person's distance
 * to the venue, once locations are known.
 */
export function candidatesFor(
  data: Data,
  brief: Brief,
  weights: Weights,
  filters: StaffFilters,
  today: string,
  miles: Map<number, number> = new Map()
): Candidate[] {
  // Staffing is planned for a venue and, optionally, a date. No event record is involved.
  const event = brief.date || brief.venue ? { start_date: brief.date, site_id: brief.venue } : undefined;
  const activities = new Map(data.activities.map((a) => [a.id, a]));
  const events = new Map(data.events.map((e) => [e.id, e]));
  const slot = slotLabel(brief);
  const placeBy = new Map((data.locations ?? []).map((l) => [l.person_id, l]));
  const rolesBy = new Map<number, Role[]>();
  for (const r of data.roles) rolesBy.set(r.person_id, [...(rolesBy.get(r.person_id) ?? []), r]);
  const outreach = data.outreach ?? [];
  const blocked = new Set(outreach.filter((o) => o.status === 'do_not_contact').map((o) => o.person_id));
  const sixMonths = new Date(`${today}T00:00:00Z`);
  sixMonths.setUTCDate(sixMonths.getUTCDate() - 180);
  const recent = sixMonths.toISOString().slice(0, 10);

  const out: Candidate[] = [];
  for (const person of data.people) {
    if (blocked.has(person.id)) continue;
    const away = person.status !== 'active';
    if (away && !filters.includeAway) continue;
    if (filters.mentorsOnly && !person.mentor) continue;
    const dist = miles.get(person.id);
    if (filters.maxMiles !== null && dist !== undefined && dist > filters.maxMiles) continue;

    const place = placeBy.get(person.id);
    const byTitle = new Map<number, HistoryItem>();
    for (const r of rolesBy.get(person.id) ?? []) {
      const a = activities.get(r.activity_id);
      const e = events.get(r.event_id);
      if (!a || !e) continue;
      const h = byTitle.get(a.id) ?? {
        title: a.name,
        type: a.type,
        scope: a.scope,
        led: 0,
        assisted: 0,
        last: 0,
        sameType: a.type === brief.type,
      };
      if (LED.has(r.leadership_type)) h.led++;
      else h.assisted++;
      h.last = Math.max(h.last, e.year);
      byTitle.set(a.id, h);
    }
    const history = [...byTitle.values()].sort(
      (x, y) => Number(y.sameType) - Number(x.sameType) || y.last - x.last || x.title.localeCompare(y.title)
    );
    const expert = (data.expertise ?? []).find((x) => x.person_id === person.id && x.type === brief.type) ?? null;
    const roles = rolesBy.get(person.id) ?? [];
    let points = 0;
    let led = 0;
    let lastLed = 0;
    let ledHere = 0;
    let timing = 0;
    for (const r of roles) {
      const a = activities.get(r.activity_id);
      const e = events.get(r.event_id);
      if (!a || !e) continue;
      if (a.type !== brief.type) continue;
      const weight = a.scope === 'activity' ? ACTIVITY_WEIGHT : 1;
      if (LED.has(r.leadership_type)) {
        led++;
        points += weight;
        lastLed = Math.max(lastLed, e.year);
      } else points += weight / 2;
      if (event?.site_id && e.site_id === event.site_id) ledHere++;
      if (event?.start_date && e.start_date && near(e.start_date, event.start_date)) timing++;
    }
    if (filters.hasLed && led === 0) continue;
    if (filters.ledHere && ledHere === 0) continue;

    const nearness = Math.max(Math.min(ledHere, 3) / 3, dist === undefined ? 0 : 1 - Math.min(dist, 150) / 150);

    const segments: Segment[] = [
      {
        key: 'experience',
        // Six times leading fills the bar, and an expert mark fills it whatever the records say.
        value: expert ? 1 : Math.min(points / 6, 1),
        detail: led
          ? `${expert ? `Marked an expert in ${brief.type}. ` : ''}Led ${brief.type} ${plural(led, 'time', 'times')}, last in ${lastLed}`
          : expert
            ? `Marked an expert in ${brief.type}`
            : points
              ? `Helped with ${brief.type}`
              : '',
      },
      {
        key: 'availability',
        value: Math.min(
          (person.status === 'active' ? 1 : person.status === 'hiatus' ? 0.3 : 0.1) + (person.mentor ? 0.2 : 0),
          1
        ),
        detail: [
          person.status === 'active' ? '' : person.status === 'hiatus' ? 'On hiatus' : 'Inactive',
          person.mentor ? 'Mentor' : '',
        ]
          .filter(Boolean)
          .join(', '),
      },
      {
        key: 'nearness',
        value: nearness,
        detail: [
          dist === undefined ? '' : `About ${Math.round(dist)} miles away${place?.city ? ` (${place.city})` : ''}`,
          ledHere ? `Led here ${plural(ledHere, 'time', 'times')}` : '',
        ]
          .filter(Boolean)
          .join(', '),
      },
      {
        key: 'timing',
        value: Math.min(timing, 3) / 3,
        detail: timing ? `Led ${plural(timing, 'time', 'times')} near this time of year` : '',
      },
    ];
    const sum = Object.values(weights).reduce((n, w) => n + w, 0) || 1;
    const total = Math.round((segments.reduce((n, s) => n + s.value * weights[s.key], 0) / sum) * 100);
    const lastContact = outreach
      .filter((o) => o.person_id === person.id && o.contacted_on && o.contacted_on >= recent)
      .map((o) => o.contacted_on as string)
      .sort()
      .at(-1);
    out.push({
      history,
      person,
      segments,
      total,
      ask:
        outreach.find(
          (o) =>
            o.goal === 'staff_slot' &&
            o.person_id === person.id &&
            o.venue_id === brief.venue &&
            (o.plan_date ?? null) === brief.date &&
            o.slot === slot
        ) ?? null,
      lastContacted: lastContact ?? null,
      experience: points,
      ledHere,
      mentor: !!person.mentor,
      expert,
      place: place ? [place.city, place.state].filter(Boolean).join(', ') || null : null,
    });
  }
  // Leading something else at the event does not rule anyone out; the card just says so.
  return out.sort(
    (a, b) => b.total - a.total || b.experience - a.experience || a.person.name.localeCompare(b.person.name)
  );
}

export interface Depth {
  type: string;
  /** Active people who led this type in the last five years. */
  ready: number;
  /** Everyone who has ever led it. */
  ever: number;
  mentors: number;
}

/** How many experienced, available leaders there are for each type, thinnest first. */
export function benchDepth(data: Data, today: string): Depth[] {
  const year = Number(today.slice(0, 4));
  const activities = new Map(data.activities.map((a) => [a.id, a]));
  const events = new Map<number, EventRow>(data.events.map((e) => [e.id, e]));
  const people = new Map(data.people.map((p) => [p.id, p]));
  const byType = new Map<string, Map<number, number>>();
  for (const r of data.roles) {
    const a = activities.get(r.activity_id);
    const e = events.get(r.event_id);
    if (!a || !e || !LED.has(r.leadership_type)) continue;
    const t = byType.get(a.type) ?? new Map<number, number>();
    t.set(r.person_id, Math.max(t.get(r.person_id) ?? 0, e.year));
    byType.set(a.type, t);
  }
  const depth: Depth[] = [];
  for (const type of data.activityTypes) {
    const t = byType.get(type) ?? new Map<number, number>();
    let ready = 0;
    let mentors = 0;
    for (const [pid, last] of t) {
      const p = people.get(pid);
      if (p?.status === 'active' && last >= year - 5) {
        ready++;
        if (p.mentor) mentors++;
      }
    }
    depth.push({ type, ready, ever: t.size, mentors });
  }
  return depth.sort((a, b) => a.ready - b.ready || a.type.localeCompare(b.type));
}
