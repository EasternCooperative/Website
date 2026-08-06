import type { TimeSlot, Workshop } from './models';

export interface ValidationResult {
  isValid: boolean;
  hasOverlappingTimeslots: boolean;
  hasUnconfiguredTimeslots: boolean;
  overlapMessages: string[];
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function validateTimeslots(timeslots: TimeSlot[]): ValidationResult {
  const overlapMessages: string[] = [];
  let hasUnconfiguredTimeslots = false;

  // Period timeslots (non-custom) must have both start and end times
  const periodSlots = timeslots.filter((ts) => !ts.isCustom);
  for (const ts of periodSlots) {
    if (!ts.startTime || !ts.endTime) {
      hasUnconfiguredTimeslots = true;
      break;
    }
  }

  // Overlap check: all timeslots that have both times
  const withTimes = timeslots.filter((ts) => ts.startTime && ts.endTime);

  // Also detect slots with same start time but no end (duplicate custom slots)
  const startTimeCounts = new Map<string, TimeSlot[]>();
  for (const ts of timeslots.filter((ts) => ts.startTime && !ts.endTime)) {
    const existing = startTimeCounts.get(ts.startTime) ?? [];
    existing.push(ts);
    startTimeCounts.set(ts.startTime, existing);
  }
  for (const [, slots] of startTimeCounts) {
    if (slots.length > 1) {
      overlapMessages.push(`"${slots[0].displayName}" and "${slots[1].displayName}" have the same start time`);
    }
  }

  for (let i = 0; i < withTimes.length; i++) {
    for (let j = i + 1; j < withTimes.length; j++) {
      const a = withTimes[i];
      const b = withTimes[j];
      const aStart = timeToMinutes(a.startTime);
      const aEnd = timeToMinutes(a.endTime);
      const bStart = timeToMinutes(b.startTime);
      const bEnd = timeToMinutes(b.endTime);

      if (aStart < bEnd && aEnd > bStart) {
        overlapMessages.push(`"${a.displayName}" overlaps with "${b.displayName}"`);
      }
    }
  }

  const hasOverlappingTimeslots = overlapMessages.length > 0;
  const isValid = !hasOverlappingTimeslots && !hasUnconfiguredTimeslots;

  return { isValid, hasOverlappingTimeslots, hasUnconfiguredTimeslots, overlapMessages };
}

export interface LocationConflict {
  periodDisplay: string;
  location: string;
  workshopNames: string[];
}

function daysOverlap(a: Workshop, b: Workshop): boolean {
  return a.duration.startDay <= b.duration.endDay && a.duration.endDay >= b.duration.startDay;
}

export function validateLocations(workshops: Workshop[]): LocationConflict[] {
  // Group by period + location, then check for day-range overlaps within each group.
  // Days 1-2 and Days 3-4 in the same room are fine; only overlapping day ranges conflict.
  const groups = new Map<string, Workshop[]>();
  for (const w of workshops) {
    if (!w.location) continue;
    const key = `${w.period.sheetName}||${w.location}`;
    const group = groups.get(key) ?? [];
    group.push(w);
    groups.set(key, group);
  }

  const conflicts: LocationConflict[] = [];
  for (const ws of groups.values()) {
    const conflicting = new Set<string>();
    for (let i = 0; i < ws.length; i++) {
      for (let j = i + 1; j < ws.length; j++) {
        if (daysOverlap(ws[i], ws[j])) {
          conflicting.add(ws[i].name);
          conflicting.add(ws[j].name);
        }
      }
    }
    if (conflicting.size > 0) {
      conflicts.push({
        periodDisplay: ws[0].period.displayName,
        location: ws[0].location,
        workshopNames: Array.from(conflicting),
      });
    }
  }
  return conflicts;
}
