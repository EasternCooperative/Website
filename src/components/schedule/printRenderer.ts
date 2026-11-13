import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { formatTimeRange } from './timeUtils';
import type { TimeSlot } from './models';
import type { RosterEntry, IndividualSchedule, AttendeeScheduleEntry } from './scheduleBuilder';
import { compositeMap } from './mapCompositor';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(pdfMake as any).vfs = ((pdfFonts as any).pdfMake?.vfs ?? (pdfFonts as any).vfs) as Record<string, string>;

// The master schedule is no longer generated here — it is the printable HTML page
// at /events/<id>/schedule, rendered to a static PDF in CI (scripts/render-schedule-pdfs.mjs).
// This module keeps the attendee-specific outputs, which need pdfmake's per-page layout.

// ---------------------------------------------------------------------------
// Shared look
// ---------------------------------------------------------------------------
//
// These sheets are run off on whatever printer is at the venue, usually a
// black-and-white laser. So the palette is black and grays only, and nothing
// depends on a tint surviving: structure comes from rules, weight, and labels.
// The two fills are light enough to stay clean on a draft-mode printer.

const INK = '#000000';
const TEXT_SECONDARY = '#444444';
const TEXT_FAINT = '#767676';
const RULE = '#8c8c8c';
const RULE_LIGHT = '#bdbdbd';
const BAND_FILL = '#e4e4e4';
const BREAK_FILL = '#f1f1f1';

const PAGE_WIDTH = 612;
const MARGIN_X = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

const NO_LOCATION = '(No Location)';
const hasRoom = (location: string) => !!location && location !== NO_LOCATION;

/** "Days 1–2", or "Day 3" for a single day. */
function daysLabel(startDay: number, endDay: number): string {
  return startDay === endDay ? `Day ${startDay}` : `Days ${startDay}–${endDay}`;
}

/** Small letterspaced caps line used above each page title and for sub-row labels. */
function eyebrow(text: string, fontSize = 9.5): object {
  return { text: text.toUpperCase(), fontSize, bold: true, color: TEXT_SECONDARY, characterSpacing: 1 };
}

const TITLE_SIZE = 24;
const TITLE_MIN_SIZE = 15;
// Roboto Bold averages a little under 0.58em per character for names and titles.
const TITLE_CHAR_EM = 0.58;

/**
 * Shrinks a long title until it fits on one line. A wrapped attendee name costs a
 * whole line of height, which is enough to push the facility map off the page.
 */
function titleFontSize(title: string): number {
  const fits = Math.floor(CONTENT_WIDTH / (TITLE_CHAR_EM * Math.max(title.length, 1)));
  return Math.max(TITLE_MIN_SIZE, Math.min(TITLE_SIZE, fits));
}

function pageHeader(eventLabel: string, title: string, subtitle?: string): object[] {
  return [
    eyebrow(eventLabel),
    { text: title, fontSize: titleFontSize(title), bold: true, color: INK, margin: [0, 2, 0, subtitle ? 0 : 6] },
    ...(subtitle ? [{ text: subtitle, fontSize: 14, color: TEXT_SECONDARY, margin: [0, 1, 0, 6] }] : []),
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 1.5, lineColor: INK }] },
  ];
}

function pageFooter(eventLabel: string) {
  return (currentPage: number, pageCount: number) => ({
    text: `${eventLabel}  |  Page ${currentPage} of ${pageCount}`,
    alignment: 'center',
    fontSize: 9,
    color: TEXT_SECONDARY,
    margin: [0, 12, 0, 0],
  });
}

// ---------------------------------------------------------------------------
// Workshop Rosters
// ---------------------------------------------------------------------------

function rosterNameFontSize(fullName: string, counter: number): number {
  const len = `${counter}. ${fullName}`.length + 4; // + the check box
  if (len > 45) return 10;
  if (len > 35) return 11;
  if (len > 28) return 12;
  return 14;
}

const CHECK_BOX = 13;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rosterTableLayout: any = {
  paddingLeft: (i: number) => (i === 0 ? 0 : 5),
  paddingRight: () => 5,
  paddingTop: () => 8,
  paddingBottom: () => 8,
  // A hairline under every name keeps the eye on the right row when ticking boxes.
  hLineWidth: (i: number) => (i === 0 ? 0 : 0.5),
  hLineColor: () => RULE_LIGHT,
  vLineWidth: () => 0,
};

function rosterTable(items: Array<{ a: RosterEntry['attendees'][0]; counter: number }>): object {
  return {
    table: {
      widths: [CHECK_BOX + 2, 'auto', '*'],
      body: items.map(({ a, counter }) => {
        const fs = rosterNameFontSize(a.fullName, counter);
        // Text sits on a line box of ~1.17x its size; nudge the box down to the same optical centre.
        const boxOffset = Math.max(0, (fs * 1.17 - CHECK_BOX) / 2);
        return [
          {
            canvas: [{ type: 'rect', x: 0.5, y: 0.5, w: CHECK_BOX, h: CHECK_BOX, lineWidth: 1, lineColor: INK }],
            margin: [0, boxOffset, 0, 0],
          },
          { text: `${counter}.`, fontSize: fs, color: TEXT_SECONDARY, alignment: 'right' },
          { text: a.fullName, fontSize: fs, color: INK },
        ];
      }),
    },
    layout: rosterTableLayout,
  };
}

/** Period (with its clock time), room, day span, and head count in one filled band under the title. */
function rosterMetaBand(r: RosterEntry): object {
  const count = r.attendees.length;
  const isPartial = r.startDay != null && r.endDay != null && !(r.startDay === 1 && r.endDay === 4);
  const parts = [
    r.time ? `${r.period} (${r.time})` : r.period,
    ...(hasRoom(r.location) ? [r.location] : []),
    ...(isPartial ? [daysLabel(r.startDay!, r.endDay!)] : []),
    `${count} attendee${count !== 1 ? 's' : ''}`,
  ];
  return {
    table: {
      widths: ['*'],
      body: [[{ text: parts.join('   •   '), fontSize: 11.5, bold: true, color: INK, fillColor: BAND_FILL }]],
    },
    layout: {
      paddingLeft: () => 8,
      paddingRight: () => 8,
      paddingTop: () => 6,
      paddingBottom: () => 6,
      hLineWidth: () => 0,
      vLineWidth: () => 0,
    },
    margin: [0, 8, 0, 0],
  };
}

export function buildRostersDoc(rosters: RosterEntry[], eventLabel: string): object {
  const content: object[] = [];

  rosters.forEach((r, idx) => {
    let attendeeList: object;
    if (r.attendees.length === 0) {
      attendeeList = { text: 'No attendees', italics: true, color: TEXT_FAINT, margin: [0, 12, 0, 0] };
    } else {
      const indexed = r.attendees.map((a, i) => ({ a, counter: i + 1 }));
      const left = indexed.filter((_, i) => i % 2 === 0);
      const right = indexed.filter((_, i) => i % 2 === 1);
      attendeeList = {
        columns: right.length > 0 ? [rosterTable(left), rosterTable(right)] : [rosterTable(left)],
        columnGap: 24,
        margin: [0, 6, 0, 0],
      };
    }

    content.push({
      stack: [...pageHeader(eventLabel, r.workshopName, r.leader || undefined), rosterMetaBand(r), attendeeList],
      ...(idx > 0 ? { pageBreak: 'before' } : {}),
    });
  });

  return {
    pageSize: 'LETTER',
    pageMargins: [MARGIN_X, 54, MARGIN_X, 54],
    footer: pageFooter(eventLabel),
    content,
  };
}

/** `eventLabel` is the full name to print, year included (e.g. "Winter Adventure 2026"). */
export function downloadRosters(rosters: RosterEntry[], eventLabel: string): void {
  pdfMake
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .createPdf(buildRostersDoc(rosters, eventLabel) as any)
    .download(`${eventLabel}_Rosters.pdf`);
}

// ---------------------------------------------------------------------------
// Individual Schedules
// ---------------------------------------------------------------------------

type RowKind = 'header' | 'break' | 'class';

const STANDARD_HALVES: Array<[number, number]> = [
  [1, 2],
  [3, 4],
];
const isFullSpan = (e: AttendeeScheduleEntry) => e.startDay === 1 && e.endDay === 4;
const isStandardHalf = (e: AttendeeScheduleEntry) =>
  STANDARD_HALVES.some(([a, b]) => e.startDay === a && e.endDay === b);

function classCell(entry: AttendeeScheduleEntry | undefined, label?: string): object {
  const lines: object[] = [];
  if (label) lines.push(eyebrow(label, 8));
  if (entry) {
    lines.push({ text: entry.workshopName, bold: true, fontSize: 13, color: INK });
    if (entry.leader) lines.push({ text: entry.leader, fontSize: 10.5, italics: true, color: TEXT_SECONDARY });
  } else {
    lines.push({ text: 'Free', fontSize: 12, italics: true, color: TEXT_FAINT });
  }
  return { stack: lines };
}

function roomCell(entry: AttendeeScheduleEntry | undefined): object {
  return entry && hasRoom(entry.location)
    ? { text: entry.location, bold: true, fontSize: 12, color: INK }
    : { text: '' };
}

/**
 * One attendee's table. Returns the pdfmake body plus what each row is, so the
 * layout can pad class rows and break rows differently.
 */
function buildScheduleTable(
  s: IndividualSchedule,
  timeslots: TimeSlot[]
): { body: object[][]; kinds: RowKind[]; hasSplit: boolean } {
  const entryMap = new Map<string, AttendeeScheduleEntry[]>();
  for (const entry of s.entries) {
    const existing = entryMap.get(entry.periodKey) ?? [];
    existing.push(entry);
    entryMap.set(entry.periodKey, existing);
  }

  const headerCell = (text: string) => ({
    text: text.toUpperCase(),
    bold: true,
    fontSize: 9,
    color: INK,
    characterSpacing: 0.8,
    fillColor: BAND_FILL,
  });
  const body: object[][] = [[headerCell('Time'), headerCell('Class'), headerCell('Room')]];
  const kinds: RowKind[] = ['header'];
  let hasSplit = false;

  for (const ts of timeslots) {
    const entries = [...(entryMap.get(ts.periodKey) ?? [])].sort((a, b) => a.startDay - b.startDay);
    const timeStr = formatTimeRange(ts.startTime, ts.endTime);
    // A time range must never wrap ("10:50 AM - 12:30" / "PM"); a label fallback may.
    const timeCell = (extra: object = {}) => ({
      text: timeStr || ts.displayName,
      fontSize: 11,
      bold: true,
      color: INK,
      noWrap: !!timeStr,
      ...extra,
    });

    if (entries.length > 0 && entries.every(isFullSpan)) {
      // The usual case: one class for the whole event.
      entries.forEach((entry, i) => {
        body.push([i === 0 ? timeCell({ rowSpan: entries.length }) : {}, classCell(entry), roomCell(entry)]);
        kinds.push('class');
      });
    } else if (entries.length > 0) {
      // Part-event classes. Label every sub-row with its days, and when the
      // attendee has only one half, say the other half is free: a lone
      // "Days 1–2" class otherwise reads as running all four days.
      hasSplit = true;
      const subRows: Array<{ label: string; entry?: AttendeeScheduleEntry }> = entries.every(isStandardHalf)
        ? STANDARD_HALVES.map(([a, b]) => ({
            label: daysLabel(a, b),
            entry: entries.find((e) => e.startDay === a && e.endDay === b),
          }))
        : entries.map((entry) => ({ label: daysLabel(entry.startDay, entry.endDay), entry }));

      subRows.forEach(({ label, entry }, i) => {
        body.push([i === 0 ? timeCell({ rowSpan: subRows.length }) : {}, classCell(entry, label), roomCell(entry)]);
        kinds.push('class');
      });
    } else if (ts.isCustom) {
      const isMeal = /breakfast|lunch|dinner/i.test(ts.periodKey);
      const cell = { fontSize: 11, color: TEXT_SECONDARY, fillColor: BREAK_FILL };
      body.push([
        timeCell({ bold: false, color: TEXT_SECONDARY, fillColor: BREAK_FILL }),
        { text: ts.displayName, bold: true, ...cell },
        { text: isMeal ? 'Dining Hall' : '', ...cell },
      ]);
      kinds.push('break');
    } else {
      body.push([timeCell(), classCell(undefined), roomCell(undefined)]);
      kinds.push('class');
    }
  }

  return { body, kinds, hasSplit };
}

// How tightly a schedule has to be set so the facility map stays on its page.
// Sub-rows for split periods add up to three rows over the usual layout: one or
// two are absorbed by tighter class rows, and a fully split schedule also trims
// the break rows and the map.
type Density = 'roomy' | 'tight' | 'tightest';
const MAX_ROOMY_CLASS_ROWS = 5;

function scheduleDensity(kinds: RowKind[], hasSplit: boolean): Density {
  if (!hasSplit) return 'roomy';
  return kinds.filter((k) => k === 'class').length > MAX_ROOMY_CLASS_ROWS ? 'tightest' : 'tight';
}

const CLASS_ROW_PAD: Record<Density, number> = { roomy: 8, tight: 4, tightest: 3 };
const BREAK_ROW_PAD: Record<Density, number> = { roomy: 4, tight: 4, tightest: 3 };
const MAP_WIDTH: Record<Density, number> = { roomy: CONTENT_WIDTH, tight: CONTENT_WIDTH, tightest: 450 };

// Called with no row index (e.g. from a test) the padding reports the class-row value.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scheduleTableLayout(kinds: RowKind[], density: Density): any {
  const pad = (i?: number) => {
    const kind = i == null ? 'class' : kinds[i];
    return kind === 'class' ? CLASS_ROW_PAD[density] : BREAK_ROW_PAD[density];
  };
  return {
    paddingLeft: () => 8,
    paddingRight: () => 8,
    paddingTop: pad,
    paddingBottom: pad,
    hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
      i === 0 || i === node.table.body.length ? 1 : 0.5,
    hLineColor: (i: number, node: { table: { body: unknown[] } }) =>
      i === 0 || i === node.table.body.length ? INK : RULE,
    vLineWidth: (i: number, node: { table: { widths: unknown[] } }) =>
      i === 0 || i === node.table.widths.length ? 1 : 0.5,
    vLineColor: (i: number, node: { table: { widths: unknown[] } }) =>
      i === 0 || i === node.table.widths.length ? INK : RULE_LIGHT,
  };
}

export async function buildIndividualSchedulesDoc(
  schedules: IndividualSchedule[],
  timeslots: TimeSlot[],
  eventLabel: string
): Promise<object> {
  const content: object[] = [];

  for (const [idx, s] of schedules.entries()) {
    const { body, kinds, hasSplit } = buildScheduleTable(s, timeslots);
    const density = scheduleDensity(kinds, hasSplit);

    // Collect unique locations for this attendee (exclude placeholder)
    const locations = Array.from(new Set(s.entries.map((e) => e.location).filter(hasRoom)));
    const mapSvg = await compositeMap(locations);

    content.push({
      stack: [
        ...pageHeader(eventLabel, s.fullName),
        {
          table: { headerRows: 1, widths: ['auto', '*', 'auto'], body },
          layout: scheduleTableLayout(kinds, density),
          margin: [0, 10, 0, 0],
        },
        {
          svg: mapSvg,
          width: MAP_WIDTH[density],
          alignment: 'center',
          margin: [0, 8, 0, 0],
        },
        // Legend: every evacuation-style map explains its symbols. Only shown when rooms are highlighted.
        ...(locations.length > 0
          ? [
              {
                columns: [
                  { canvas: [{ type: 'rect', x: 0, y: 1, w: 11, h: 11, color: '#222222' }], width: 17 },
                  { text: 'Rooms where your classes meet', fontSize: 10, color: TEXT_SECONDARY },
                ],
                margin: [0, 2, 0, 0],
              },
            ]
          : []),
      ],
      ...(idx > 0 ? { pageBreak: 'before' } : {}),
    });
  }

  return {
    pageSize: 'LETTER',
    pageMargins: [MARGIN_X, 44, MARGIN_X, 36],
    footer: pageFooter(eventLabel),
    content,
  };
}

/** `eventLabel` is the full name to print, year included (e.g. "Winter Adventure 2026"). */
export async function downloadIndividualSchedules(
  schedules: IndividualSchedule[],
  timeslots: TimeSlot[],
  eventLabel: string
): Promise<void> {
  const doc = await buildIndividualSchedulesDoc(schedules, timeslots, eventLabel);
  pdfMake
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .createPdf(doc as any)
    .download(`${eventLabel}_IndividualSchedules.pdf`);
}
