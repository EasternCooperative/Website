import type { Workshop, TimeSlot } from './models';

// Browser-local persistence for the schedule tool.
//
// A *draft* is the set of edits made in this browser that aren't published yet,
// scoped to one event. Each edit remembers the published value it was made
// against (`base`), so a draft is only re-applied while that published value is
// unchanged. Once someone publishes a different room or timeslot list, the
// published data wins and the stale edit is dropped instead of silently
// overriding it.

const LEGACY_LOCATIONS_KEY = 'ecrs-schedule-locations';
const HISTORY_KEY = 'ecrs-schedule-locations-history';
const DRAFT_PREFIX = 'ecrs-schedule-draft:';

export interface ScheduleDraft {
  /** workshop key -> the edited room and the published room it replaced */
  rooms: Record<string, { value: string; base: string }>;
  /** the edited timeslot list and the published list it replaced (as JSON) */
  timeslots?: { value: TimeSlot[]; base: string };
}

export interface AppliedDraft {
  workshops: Workshop[];
  timeslots: TimeSlot[];
  restoredRooms: number;
  restoredTimeslots: boolean;
}

/** Stable identity for a class within an event (leader can change; period + name can't collide). */
export function workshopKey(w: Pick<Workshop, 'name' | 'period'>): string {
  return `${w.period.sheetName}|${w.name.trim().toLowerCase()}`;
}

/** The edits that turn the published state into the current one. */
export function buildDraft(
  published: { workshops: Workshop[]; timeslots: TimeSlot[] },
  current: { workshops: Workshop[]; timeslots: TimeSlot[] }
): ScheduleDraft {
  const publishedRooms = new Map(published.workshops.map((w) => [workshopKey(w), w.location]));
  const rooms: ScheduleDraft['rooms'] = {};
  for (const w of current.workshops) {
    const key = workshopKey(w);
    const base = publishedRooms.get(key) ?? '';
    if (w.location !== base) rooms[key] = { value: w.location, base };
  }

  const base = JSON.stringify(published.timeslots);
  const draft: ScheduleDraft = { rooms };
  if (JSON.stringify(current.timeslots) !== base) draft.timeslots = { value: current.timeslots, base };
  return draft;
}

export function isEmptyDraft(draft: ScheduleDraft): boolean {
  return Object.keys(draft.rooms).length === 0 && !draft.timeslots;
}

/** Re-apply a saved draft on top of the published state, skipping edits whose base has since changed. */
export function applyDraft(
  published: { workshops: Workshop[]; timeslots: TimeSlot[] },
  draft: ScheduleDraft | null
): AppliedDraft {
  if (!draft) {
    return { ...published, restoredRooms: 0, restoredTimeslots: false };
  }

  let restoredRooms = 0;
  const workshops = published.workshops.map((w) => {
    const edit = draft.rooms?.[workshopKey(w)];
    if (!edit || edit.base !== w.location || edit.value === w.location) return w;
    restoredRooms++;
    return { ...w, location: edit.value };
  });

  const restoredTimeslots = !!draft.timeslots && draft.timeslots.base === JSON.stringify(published.timeslots);
  const timeslots = restoredTimeslots ? draft.timeslots!.value : published.timeslots;

  return { workshops, timeslots, restoredRooms, restoredTimeslots };
}

export function saveDraft(scope: string, draft: ScheduleDraft): void {
  try {
    if (isEmptyDraft(draft)) localStorage.removeItem(DRAFT_PREFIX + scope);
    else localStorage.setItem(DRAFT_PREFIX + scope, JSON.stringify(draft));
  } catch {
    // localStorage unavailable
  }
}

export function loadDraft(scope: string): ScheduleDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + scope);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ScheduleDraft>;
    return { rooms: parsed.rooms ?? {}, timeslots: parsed.timeslots };
  } catch {
    return null;
  }
}

export function clearDraft(scope: string): void {
  try {
    localStorage.removeItem(DRAFT_PREFIX + scope);
    // Pre-draft versions of the tool kept one unscoped room map that was applied
    // over every event's published rooms. Nothing reads it any more; drop it.
    localStorage.removeItem(LEGACY_LOCATIONS_KEY);
  } catch {
    // ignore
  }
}

// Room names typed before, offered as suggestions in the room field.

export function saveLocationHistory(history: string[]): void {
  try {
    const existing = loadLocationHistory();
    const merged = Array.from(new Set([...history, ...existing])).slice(0, 50);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(merged));
  } catch {
    // ignore
  }
}

export function loadLocationHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}
