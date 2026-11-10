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

import { downloadRosters, downloadIndividualSchedules } from '~/components/schedule/printRenderer';
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
