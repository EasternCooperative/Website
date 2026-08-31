import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { formatTimeRange } from './timeUtils';
import type { TimeSlot } from './models';
import type { RosterEntry, IndividualSchedule } from './scheduleBuilder';
import { compositeMap } from './mapCompositor';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(pdfMake as any).vfs = ((pdfFonts as any).pdfMake?.vfs ?? (pdfFonts as any).vfs) as Record<string, string>;

const HEADER_FILL = '#e0e0e0';
const META_COLOR = '#555555';
const MUTED_COLOR = '#aaaaaa';

// The master schedule is no longer generated here — it is the printable HTML page
// at /events/<id>/schedule, rendered to a static PDF in CI (scripts/render-schedule-pdfs.mjs).
// This module keeps the attendee-specific outputs, which need pdfmake's per-page layout.

// ---------------------------------------------------------------------------
// Workshop Rosters
// ---------------------------------------------------------------------------

function rosterNameFontSize(fullName: string, counter: number): number {
  const len = `${counter}. ${fullName} [ ]`.length;
  if (len > 45) return 10;
  if (len > 35) return 11;
  if (len > 28) return 12;
  return 14;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rosterTableLayout: any = {
  paddingLeft: () => 4,
  paddingRight: () => 4,
  paddingTop: () => 9,
  paddingBottom: () => 9,
  hLineWidth: () => 0,
  vLineWidth: () => 0,
};

function rosterTable(items: Array<{ a: RosterEntry['attendees'][0]; counter: number }>): object {
  return {
    table: {
      widths: ['auto', '*', 'auto'],
      body: items.map(({ a, counter }) => {
        const fs = rosterNameFontSize(a.fullName, counter);
        return [
          { text: `${counter}.`, fontSize: fs, color: META_COLOR },
          { text: a.fullName, fontSize: fs },
          { text: '[      ]', fontSize: 20, bold: true, verticalAlignment: 'center' },
        ];
      }),
    },
    layout: rosterTableLayout,
  };
}

export function downloadRosters(rosters: RosterEntry[], eventName: string): void {
  const content: object[] = [];

  rosters.forEach((r, idx) => {
    let attendeeList: object;
    if (r.attendees.length === 0) {
      attendeeList = { text: 'No attendees', italics: true, color: MUTED_COLOR, margin: [0, 8, 0, 0] };
    } else {
      const indexed = r.attendees.map((a, i) => ({ a, counter: i + 1 }));
      const left = indexed.filter((_, i) => i % 2 === 0);
      const right = indexed.filter((_, i) => i % 2 === 1);
      attendeeList = {
        columns: right.length > 0 ? [rosterTable(left), rosterTable(right)] : [rosterTable(left)],
        margin: [0, 8, 0, 0],
      };
    }

    content.push({
      stack: [
        { text: r.workshopName, fontSize: 24, bold: true },
        ...(r.leader ? [{ text: r.leader, fontSize: 16, color: META_COLOR, marginTop: 2 }] : []),
        {
          text: `${r.period}  •  ${r.location}  •  ${r.attendees.length} attendee${r.attendees.length !== 1 ? 's' : ''}`,
          fontSize: 12,
          color: META_COLOR,
          margin: [0, 6, 0, 0],
        },
        attendeeList,
      ],
      ...(idx > 0 ? { pageBreak: 'before' } : {}),
    });
  });

  pdfMake
    .createPdf({
      pageSize: 'LETTER',
      pageMargins: [54, 54, 54, 54],
      footer: (currentPage: number, pageCount: number) => ({
        text: `${eventName}  |  Page ${currentPage} of ${pageCount}`,
        alignment: 'center',
        fontSize: 9,
        color: META_COLOR,
        margin: [0, 12, 0, 0],
      }),
      content,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .download(`${eventName}_Rosters.pdf`);
}

// ---------------------------------------------------------------------------
// Individual Schedules
// ---------------------------------------------------------------------------

export async function downloadIndividualSchedules(
  schedules: IndividualSchedule[],
  timeslots: TimeSlot[],
  eventName: string
): Promise<void> {
  const content: object[] = [];
  const year = new Date().getFullYear();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const indvLayout: any = {
    paddingLeft: () => 10,
    paddingRight: () => 10,
    paddingTop: () => 10,
    paddingBottom: () => 10,
    hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
      i === 0 || i === node.table.body.length ? 1 : 0.5,
    hLineColor: () => '#bbbbbb',
    vLineWidth: () => 0.5,
    vLineColor: () => '#cccccc',
  };

  for (const [idx, s] of schedules.entries()) {
    // Group entries by period — a period may have two half-block entries (days 1-2 and 3-4)
    const entryMap = new Map<string, (typeof s.entries)[number][]>();
    for (const entry of s.entries) {
      const existing = entryMap.get(entry.periodKey) ?? [];
      existing.push(entry);
      entryMap.set(entry.periodKey, existing);
    }

    const tableBody: object[][] = [
      [
        { text: 'Time', bold: true, fillColor: HEADER_FILL, fontSize: 13 },
        { text: 'Activity', bold: true, fillColor: HEADER_FILL, fontSize: 13 },
      ],
    ];

    for (const ts of timeslots) {
      const entries = entryMap.get(ts.periodKey) ?? [];
      const timeStr = formatTimeRange(ts.startTime, ts.endTime);
      const timeCell = { text: timeStr || ts.displayName, fontSize: 12, color: META_COLOR };

      if (entries.length > 0) {
        // Sort by startDay so days 1-2 always appears above days 3-4
        const sorted = [...entries].sort((a, b) => a.startDay - b.startDay);
        const isSplit = sorted.length > 1;

        const activityStack = sorted.flatMap((entry, i) => {
          const nameText = isSplit
            ? `Days ${entry.startDay}–${entry.endDay}: ${entry.workshopName}${entry.location && entry.location !== '(No Location)' ? ` — ${entry.location}` : ''}`
            : entry.location && entry.location !== '(No Location)'
              ? `${entry.workshopName} — ${entry.location}`
              : entry.workshopName;
          return [
            { text: nameText, bold: true, fontSize: 13, ...(isSplit && i > 0 ? { marginTop: 6 } : {}) },
            ...(entry.leader ? [{ text: entry.leader, fontSize: 11, color: META_COLOR, italics: true }] : []),
          ];
        });

        tableBody.push([timeCell, { stack: activityStack }]);
      } else if (ts.isCustom) {
        const isMeal = /breakfast|lunch|dinner/i.test(ts.periodKey);
        const activity = isMeal ? `${ts.displayName} - Dining Hall` : ts.displayName;
        tableBody.push([timeCell, { text: activity, fontSize: 13, color: META_COLOR }]);
      } else {
        tableBody.push([timeCell, { text: 'Free', fontSize: 13, italics: true, color: MUTED_COLOR }]);
      }
    }

    // Collect unique locations for this attendee (exclude placeholder)
    const locations = Array.from(new Set(s.entries.map((e) => e.location).filter((l) => l && l !== '(No Location)')));

    const mapDataUrl = await compositeMap(locations);

    content.push({
      stack: [
        { text: `${eventName} ${year}`, fontSize: 13, color: META_COLOR, marginBottom: 2 },
        { text: `Schedule for ${s.fullName}`, fontSize: 22, bold: true, marginBottom: 14 },
        {
          table: { headerRows: 1, widths: ['auto', '*'], body: tableBody },
          layout: indvLayout,
        },
        {
          image: mapDataUrl,
          width: 504,
          alignment: 'center',
          margin: [0, 12, 0, 0],
        },
      ],
      ...(idx > 0 ? { pageBreak: 'before' } : {}),
    });
  }

  pdfMake
    .createPdf({
      pageSize: 'LETTER',
      pageMargins: [54, 48, 54, 36],
      footer: (currentPage: number, pageCount: number) => ({
        text: `${eventName}  |  Page ${currentPage} of ${pageCount}`,
        alignment: 'center',
        fontSize: 9,
        color: META_COLOR,
        margin: [0, 12, 0, 0],
      }),
      content,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .download(`${eventName}_IndividualSchedules.pdf`);
}
