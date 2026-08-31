import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreatePdf, mockDownload, mockCompositeMap } = vi.hoisted(() => {
  const mockDownload = vi.fn();
  const mockCreatePdf = vi.fn().mockReturnValue({ download: mockDownload });
  const mockCompositeMap = vi.fn().mockResolvedValue('data:image/png;base64,MOCK');
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
