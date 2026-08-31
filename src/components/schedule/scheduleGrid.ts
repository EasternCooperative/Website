import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { formatTimeRange } from './timeUtils';
import type { MasterScheduleData } from './scheduleBuilder';

// Pure master-schedule model shared by the printable HTML page and the PDF, so the
// two renderings can't drift. No pdfmake runtime import lives in this file — only a
// type-only import — so it is safe to pull into an SSR / build-time route.
//
// Layout: one row per timeslot. A room that runs a different class in the first
// vs. second half of the event stacks both entries in its cell, each tagged with
// its day range. This keeps every row a natural height (no rowSpan), which both
// renderers can vertically centre cleanly.

const HEADER_FILL = '#e0e0e0';
const META_COLOR = '#555555';
const ACTIVITY_FILL = '#f0f0f0';

export interface GridClassEntry {
  name: string;
  leader: string;
  /** "Days 1–2" / "Days 3–4", or null when the class runs the whole event. */
  dayLabel: string | null;
}

export interface GridPeriodCell {
  location: string;
  entries: GridClassEntry[];
}

export type ScheduleGridRow =
  | { kind: 'break'; label: string; timeText: string }
  | { kind: 'period'; timeText: string; displayName: string; cells: GridPeriodCell[] };

export interface ScheduleGridModel {
  locations: string[];
  landscape: boolean;
  rows: ScheduleGridRow[];
}

function dayLabelFor(startDay: number, endDay: number): string | null {
  if (startDay === 1 && endDay === 2) return 'Days 1–2';
  if (startDay === 3 && endDay === 4) return 'Days 3–4';
  return null;
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
      const entries = workshops
        .filter((w) => w.period.sheetName === ts.periodKey && w.location === loc)
        .sort((a, b) => a.duration.startDay - b.duration.startDay)
        .map((w) => ({
          name: w.name,
          leader: w.leader,
          dayLabel: dayLabelFor(w.duration.startDay, w.duration.endDay),
        }));
      return { location: loc, entries };
    });

    return { kind: 'period', timeText, displayName: ts.displayName, cells };
  });

  return { locations, landscape, rows };
}

// ---------------------------------------------------------------------------
// PDF document definition (plain object; no pdfmake runtime needed to build it)
// ---------------------------------------------------------------------------

export function buildMasterScheduleDocDefinition(
  grid: ScheduleGridModel,
  opts: { title: string; subtitle: string }
): TDocumentDefinitions {
  const { locations, landscape, rows } = grid;
  const colCount = 1 + locations.length; // Time | ...locations
  const widths = ['auto', ...locations.map(() => '*' as const)];

  const headerRow: object[] = [
    { text: 'Time', bold: true, fillColor: HEADER_FILL, alignment: 'center', fontSize: 10 },
    ...locations.map((loc) => ({ text: loc, bold: true, fillColor: HEADER_FILL, alignment: 'center', fontSize: 10 })),
  ];

  const cellContent = (entries: GridClassEntry[]): object => {
    if (entries.length === 0) return { text: '' };
    return {
      stack: entries.flatMap((e, i) => [
        {
          text: [
            ...(e.dayLabel ? [{ text: `${e.dayLabel}  `, fontSize: 8, color: META_COLOR }] : []),
            { text: e.name, bold: true, fontSize: 10 },
          ],
          ...(i > 0 ? { marginTop: 4 } : {}),
        },
        ...(e.leader ? [{ text: e.leader, fontSize: 8, italics: true, color: META_COLOR }] : []),
      ]),
    };
  };

  const bodyRows: object[][] = [];

  for (const row of rows) {
    if (row.kind === 'break') {
      const label = row.timeText ? `${row.label}  ${row.timeText}` : row.label;
      bodyRows.push([
        { text: label, colSpan: colCount, alignment: 'center', fillColor: ACTIVITY_FILL, bold: true, fontSize: 10 },
        ...Array<object>(colCount - 1).fill({}),
      ]);
      continue;
    }

    bodyRows.push([
      { text: row.timeText || row.displayName, bold: true, fontSize: 10, alignment: 'center', noWrap: true },
      ...row.cells.map((cell) => cellContent(cell.entries)),
    ]);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tableLayout: any = {
    paddingLeft: () => 7,
    paddingRight: () => 7,
    paddingTop: () => 8,
    paddingBottom: () => 8,
    hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
      i === 0 || i === node.table.body.length ? 1 : 0.5,
    hLineColor: () => '#bbbbbb',
    vLineWidth: () => 0.5,
    vLineColor: () => '#cccccc',
  };

  return {
    pageOrientation: landscape ? 'landscape' : 'portrait',
    pageSize: 'LETTER',
    pageMargins: [28, 32, 28, 28],
    content: [
      {
        columns: [
          { text: opts.title, fontSize: 20, bold: true },
          {
            text: opts.subtitle,
            fontSize: 12,
            bold: true,
            alignment: 'right',
            color: META_COLOR,
            margin: [0, 6, 0, 0],
          },
        ],
        marginBottom: 12,
      },
      {
        table: { headerRows: 1, widths, body: [headerRow, ...bodyRows] },
        layout: tableLayout,
      },
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
