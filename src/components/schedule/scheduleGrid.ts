import { formatTimeRange } from './timeUtils';
import type { MasterScheduleData } from './scheduleBuilder';

// Pure master-schedule model consumed by the printable HTML page
// (src/pages/events/[id]/schedule.astro), which CI renders to a static PDF.

export interface GridCellItem {
  name: string;
  leader: string;
  /** Index into the source event's `classes[]` (frontmatter path only). */
  classIndex?: number;
}

export interface GridPeriodCell {
  location: string;
  fourDay?: GridCellItem;
  half12?: GridCellItem;
  half34?: GridCellItem;
}

export type ScheduleGridRow =
  | { kind: 'break'; label: string; timeText: string }
  | { kind: 'period'; timeText: string; displayName: string; cells: GridPeriodCell[] };

export interface ScheduleGridModel {
  locations: string[];
  landscape: boolean;
  rows: ScheduleGridRow[];
}

export function buildScheduleGrid(data: MasterScheduleData): ScheduleGridModel {
  const { locations, timeslots, workshops } = data;
  const landscape = locations.length > 4;

  const rows: ScheduleGridRow[] = timeslots.map((ts): ScheduleGridRow => {
    const timeText = formatTimeRange(ts.startTime, ts.endTime);

    if (ts.isCustom) {
      return { kind: 'break', label: ts.displayName, timeText };
    }

    const cells: GridPeriodCell[] = locations.map((loc) => {
      const match = (startDay: number, endDay: number) =>
        workshops.find(
          (w) =>
            w.period.sheetName === ts.periodKey &&
            w.location === loc &&
            w.duration.startDay === startDay &&
            w.duration.endDay === endDay
        );
      const toItem = (w: ReturnType<typeof match>): GridCellItem | undefined =>
        w ? { name: w.name, leader: w.leader, classIndex: w.classIndex } : undefined;

      return {
        location: loc,
        fourDay: toItem(match(1, 4)),
        half12: toItem(match(1, 2)),
        half34: toItem(match(3, 4)),
      };
    });

    return { kind: 'period', timeText, displayName: ts.displayName, cells };
  });

  return { locations, landscape, rows };
}
