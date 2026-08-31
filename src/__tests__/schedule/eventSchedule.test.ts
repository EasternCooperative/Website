import { describe, it, expect, vi } from 'vitest';
import {
  slugifyPeriod,
  parseDays,
  formatScheduleHeading,
  hasMasterSchedule,
  buildEventMasterSchedule,
  baseEventTitle,
  venueScheduleMapPath,
  type EventScheduleData,
} from '~/utils/eventSchedule';

const leaderMap = new Map<string, { name: string }>([
  ['pat', { name: 'Pat Williams' }],
  ['kim', { name: 'Kim Neubauer' }],
]);

const timeslots = [
  { label: 'Breakfast', start: '08:00', end: '09:00', isBreak: true },
  { label: 'Morning, first period', start: '09:00', end: '10:40' },
  { label: 'Afternoon', start: '15:45', end: '17:45' },
];

function makeEvent(overrides: Partial<EventScheduleData> = {}): EventScheduleData {
  return {
    date: new Date('2026-12-27T00:00:00Z'),
    endDate: new Date('2026-12-30T00:00:00Z'),
    schedule: { timeslots },
    classes: [
      { name: 'Folk Dance', leaderId: 'pat', period: 'Morning, first period', days: 'All 4 days', room: 'Rec Hall' },
      { name: 'Chair Yoga', leaderId: 'kim', period: 'Morning, First Period', days: 'Days 1–2', room: 'Elm Room' },
      { name: 'Improv', period: 'Afternoon', days: 'Days 3–4', room: 'Library' },
    ],
    ...overrides,
  };
}

describe('baseEventTitle', () => {
  it('strips a trailing year but leaves other text alone', () => {
    expect(baseEventTitle('Winter Adventure 2026')).toBe('Winter Adventure');
    expect(baseEventTitle('Winter Adventure')).toBe('Winter Adventure');
    expect(baseEventTitle('ECRS Fun Day in Wilmington')).toBe('ECRS Fun Day in Wilmington');
  });
});

describe('venueScheduleMapPath', () => {
  it('returns the Watson floor plan only for that site', () => {
    expect(venueScheduleMapPath('the-y-at-watson-woods')).toBe('/maps/watson_layout.png');
    expect(venueScheduleMapPath('mid-county-center')).toBeNull();
    expect(venueScheduleMapPath(undefined)).toBeNull();
  });
});

describe('slugifyPeriod', () => {
  it('collapses case, punctuation and whitespace to a stable key', () => {
    expect(slugifyPeriod('Morning, first period')).toBe('morning-first-period');
    expect(slugifyPeriod('Morning, First Period')).toBe(slugifyPeriod('Morning, first period'));
    expect(slugifyPeriod('  Games!  ')).toBe('games');
  });
});

describe('parseDays', () => {
  it('maps known values onto the three day-buckets', () => {
    expect(parseDays(undefined)).toEqual({ startDay: 1, endDay: 4 });
    expect(parseDays('All 4 days')).toEqual({ startDay: 1, endDay: 4 });
    expect(parseDays('Days 1–2')).toEqual({ startDay: 1, endDay: 2 }); // en-dash
    expect(parseDays('Days 3-4')).toEqual({ startDay: 3, endDay: 4 });
  });

  it('warns and falls back to full span for anything else', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseDays('Day 2 only')).toEqual({ startDay: 1, endDay: 4 });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('formatScheduleHeading', () => {
  it('is the bare period when there is no timeslot', () => {
    expect(formatScheduleHeading('Morning, first period', undefined, undefined, true)).toBe('Morning, first period');
  });

  it('adds the time range when the timeslot has times', () => {
    expect(
      formatScheduleHeading('Morning, first period', { label: 'x', start: '09:00', end: '10:40' }, undefined, false)
    ).toBe('Morning, first period · 9:00 AM - 10:40 AM');
  });

  it('adds days only for multi-day events when provided', () => {
    expect(formatScheduleHeading('Games', undefined, 'Days 1–2', true)).toBe('Games · Days 1–2');
    expect(formatScheduleHeading('Games', undefined, 'Days 1–2', false)).toBe('Games');
  });
});

describe('hasMasterSchedule', () => {
  it('is false without a timeslot block', () => {
    expect(hasMasterSchedule(makeEvent({ schedule: undefined })).ok).toBe(false);
  });

  it('is false when a period-matched class has no room', () => {
    const ev = makeEvent();
    ev.classes![0].room = '';
    const res = hasMasterSchedule(ev);
    expect(res.ok).toBe(false);
    expect(res.missingRooms).toContain('Folk Dance');
  });

  it('is true when every period-matched class has a room', () => {
    expect(hasMasterSchedule(makeEvent()).ok).toBe(true);
  });

  it('ignores classes whose period matches no timeslot', () => {
    const ev = makeEvent();
    ev.classes!.push({ name: 'Late Night', period: 'Midnight', days: '', room: '' });
    const res = hasMasterSchedule(ev);
    expect(res.ok).toBe(true);
    expect(res.unmatchedPeriods).toContain('Midnight');
  });
});

describe('buildEventMasterSchedule', () => {
  it('produces a grid-ready MasterScheduleData from frontmatter', () => {
    const data = buildEventMasterSchedule(makeEvent(), leaderMap);
    expect(data.locations).toEqual(['Elm Room', 'Library', 'Rec Hall']);
    expect(data.timeslots.map((t) => t.periodKey)).toEqual(['custom-breakfast', 'morning-first-period', 'afternoon']);
    expect(data.timeslots[0].isCustom).toBe(true);

    const folk = data.workshops.find((w) => w.name === 'Folk Dance')!;
    expect(folk.leader).toBe('Pat Williams');
    expect(folk.period.sheetName).toBe('morning-first-period');
    expect(folk.duration).toEqual({ startDay: 1, endDay: 4 });
    expect(folk.location).toBe('Rec Hall');
    expect(folk.selections).toEqual([]);
  });

  it('warns when a class period matches no timeslot label', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ev = makeEvent();
    ev.classes!.push({ name: 'Late Night', period: 'Midnight', days: '', room: 'Rec Hall' });
    buildEventMasterSchedule(ev, leaderMap);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Midnight'));
    warn.mockRestore();
  });
});
