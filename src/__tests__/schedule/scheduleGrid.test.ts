import { describe, it, expect } from 'vitest';
import { buildScheduleGrid, buildMasterScheduleDocDefinition } from '~/components/schedule/scheduleGrid';
import type { MasterScheduleData } from '~/components/schedule/scheduleBuilder';
import type { Workshop, TimeSlot } from '~/components/schedule/models';

function ws(name: string, location: string, periodKey: string, startDay: number, endDay: number): Workshop {
  return {
    name,
    leader: `${name} Leader`,
    location,
    period: { sheetName: periodKey, displayName: periodKey },
    duration: { startDay, endDay },
    selections: [],
  };
}

const timeslots: TimeSlot[] = [
  { periodKey: 'custom-lunch', displayName: 'Lunch', startTime: '12:00', endTime: '13:00', isCustom: true },
  { periodKey: 'am1', displayName: 'Morning', startTime: '09:00', endTime: '10:40' },
];

describe('buildScheduleGrid', () => {
  it('follows timeslot order and tags break rows', () => {
    const data: MasterScheduleData = {
      locations: ['Hall'],
      timeslots,
      workshops: [ws('Yoga', 'Hall', 'am1', 1, 4)],
    };
    const grid = buildScheduleGrid(data);
    expect(grid.rows.map((r) => r.kind)).toEqual(['break', 'period']);
    expect(grid.rows[0]).toMatchObject({ kind: 'break', label: 'Lunch' });
  });

  it('routes a full-span workshop to fourDay and a half to half12 only', () => {
    const data: MasterScheduleData = {
      locations: ['Hall', 'Barn'],
      timeslots: [timeslots[1]],
      workshops: [ws('Yoga', 'Hall', 'am1', 1, 4), ws('Clay', 'Barn', 'am1', 1, 2)],
    };
    const grid = buildScheduleGrid(data);
    const row = grid.rows[0];
    if (row.kind !== 'period') throw new Error('expected period row');
    expect(row.cells[0].fourDay?.name).toBe('Yoga');
    expect(row.cells[1].half12?.name).toBe('Clay');
    expect(row.cells[1].half34).toBeUndefined();
  });

  it('sets landscape past 4 locations', () => {
    const base: MasterScheduleData = { locations: ['a', 'b', 'c', 'd'], timeslots: [], workshops: [] };
    expect(buildScheduleGrid(base).landscape).toBe(false);
    expect(buildScheduleGrid({ ...base, locations: ['a', 'b', 'c', 'd', 'e'] }).landscape).toBe(true);
  });
});

describe('buildMasterScheduleDocDefinition', () => {
  const grid = buildScheduleGrid({
    locations: ['Hall'],
    timeslots,
    workshops: [ws('Yoga', 'Hall', 'am1', 1, 4)],
  });

  it('uses the caller-supplied subtitle verbatim (no appended year)', () => {
    const doc = buildMasterScheduleDocDefinition(grid, { title: 'Master Schedule', subtitle: 'Winter Adventure 2026' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const header = (doc.content as any[])[0];
    expect(header.columns[0].text).toBe('Master Schedule');
    expect(header.columns[1].text).toBe('Winter Adventure 2026');
  });

  it('emits header + one row per break and two per period', () => {
    const doc = buildMasterScheduleDocDefinition(grid, { title: 'x', subtitle: 'y' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (doc.content as any[])[1].table.body as unknown[][];
    // header + break(1) + period(2)
    expect(body.length).toBe(4);
  });

  it('appends a trailing map image only when mapDataUri is given', () => {
    const withMap = buildMasterScheduleDocDefinition(grid, {
      title: 'x',
      subtitle: 'y',
      mapDataUri: 'data:image/png;base64,ABC',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = withMap.content as any[];
    expect(content[content.length - 1].image).toBe('data:image/png;base64,ABC');

    const noMap = buildMasterScheduleDocDefinition(grid, { title: 'x', subtitle: 'y' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((noMap.content as any[]).some((n) => 'image' in n)).toBe(false);
  });

  it('goes landscape when the grid is landscape', () => {
    const wide = buildScheduleGrid({
      locations: ['a', 'b', 'c', 'd', 'e'],
      timeslots: [timeslots[1]],
      workshops: [],
    });
    const doc = buildMasterScheduleDocDefinition(wide, { title: 'x', subtitle: 'y' });
    expect(doc.pageOrientation).toBe('landscape');
  });
});
