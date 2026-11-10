import type { Workshop, TimeSlot } from './models';

export interface MasterScheduleData {
  locations: string[];
  timeslots: TimeSlot[];
  workshops: Workshop[];
}

export interface RosterEntry {
  workshopName: string;
  leader: string;
  location: string;
  period: string;
  /** Day span, so a roster for a half-block class can say which half. Optional for older callers. */
  startDay?: number;
  endDay?: number;
  attendees: { fullName: string; age: string }[];
}

export interface AttendeeScheduleEntry {
  periodKey: string;
  periodDisplay: string;
  workshopName: string;
  leader: string;
  location: string;
  startDay: number;
  endDay: number;
}

export interface IndividualSchedule {
  fullName: string;
  email: string;
  age: string;
  entries: AttendeeScheduleEntry[];
}

export function buildMasterSchedule(workshops: Workshop[], timeslots: TimeSlot[]): MasterScheduleData {
  const locations = Array.from(new Set(workshops.filter((w) => w.location).map((w) => w.location))).sort((a, b) =>
    a.localeCompare(b)
  );
  return { locations, timeslots, workshops: workshops.filter((w) => w.location) };
}

export function buildRosters(workshops: Workshop[]): RosterEntry[] {
  return workshops
    .map((w) => {
      const firstChoiceOnly = w.selections.filter((s) => s.choiceNumber === 1);
      const sorted = [...firstChoiceOnly].sort(
        (a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)
      );
      return {
        workshopName: w.name,
        leader: w.leader,
        location: w.location || '(No Location)',
        period: w.period.displayName,
        startDay: w.duration.startDay,
        endDay: w.duration.endDay,
        attendees: sorted.map((s) => ({ fullName: s.fullName, age: '' })),
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period) || a.workshopName.localeCompare(b.workshopName));
}

export function buildIndividualSchedules(workshops: Workshop[], timeslots: TimeSlot[]): IndividualSchedule[] {
  const attendeeMap = new Map<string, IndividualSchedule>();
  const slotDisplayMap = new Map<string, string>(timeslots.map((ts) => [ts.periodKey, ts.displayName]));

  for (const workshop of workshops) {
    for (const selection of workshop.selections) {
      if (selection.choiceNumber !== 1) continue;

      const id = selection.classSelectionId;
      if (!attendeeMap.has(id)) {
        attendeeMap.set(id, {
          fullName: selection.fullName,
          email: '',
          age: '',
          entries: [],
        });
      }

      attendeeMap.get(id)!.entries.push({
        periodKey: workshop.period.sheetName,
        periodDisplay: slotDisplayMap.get(workshop.period.sheetName) ?? workshop.period.displayName,
        workshopName: workshop.name,
        leader: workshop.leader,
        location: workshop.location || '(No Location)',
        startDay: workshop.duration.startDay,
        endDay: workshop.duration.endDay,
      });
    }
  }

  return Array.from(attendeeMap.values()).sort((a, b) => {
    const [aLast, aFirst] = splitName(a.fullName);
    const [bLast, bFirst] = splitName(b.fullName);
    return aLast.localeCompare(bLast) || aFirst.localeCompare(bFirst);
  });
}

function splitName(fullName: string): [string, string] {
  const parts = fullName.trim().split(' ');
  const last = parts.pop() ?? '';
  return [last, parts.join(' ')];
}

export function getUniquePeriods(workshops: Workshop[]): { sheetName: string; displayName: string }[] {
  const seen = new Set<string>();
  const result: { sheetName: string; displayName: string }[] = [];
  for (const w of workshops) {
    if (!seen.has(w.period.sheetName)) {
      seen.add(w.period.sheetName);
      result.push({ sheetName: w.period.sheetName, displayName: w.period.displayName });
    }
  }
  return result;
}
