import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreatePdf, mockDownload, mockCompositeMap } = vi.hoisted(() => {
  const mockDownload = vi.fn();
  const mockCreatePdf = vi.fn().mockReturnValue({ download: mockDownload });
  const mockCompositeMap = vi.fn().mockResolvedValue('<svg>MOCK</svg>');
  return { mockCreatePdf, mockDownload, mockCompositeMap };
});

vi.mock('pdfmake/build/pdfmake', () => ({
  default: { vfs: {}, createPdf: mockCreatePdf },
}));

vi.mock('pdfmake/build/vfs_fonts', () => ({
  default: { pdfMake: { vfs: {} } },
}));

vi.mock('~/components/schedule/mapCompositor', () => ({
  compositeMap: mockCompositeMap,
}));

import {
  downloadRosters,
  downloadIndividualSchedules,
  buildRostersDoc,
  buildIndividualSchedulesDoc,
} from '~/components/schedule/printRenderer';
import type { RosterEntry, IndividualSchedule } from '~/components/schedule/scheduleBuilder';
import type { TimeSlot } from '~/components/schedule/models';

const timeslots: TimeSlot[] = [
  { periodKey: 'MorningFirstPeriod', displayName: 'Morning First Period', startTime: '09:00', endTime: '10:40' },
  { periodKey: 'custom-lunch', displayName: 'Lunch', startTime: '12:45', endTime: '13:30', isCustom: true },
  { periodKey: 'custom-free-time', displayName: 'Free Time', startTime: '13:30', endTime: '15:45', isCustom: true },
  { periodKey: 'AfternoonPeriod', displayName: 'Afternoon Period', startTime: '15:45', endTime: '17:45' },
  { periodKey: 'custom-dinner', displayName: 'Dinner', startTime: '18:00', endTime: '19:00', isCustom: true },
];

describe('downloadRosters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreatePdf.mockReturnValue({ download: mockDownload });
  });

  const rosters: RosterEntry[] = [
    {
      workshopName: 'Woodworking',
      leader: 'John Smith',
      location: 'Chapel A',
      period: 'Morning First Period',
      attendees: [
        { fullName: 'Ali', age: '25' },
        { fullName: 'Christopher Alexander Williamson-Thompson Jr', age: '30' },
        { fullName: 'Alexander Williamson', age: '28' },
        { fullName: 'Christopher Alexander', age: '22' },
      ],
    },
  ];

  it('calls createPdf and download', () => {
    downloadRosters(rosters, 'Winter Adventure');
    expect(mockCreatePdf).toHaveBeenCalledOnce();
    expect(mockDownload).toHaveBeenCalledOnce();
  });

  it('handles a roster with no attendees', () => {
    const emptyRoster: RosterEntry[] = [
      { workshopName: 'Empty Workshop', leader: '', location: 'Library', period: 'Afternoon Period', attendees: [] },
    ];
    downloadRosters(emptyRoster, 'Winter Adventure');
    expect(mockCreatePdf).toHaveBeenCalledOnce();
  });

  it('handles a roster with a single attendee (no right column)', () => {
    const singleAttendee: RosterEntry[] = [
      {
        workshopName: 'Solo Workshop',
        leader: 'Jane',
        location: 'Martin Room',
        period: 'Morning First Period',
        attendees: [{ fullName: 'Alice Johnson', age: '25' }],
      },
    ];
    downloadRosters(singleAttendee, 'Winter Adventure');
    expect(mockCreatePdf).toHaveBeenCalledOnce();
  });

  it('handles multiple rosters (adds pageBreak after first)', () => {
    const multiRosters: RosterEntry[] = [
      ...rosters,
      {
        workshopName: 'Pottery',
        leader: 'Jane Doe',
        location: 'Library',
        period: 'Afternoon Period',
        attendees: [{ fullName: 'Carol Davis', age: '28' }],
      },
    ];
    downloadRosters(multiRosters, 'Winter Adventure');
    expect(mockCreatePdf).toHaveBeenCalledOnce();
  });

  it('handles a roster entry without a leader', () => {
    const noLeader: RosterEntry[] = [
      {
        workshopName: 'Open Workshop',
        leader: '',
        location: 'Elm Room',
        period: 'Morning First Period',
        attendees: [{ fullName: 'Alice Johnson', age: '' }],
      },
    ];
    downloadRosters(noLeader, 'Winter Adventure');
    expect(mockCreatePdf).toHaveBeenCalledOnce();
  });

  it('shows the class time next to the period name when one is set', () => {
    downloadRosters([{ ...rosters[0], time: '9:15 AM - 10:45 AM' }, rosters[0]], 'Winter Adventure');
    const doc = JSON.stringify(mockCreatePdf.mock.calls[0][0]);
    expect(doc).toContain('Morning First Period (9:15 AM - 10:45 AM)   •   Chapel A');
    // Without a time the header keeps the period name alone.
    expect(doc).toContain('Morning First Period   •   Chapel A');
  });
});

describe('downloadIndividualSchedules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreatePdf.mockReturnValue({ download: mockDownload });
  });

  it('calls createPdf, download, and compositeMap', async () => {
    const schedules: IndividualSchedule[] = [
      {
        fullName: 'Alice Johnson',
        email: 'alice@example.com',
        age: '25',
        entries: [
          {
            periodKey: 'MorningFirstPeriod',
            periodDisplay: 'Morning First Period',
            workshopName: 'Woodworking',
            leader: 'John Smith',
            location: 'Chapel A',
            startDay: 1,
            endDay: 4,
          },
        ],
      },
    ];
    await downloadIndividualSchedules(schedules, timeslots, 'Winter Adventure');
    expect(mockCreatePdf).toHaveBeenCalledOnce();
    expect(mockDownload).toHaveBeenCalledOnce();
    expect(mockCompositeMap).toHaveBeenCalledOnce();
  });

  it('adds a legend under the map only when rooms are highlighted', async () => {
    const entry = {
      periodKey: 'MorningFirstPeriod',
      periodDisplay: 'Morning First Period',
      workshopName: 'Woodworking',
      leader: '',
      startDay: 1,
      endDay: 4,
    };
    const schedules: IndividualSchedule[] = [
      { fullName: 'With Rooms', email: '', age: '', entries: [{ ...entry, location: 'Chapel A' }] },
      { fullName: 'No Rooms', email: '', age: '', entries: [{ ...entry, location: '(No Location)' }] },
    ];
    await downloadIndividualSchedules(schedules, timeslots, 'Winter Adventure');
    const doc = mockCreatePdf.mock.calls[0][0];
    const hasLegend = (i: number) => doc.content[i].stack.some((n: { columns?: unknown }) => n.columns);
    expect(hasLegend(0)).toBe(true);
    expect(hasLegend(1)).toBe(false);
    expect(doc.content[0].stack.some((n: { svg?: string }) => n.svg === '<svg>MOCK</svg>')).toBe(true);
  });

  it('renders Free rows for regular timeslots with no entry', async () => {
    const schedules: IndividualSchedule[] = [{ fullName: 'Alice Johnson', email: '', age: '', entries: [] }];
    await downloadIndividualSchedules(schedules, timeslots, 'Winter Adventure');
    expect(mockCreatePdf).toHaveBeenCalledOnce();
  });

  it('renders meal rows and non-meal custom rows', async () => {
    const schedules: IndividualSchedule[] = [{ fullName: 'Alice Johnson', email: '', age: '', entries: [] }];
    const slotsWithVariety: TimeSlot[] = [
      { periodKey: 'custom-breakfast', displayName: 'Breakfast', startTime: '08:00', endTime: '09:00', isCustom: true },
      { periodKey: 'custom-free-time', displayName: 'Free Time', startTime: '13:30', endTime: '15:45', isCustom: true },
    ];
    await downloadIndividualSchedules(schedules, slotsWithVariety, 'Winter Adventure');
    expect(mockCreatePdf).toHaveBeenCalledOnce();
  });

  it('uses tighter row padding for split-period schedules so the map stays on the page', async () => {
    const entry = (startDay: number, endDay: number) => ({
      periodKey: 'MorningFirstPeriod',
      periodDisplay: 'Morning First Period',
      workshopName: 'Woodworking',
      leader: 'John Smith',
      location: 'Chapel A',
      startDay,
      endDay,
    });
    const schedules: IndividualSchedule[] = [
      { fullName: 'Whole Week', email: '', age: '', entries: [entry(1, 4)] },
      { fullName: 'Split Week', email: '', age: '', entries: [entry(1, 2), entry(3, 4)] },
    ];
    await downloadIndividualSchedules(schedules, timeslots, 'Winter Adventure');
    const doc = mockCreatePdf.mock.calls[0][0];
    const padding = (i: number) => doc.content[i].stack.find((n: { table?: object }) => n.table).layout.paddingTop();
    expect(padding(1)).toBeLessThan(padding(0));
  });

  it('renders split-day workshop entries (days 1-2 and 3-4 in same period)', async () => {
    const schedules: IndividualSchedule[] = [
      {
        fullName: 'Bob Williams',
        email: '',
        age: '',
        entries: [
          {
            periodKey: 'MorningFirstPeriod',
            periodDisplay: 'Morning First Period',
            workshopName: 'Woodworking',
            leader: 'John Smith',
            location: 'Chapel A',
            startDay: 1,
            endDay: 2,
          },
          {
            periodKey: 'MorningFirstPeriod',
            periodDisplay: 'Morning First Period',
            workshopName: 'Pottery',
            leader: 'Jane Doe',
            location: 'Library',
            startDay: 3,
            endDay: 4,
          },
        ],
      },
    ];
    await downloadIndividualSchedules(schedules, timeslots, 'Winter Adventure');
    expect(mockCreatePdf).toHaveBeenCalledOnce();
  });

  it('renders entry with no-location placeholder without appending location', async () => {
    const schedules: IndividualSchedule[] = [
      {
        fullName: 'Carol Davis',
        email: '',
        age: '',
        entries: [
          {
            periodKey: 'MorningFirstPeriod',
            periodDisplay: 'Morning First Period',
            workshopName: 'Yoga',
            leader: '',
            location: '(No Location)',
            startDay: 1,
            endDay: 4,
          },
        ],
      },
    ];
    await downloadIndividualSchedules(schedules, timeslots, 'Winter Adventure');
    expect(mockCreatePdf).toHaveBeenCalledOnce();
  });

  it('handles multiple attendees (pageBreak on non-first pages)', async () => {
    const schedules: IndividualSchedule[] = [
      {
        fullName: 'Alice Johnson',
        email: '',
        age: '',
        entries: [
          {
            periodKey: 'MorningFirstPeriod',
            periodDisplay: 'Morning First Period',
            workshopName: 'Woodworking',
            leader: '',
            location: 'Chapel A',
            startDay: 1,
            endDay: 4,
          },
        ],
      },
      {
        fullName: 'Bob Williams',
        email: '',
        age: '',
        entries: [],
      },
    ];
    await downloadIndividualSchedules(schedules, timeslots, 'Winter Adventure');
    expect(mockCreatePdf).toHaveBeenCalledOnce();
    expect(mockCompositeMap).toHaveBeenCalledTimes(2);
  });

  it('renders entry with a leader on a separate line', async () => {
    const schedules: IndividualSchedule[] = [
      {
        fullName: 'Alice Johnson',
        email: '',
        age: '',
        entries: [
          {
            periodKey: 'AfternoonPeriod',
            periodDisplay: 'Afternoon Period',
            workshopName: 'Painting',
            leader: 'Bob Artist',
            location: 'Library',
            startDay: 1,
            endDay: 4,
          },
        ],
      },
    ];
    await downloadIndividualSchedules(schedules, timeslots, 'Winter Adventure');
    expect(mockCreatePdf).toHaveBeenCalledOnce();
  });
});

describe('document content', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreatePdf.mockReturnValue({ download: mockDownload });
  });

  const text = (doc: unknown) => JSON.stringify(doc);

  it('prints the label it is given and never appends the current year', async () => {
    const schedules: IndividualSchedule[] = [{ fullName: 'Alice Johnson', email: '', age: '', entries: [] }];
    await downloadIndividualSchedules(schedules, timeslots, 'Winter Adventure 2026');
    const doc = mockCreatePdf.mock.calls[0][0];
    expect(text(doc.content)).toContain('WINTER ADVENTURE 2026');
    expect(text(doc.content)).not.toContain(`2026 ${new Date().getFullYear()}`);
    expect(mockDownload).toHaveBeenCalledWith('Winter Adventure 2026_IndividualSchedules.pdf');
  });

  it('labels a lone half-event class with its days and marks the other half free', async () => {
    const schedules: IndividualSchedule[] = [
      {
        fullName: 'Half Timer',
        email: '',
        age: '',
        entries: [
          {
            periodKey: 'MorningFirstPeriod',
            periodDisplay: 'Morning First Period',
            workshopName: 'Chair Yoga',
            leader: '',
            location: 'Elm Room',
            startDay: 1,
            endDay: 2,
          },
        ],
      },
    ];
    await downloadIndividualSchedules(schedules, timeslots, 'Winter Adventure 2026');
    const table = mockCreatePdf.mock.calls[0][0].content[0].stack.find((n: { table?: object }) => n.table).table;
    const morning = text(table.body.slice(1, 3));
    expect(morning).toContain('DAYS 1–2');
    expect(morning).toContain('Chair Yoga');
    expect(morning).toContain('DAYS 3–4');
    expect(morning).toContain('Free');
    // the time cell spans both sub-rows
    expect(table.body[1][0].rowSpan).toBe(2);
  });

  it('keeps time ranges on one line and puts the room in its own column', async () => {
    const schedules: IndividualSchedule[] = [
      {
        fullName: 'Alice Johnson',
        email: '',
        age: '',
        entries: [
          {
            periodKey: 'MorningFirstPeriod',
            periodDisplay: 'Morning First Period',
            workshopName: 'Woodworking',
            leader: 'John Smith',
            location: 'Chapel A',
            startDay: 1,
            endDay: 4,
          },
        ],
      },
    ];
    await downloadIndividualSchedules(schedules, timeslots, 'Winter Adventure 2026');
    const table = mockCreatePdf.mock.calls[0][0].content[0].stack.find((n: { table?: object }) => n.table).table;
    expect(table.body[1][0]).toMatchObject({ text: '9:00 AM - 10:40 AM', noWrap: true });
    expect(table.body[1][2]).toMatchObject({ text: 'Chapel A' });
  });

  it('uses only black and gray, so nothing depends on a colour printer', async () => {
    const schedules: IndividualSchedule[] = [{ fullName: 'Alice Johnson', email: '', age: '', entries: [] }];
    await downloadIndividualSchedules(schedules, timeslots, 'Winter Adventure 2026');
    downloadRosters(
      [
        {
          workshopName: 'Woodworking',
          leader: 'John Smith',
          location: 'Chapel A',
          period: 'Morning First Period',
          attendees: [{ fullName: 'Alice Johnson', age: '' }],
        },
      ],
      'Winter Adventure 2026'
    );
    const colours = mockCreatePdf.mock.calls.flatMap((call) => text(call[0]).match(/#[0-9a-fA-F]{6}/g) ?? []);
    expect(colours.length).toBeGreaterThan(0);
    for (const c of colours) {
      const [r, g, b] = [c.slice(1, 3), c.slice(3, 5), c.slice(5, 7)];
      expect(r === g && g === b, `${c} is not a gray`).toBe(true);
    }
  });

  it('draws roster check boxes and shows the day span of a half-event class, without the no-room placeholder', () => {
    downloadRosters(
      [
        {
          workshopName: 'Chair Yoga',
          leader: 'Judi',
          location: '(No Location)',
          period: 'Morning First Period',
          startDay: 3,
          endDay: 4,
          attendees: [{ fullName: 'Alice Johnson', age: '' }],
        },
      ],
      'Winter Adventure 2026'
    );
    const doc = text(mockCreatePdf.mock.calls[0][0].content);
    expect(doc).toContain('"type":"rect"');
    expect(doc).not.toContain('[      ]');
    expect(doc).toContain('Days 3–4');
    expect(doc).not.toContain('(No Location)');
  });
});

// pdfmake calls the layout and footer callbacks itself while rendering; the mock
// never does, so these tests call them the way it would.
type Layout = Record<string, (...args: unknown[]) => unknown>;
type Doc = { footer: (page: number, count: number) => { text: string }; content: { stack: object[] }[] };

function findAll(node: unknown, pick: (n: Record<string, unknown>) => boolean, out: Record<string, unknown>[] = []) {
  if (Array.isArray(node)) node.forEach((n) => findAll(n, pick, out));
  else if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (pick(obj)) out.push(obj);
    Object.values(obj).forEach((v) => findAll(v, pick, out));
  }
  return out;
}

const entry = (over: Partial<IndividualSchedule['entries'][number]> = {}) => ({
  periodKey: 'MorningFirstPeriod',
  periodDisplay: 'Morning First Period',
  workshopName: 'Woodworking',
  leader: 'John Smith',
  location: 'Chapel A',
  startDay: 1,
  endDay: 4,
  ...over,
});

describe('rosters document', () => {
  const roster = (names: string[], extra: Partial<RosterEntry> = {}): RosterEntry => ({
    workshopName: 'Woodworking',
    leader: 'John Smith',
    location: 'Chapel A',
    period: 'Morning First Period',
    attendees: names.map((fullName) => ({ fullName, age: '' })),
    ...extra,
  });

  it('numbers the footer pages with the event label', () => {
    const doc = buildRostersDoc([roster(['Ali'])], 'Winter Adventure 2026') as Doc;
    expect(doc.footer(2, 5).text).toBe('Winter Adventure 2026  |  Page 2 of 5');
  });

  it('shrinks long names so they stay on one line', () => {
    const names = ['Al', 'A'.repeat(14), 'B'.repeat(22), 'C'.repeat(32), 'D'.repeat(45)];
    const doc = buildRostersDoc([roster(names)], 'Winter Adventure 2026');
    const sizeOf = (name: string) => findAll(doc, (n) => n.text === name)[0].fontSize;
    // "<n>. <name>" plus the check box: under 29 characters is full size, then 12, 11, and 10 from 46
    expect(names.map(sizeOf)).toEqual([14, 14, 12, 11, 10]);
  });

  it('lays out the name tables and the meta band with hairlines only between names', () => {
    const doc = buildRostersDoc([roster(['Ali', 'Bo', 'Cy'])], 'WA');
    const layouts = findAll(doc, (n) => !!n.layout && typeof n.layout === 'object').map((n) => n.layout as Layout);
    expect(layouts.length).toBeGreaterThanOrEqual(3);
    const names = layouts.find((l) => l.hLineWidth(0) === 0 && l.hLineWidth(1) === 0.5)!;
    expect([
      names.paddingLeft(0),
      names.paddingLeft(1),
      names.paddingRight(),
      names.paddingTop(),
      names.paddingBottom(),
    ]).toEqual([0, 5, 5, 8, 8]);
    expect([names.hLineColor(), names.vLineWidth()]).toEqual(['#bdbdbd', 0]);
    const band = layouts.find((l) => l.hLineWidth(0) === 0 && l.paddingTop() === 6)!;
    expect([band.paddingLeft(), band.paddingRight(), band.paddingBottom(), band.vLineWidth()]).toEqual([8, 8, 6, 0]);
  });

  it('names the day span only for part-event classes', () => {
    const band = (extra: Partial<RosterEntry>) => JSON.stringify(buildRostersDoc([roster(['Ali'], extra)], 'WA'));
    expect(band({ startDay: 1, endDay: 4 })).not.toContain('Days 1');
    expect(band({ startDay: 3, endDay: 3 })).toContain('Day 3');
    expect(band({})).not.toContain('Day ');
  });

  it('says so when nobody is signed up', () => {
    const doc = buildRostersDoc([roster([])], 'WA');
    expect(JSON.stringify(doc)).toContain('No attendees');
  });
});

describe('individual schedules document', () => {
  const schedule = (entries: IndividualSchedule['entries'], fullName = 'Alice Johnson'): IndividualSchedule => ({
    fullName,
    email: '',
    age: '',
    entries,
  });
  const tableOf = (doc: Doc) =>
    findAll(doc.content[0], (n) => !!n.table && !!n.layout)[0] as {
      table: { body: unknown[][]; widths: unknown[] };
      layout: Layout;
    };

  it('numbers the footer pages with the event label', async () => {
    const doc = (await buildIndividualSchedulesDoc([schedule([])], timeslots, 'Winter Adventure 2026')) as Doc;
    expect(doc.footer(1, 3).text).toBe('Winter Adventure 2026  |  Page 1 of 3');
  });

  it('draws heavy outer rules and light inner rules on the schedule table', async () => {
    const doc = (await buildIndividualSchedulesDoc([schedule([entry()])], timeslots, 'WA')) as Doc;
    const { table, layout } = tableOf(doc);
    const last = table.body.length;
    const node = { table: { body: table.body, widths: table.widths } };
    expect([layout.hLineWidth(0, node), layout.hLineWidth(1, node), layout.hLineWidth(last, node)]).toEqual([
      1, 0.5, 1,
    ]);
    expect([layout.hLineColor(0, node), layout.hLineColor(1, node)]).toEqual(['#000000', '#8c8c8c']);
    const edge = table.widths.length;
    expect([layout.vLineWidth(0, node), layout.vLineWidth(1, node), layout.vLineWidth(edge, node)]).toEqual([
      1, 0.5, 1,
    ]);
    expect([layout.vLineColor(0, node), layout.vLineColor(1, node)]).toEqual(['#000000', '#bdbdbd']);
    expect([layout.paddingLeft(), layout.paddingRight()]).toEqual([8, 8]);
  });

  it('pads class rows more than break rows, and tightens as periods split', async () => {
    const whole = (await buildIndividualSchedulesDoc([schedule([entry()])], timeslots, 'WA')) as Doc;
    const wholeLayout = tableOf(whole).layout;
    // body row 0 is the header, row 1 a class, row 2 a meal break
    expect(wholeLayout.paddingTop(1)).toBe(8);
    expect(wholeLayout.paddingTop(2)).toBe(4);
    expect(wholeLayout.paddingBottom(1)).toBe(8);

    // every non-break period split in two: more than five class rows, tightest packing
    const manyPeriods: TimeSlot[] = ['a', 'b', 'c'].map((k, i) => ({
      periodKey: `p${k}`,
      displayName: `Period ${k}`,
      startTime: `${9 + i * 2}:00`,
      endTime: `${10 + i * 2}:30`,
    }));
    const split = schedule(
      manyPeriods.flatMap((t) => [
        entry({ periodKey: t.periodKey, startDay: 1, endDay: 2 }),
        entry({ periodKey: t.periodKey, workshopName: 'Pottery', startDay: 3, endDay: 4 }),
      ])
    );
    const tight = (await buildIndividualSchedulesDoc([split], manyPeriods, 'WA')) as Doc;
    const tightLayout = tableOf(tight).layout;
    expect(tightLayout.paddingTop(1)).toBe(3);
    expect(tightLayout.paddingTop(7)).toBe(3);
    const map = findAll(tight, (n) => typeof n.svg === 'string')[0];
    expect(map.width).toBe(450);
  });

  it('lists non-standard day spans as they are instead of forcing two halves', async () => {
    const odd = schedule([
      entry({ startDay: 2, endDay: 3 }),
      entry({ workshopName: 'Pottery', startDay: 4, endDay: 4 }),
    ]);
    const doc = (await buildIndividualSchedulesDoc([odd], timeslots, 'WA')) as Doc;
    const text = JSON.stringify(tableOf(doc).table.body);
    expect(text).toContain('DAYS 2–3');
    expect(text).toContain('DAY 4');
    expect(text).not.toContain('DAYS 1–2');
  });

  it('stacks two whole-event classes in one period under a single time cell', async () => {
    const two = schedule([entry(), entry({ workshopName: 'Pottery' })]);
    const doc = (await buildIndividualSchedulesDoc([two], timeslots, 'WA')) as Doc;
    const body = tableOf(doc).table.body as { rowSpan?: number }[][];
    expect(body[1][0].rowSpan).toBe(2);
    expect(JSON.stringify(body)).toContain('Pottery');
  });

  it('shows the period name when a timeslot has no times', async () => {
    const untimed: TimeSlot[] = [
      { periodKey: 'MorningFirstPeriod', displayName: 'Morning First Period', startTime: '', endTime: '' },
    ];
    const doc = (await buildIndividualSchedulesDoc([schedule([])], untimed, 'WA')) as Doc;
    const time = (tableOf(doc).table.body[1] as { text?: string; noWrap?: boolean }[])[0];
    expect(time).toMatchObject({ text: 'Morning First Period', noWrap: false });
  });

  it('shrinks a long attendee name to stay on one line', async () => {
    const name = 'Maximiliana Josephine Vandenberg-Castellanos';
    const doc = (await buildIndividualSchedulesDoc([schedule([], name)], timeslots, 'WA')) as Doc;
    const title = findAll(doc, (n) => n.text === name)[0];
    expect(title.fontSize).toBeLessThan(24);
    expect(title.fontSize as number).toBeGreaterThanOrEqual(15);
    const short = (await buildIndividualSchedulesDoc([schedule([], 'Al')], timeslots, 'WA')) as Doc;
    expect(findAll(short, (n) => n.text === 'Al')[0].fontSize).toBe(24);
  });
});
