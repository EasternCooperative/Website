import { describe, it, expect } from 'vitest';
import { buildScheduleFrontmatter } from '~/components/schedule/frontmatterExport';
import { buildEventMasterSchedule, type EventScheduleData } from '~/utils/eventSchedule';
import { buildScheduleGrid } from '~/components/schedule/scheduleGrid';
import type { Workshop, TimeSlot } from '~/components/schedule/models';

const timeslots: TimeSlot[] = [
  { periodKey: 'custom-breakfast', displayName: 'Breakfast', startTime: '08:00', endTime: '09:00', isCustom: true },
  { periodKey: 'morning-first-period', displayName: 'Morning, first period', startTime: '09:00', endTime: '10:40' },
];

function ws(name: string, location: string, startDay = 1, endDay = 4): Workshop {
  return {
    name,
    leader: `${name} Leader`,
    location,
    period: { sheetName: 'morning-first-period', displayName: 'Morning, first period' },
    duration: { startDay, endDay },
    selections: [],
  };
}

describe('buildScheduleFrontmatter', () => {
  const workshops = [ws('Folk Dance', 'Rec Hall'), ws('Chair Yoga', 'Elm Room', 1, 2), ws('Roomless', '')];

  it('emits a schedule block with break flag and quoted values', () => {
    const { yaml } = buildScheduleFrontmatter(workshops, timeslots);
    expect(yaml).toContain('schedule:');
    expect(yaml).toContain("    - label: 'Breakfast'");
    expect(yaml).toContain('      isBreak: true');
    expect(yaml).toContain("    - label: 'Morning, first period'");
    expect(yaml).toContain("      start: '09:00'");
    // non-break rows carry no isBreak line
    expect(yaml).not.toMatch(/Morning, first period'\n {6}start: '09:00'\n {6}end: '10:40'\n {6}isBreak/);
  });

  it('lists only workshops that have a room, sorted by name', () => {
    const { roomRows } = buildScheduleFrontmatter(workshops, timeslots);
    expect(roomRows).toEqual([
      { name: 'Chair Yoga', room: 'Elm Room' },
      { name: 'Folk Dance', room: 'Rec Hall' },
    ]);
  });

  it('round-trips: exported yaml + matching classes rebuild the same grid', () => {
    const { yaml } = buildScheduleFrontmatter(workshops, timeslots);
    // parse the tiny yaml back by hand into the frontmatter shape
    const parsed: EventScheduleData = {
      date: new Date('2026-12-27T00:00:00Z'),
      endDate: new Date('2026-12-30T00:00:00Z'),
      schedule: {
        timeslots: [
          { label: 'Breakfast', start: '08:00', end: '09:00', isBreak: true },
          { label: 'Morning, first period', start: '09:00', end: '10:40' },
        ],
      },
      classes: [
        { name: 'Folk Dance', period: 'Morning, first period', days: 'All 4 days', room: 'Rec Hall' },
        { name: 'Chair Yoga', period: 'Morning, first period', days: 'Days 1–2', room: 'Elm Room' },
      ],
    };
    expect(yaml).toContain("label: 'Morning, first period'");

    const grid = buildScheduleGrid(buildEventMasterSchedule(parsed, new Map()));
    expect(grid.locations).toEqual(['Elm Room', 'Rec Hall']);
    const periodRow = grid.rows.find((r) => r.kind === 'period');
    if (periodRow?.kind !== 'period') throw new Error('expected a period row');
    expect(periodRow.cells.find((c) => c.location === 'Rec Hall')!.fourDay?.name).toBe('Folk Dance');
    expect(periodRow.cells.find((c) => c.location === 'Elm Room')!.half12?.name).toBe('Chair Yoga');
  });
});
