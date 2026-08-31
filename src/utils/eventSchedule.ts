import type { Workshop, TimeSlot } from '~/components/schedule/models';
import { buildMasterSchedule, type MasterScheduleData } from '~/components/schedule/scheduleBuilder';
import { formatTimeRange } from '~/components/schedule/timeUtils';
import { resolveClassLeaderNames, type EventClass } from '~/utils/classes';

/** Timeslot as authored in event frontmatter (`schedule.timeslots[]`). */
export interface FrontmatterTimeslot {
  label: string;
  start?: string;
  end?: string;
  isBreak?: boolean;
}

/** The subset of `event` frontmatter this module needs. */
export interface EventScheduleData {
  date: Date;
  endDate?: Date;
  classes?: EventClass[];
  schedule?: { timeslots: FrontmatterTimeslot[] };
}

/** Strip a trailing year from an event title (titles vary: "Winter Adventure" vs "… 2026"). */
export function baseEventTitle(title: string): string {
  return title.replace(/\s+\d{4}\s*$/, '');
}

/**
 * Normalise a period / timeslot label to a stable key. Both a class's `period`
 * string and a timeslot's `label` run through this, so "Morning, first period"
 * and "Morning, First Period" land in the same grid row.
 */
export function slugifyPeriod(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Map a free-text `days` value onto the three day-buckets the master-schedule
 * renderer understands: full span (1–4), first half (1–2), second half (3–4).
 * Anything outside those snaps to full span with a warning.
 */
export function parseDays(days: string | undefined): { startDay: number; endDay: number } {
  const raw = (days ?? '').trim();
  if (!raw) return { startDay: 1, endDay: 4 };

  const norm = raw.toLowerCase().replace(/[‒-―]/g, '-');

  if (/all\b.*day/.test(norm) || /\bday(s)?\b.*\ball\b/.test(norm)) return { startDay: 1, endDay: 4 };

  const range = norm.match(/day(?:s)?\s*(\d)\s*-\s*(\d)/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (a === 1 && b === 2) return { startDay: 1, endDay: 2 };
    if (a === 3 && b === 4) return { startDay: 3, endDay: 4 };
    if (a === 1 && b === 4) return { startDay: 1, endDay: 4 };
  }

  console.warn(`[eventSchedule] unrecognised days value "${raw}" — treating as full span (Days 1–4)`);
  return { startDay: 1, endDay: 4 };
}

/** Map authored `schedule.timeslots` onto the renderer's `TimeSlot[]`. */
export function frontmatterToTimeslots(timeslots: FrontmatterTimeslot[]): TimeSlot[] {
  return timeslots.map((ts) =>
    ts.isBreak
      ? {
          periodKey: `custom-${slugifyPeriod(ts.label)}`,
          displayName: ts.label,
          startTime: ts.start ?? '',
          endTime: ts.end ?? '',
          isCustom: true,
        }
      : {
          periodKey: slugifyPeriod(ts.label),
          displayName: ts.label,
          startTime: ts.start ?? '',
          endTime: ts.end ?? '',
        }
  );
}

function nonBreakLabels(data: EventScheduleData): Map<string, FrontmatterTimeslot> {
  const map = new Map<string, FrontmatterTimeslot>();
  for (const ts of data.schedule?.timeslots ?? []) {
    if (!ts.isBreak) map.set(slugifyPeriod(ts.label), ts);
  }
  return map;
}

/**
 * Compose a schedule-section heading from a class period, its matched timeslot,
 * and (for multi-day events) its `days` string. Falls back to the bare period
 * when there is no timeslot match, so events without a `schedule` block render
 * exactly as before.
 */
export function formatScheduleHeading(
  period: string,
  timeslot: FrontmatterTimeslot | undefined,
  days: string | undefined,
  isMultiDay: boolean
): string {
  const parts = [period];
  const range = timeslot ? formatTimeRange(timeslot.start ?? '', timeslot.end ?? '') : '';
  if (range) parts.push(range);
  if (isMultiDay && days) parts.push(days);
  return parts.join(' · ');
}

/**
 * Whether the event has enough data for a public master-schedule download:
 * a `schedule.timeslots` block, and a room on every class that maps to a
 * non-break timeslot. Reported (not thrown) so callers can log the gaps.
 */
export function hasMasterSchedule(data: EventScheduleData): {
  ok: boolean;
  missingRooms: string[];
  unmatchedPeriods: string[];
} {
  const timeslots = data.schedule?.timeslots ?? [];
  if (timeslots.length === 0) return { ok: false, missingRooms: [], unmatchedPeriods: [] };

  const labels = nonBreakLabels(data);
  const missingRooms: string[] = [];
  const unmatchedPeriods = new Set<string>();

  for (const cls of data.classes ?? []) {
    const key = slugifyPeriod(cls.period ?? '');
    if (!labels.has(key)) {
      if (cls.period) unmatchedPeriods.add(cls.period);
      continue;
    }
    if (!cls.room || !cls.room.trim()) missingRooms.push(cls.name);
  }

  return {
    ok: missingRooms.length === 0,
    missingRooms,
    unmatchedPeriods: [...unmatchedPeriods],
  };
}

/**
 * Synthesise the `MasterScheduleData` the schedule renderer consumes from event
 * frontmatter — no Cognito export involved. Workshops carry no `selections`;
 * this is the generic, non-attendee-specific schedule.
 */
export function buildEventMasterSchedule(
  data: EventScheduleData,
  leaderMap: Map<string, { name: string }>
): MasterScheduleData {
  const timeslots: TimeSlot[] = frontmatterToTimeslots(data.schedule?.timeslots ?? []);

  const timeslotKeys = new Set(timeslots.filter((t) => !t.isCustom).map((t) => t.periodKey));

  const workshops: Workshop[] = (data.classes ?? []).map((cls) => {
    const sheetName = slugifyPeriod(cls.period ?? '');
    if (cls.period && !timeslotKeys.has(sheetName)) {
      console.warn(`[eventSchedule] class "${cls.name}" period "${cls.period}" matches no timeslot label`);
    }
    return {
      name: cls.name,
      leader: resolveClassLeaderNames(cls, leaderMap).join(', '),
      period: { sheetName, displayName: cls.period ?? '' },
      duration: parseDays(cls.days),
      location: cls.room ?? '',
      selections: [],
    };
  });

  return buildMasterSchedule(workshops, timeslots);
}
