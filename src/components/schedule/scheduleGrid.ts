import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { formatTimeRange } from './timeUtils';
import type { MasterScheduleData } from './scheduleBuilder';

// Pure master-schedule model shared by the printable HTML page and the PDF, so the
// two renderings can't drift. No pdfmake runtime import lives in this file — only a
// type-only import — so it is safe to pull into an SSR / build-time route.

const HEADER_FILL = '#e0e0e0';
const META_COLOR = '#555555';
const ACTIVITY_FILL = '#f0f0f0';

export interface GridCellItem {
  name: string;
  leader: string;
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
        w ? { name: w.name, leader: w.leader } : undefined;

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

// ---------------------------------------------------------------------------
// PDF document definition (plain object; no pdfmake runtime needed to build it)
// ---------------------------------------------------------------------------

export function buildMasterScheduleDocDefinition(
  grid: ScheduleGridModel,
  opts: { title: string; subtitle: string; mapDataUri?: string }
): TDocumentDefinitions {
  const { locations, landscape, rows } = grid;
  const colCount = 2 + locations.length; // Time | Days | ...locations
  const widths = ['auto', 'auto', ...locations.map(() => '*' as const)];

  const headerRow: object[] = [
    { text: 'Time', bold: true, fillColor: HEADER_FILL, alignment: 'center', fontSize: 11 },
    { text: 'Days', bold: true, fillColor: HEADER_FILL, alignment: 'center', fontSize: 11 },
    ...locations.map((loc) => ({ text: loc, bold: true, fillColor: HEADER_FILL, alignment: 'center', fontSize: 11 })),
  ];

  const makeCell = (item: GridCellItem | undefined): object =>
    item
      ? {
          stack: [
            { text: item.name, bold: true, fontSize: 11 },
            ...(item.leader ? [{ text: item.leader, fontSize: 9, color: META_COLOR, italics: true }] : []),
          ],
          verticalAlignment: 'center',
        }
      : { text: '', verticalAlignment: 'center' };

  const bodyRows: object[][] = [];

  for (const row of rows) {
    if (row.kind === 'break') {
      const label = row.timeText ? `${row.label}  ${row.timeText}` : row.label;
      bodyRows.push([
        { text: label, colSpan: colCount, alignment: 'center', fillColor: ACTIVITY_FILL, bold: true, fontSize: 11 },
        ...Array<object>(colCount - 1).fill({}),
      ]);
      continue;
    }

    const row12: object[] = [];
    const row34: object[] = [];

    row12.push({
      text: row.timeText || row.displayName,
      bold: true,
      fontSize: 11,
      alignment: 'center',
      verticalAlignment: 'center',
      rowSpan: 2,
    });
    row34.push({});

    row12.push({ text: 'Days\n1-2', fontSize: 9, alignment: 'center', verticalAlignment: 'center', color: META_COLOR });
    row34.push({ text: 'Days\n3-4', fontSize: 9, alignment: 'center', verticalAlignment: 'center', color: META_COLOR });

    for (const cell of row.cells) {
      if (cell.fourDay) {
        row12.push({ ...makeCell(cell.fourDay), rowSpan: 2 });
        row34.push({});
      } else {
        row12.push(makeCell(cell.half12));
        row34.push(makeCell(cell.half34));
      }
    }

    bodyRows.push(row12);
    bodyRows.push(row34);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tableLayout: any = {
    paddingLeft: () => 8,
    paddingRight: () => 8,
    paddingTop: () => 7,
    paddingBottom: () => 7,
    hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
      i === 0 || i === node.table.body.length ? 1 : 0.5,
    hLineColor: () => '#bbbbbb',
    vLineWidth: () => 0.5,
    vLineColor: () => '#cccccc',
  };

  return {
    pageOrientation: landscape ? 'landscape' : 'portrait',
    pageSize: 'LETTER',
    pageMargins: [24, 32, 24, 24],
    content: [
      {
        columns: [
          { text: opts.title, fontSize: 22, bold: true },
          {
            text: opts.subtitle,
            fontSize: 13,
            bold: true,
            alignment: 'right',
            color: META_COLOR,
            margin: [0, 6, 0, 0],
          },
        ],
        marginBottom: 10,
      },
      {
        table: { headerRows: 1, widths, body: [headerRow, ...bodyRows] },
        layout: tableLayout,
      },
      ...(opts.mapDataUri
        ? [{ image: opts.mapDataUri, width: landscape ? 520 : 400, alignment: 'center', margin: [0, 16, 0, 0] }]
        : []),
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
