import { describe, it, expect } from 'vitest';
import {
  buildMasterSchedule,
  buildRosters,
  buildIndividualSchedules,
  getUniquePeriods,
} from '~/components/schedule/scheduleBuilder';
import type { Workshop, WorkshopSelection, TimeSlot } from '~/components/schedule/models';

function makeWorkshop(
  name: string,
  leader: string,
  location: string,
  periodKey = 'MorningFirstPeriod',
  periodDisplay = 'Morning First Period',
  startDay = 1,
  endDay = 4,
  selections: WorkshopSelection[] = []
): Workshop {
  return {
    name,
    leader,
    location,
    period: { sheetName: periodKey, displayName: periodDisplay },
    duration: { startDay, endDay },
    selections,
  };
}

function makeSelection(id: string, fullName: string, choice = 1, workshopName = 'Test'): WorkshopSelection {
  const [firstName, ...rest] = fullName.split(' ');
  return {
    classSelectionId: id,
    workshopName,
    fullName,
    firstName: firstName ?? '',
    lastName: rest.join(' '),
    choiceNumber: choice,
    duration: { startDay: 1, endDay: 4 },
    registrationId: 0,
  };
}

function makeSlot(periodKey: string, displayName: string, start = '09:00', end = '10:00'): TimeSlot {
  return { periodKey, displayName, startTime: start, endTime: end };
}

// ---------------------------------------------------------------------------
// buildMasterSchedule
// ---------------------------------------------------------------------------

describe('buildMasterSchedule', () => {
  it('excludes workshops with no location', () => {
    const { locations } = buildMasterSchedule([makeWorkshop('Pottery', 'John Smith', '')], []);
    expect(locations).toHaveLength(0);
  });

  it('returns one entry per unique location', () => {
    const workshops = [
      makeWorkshop('Pottery', 'John Smith', 'Art Studio'),
      makeWorkshop('Woodworking', 'Jane Doe', 'Workshop Room'),
    ];
    const { locations } = buildMasterSchedule(workshops, []);
    expect(locations).toHaveLength(2);
  });

  it('sorts locations alphabetically', () => {
    const workshops = [
      makeWorkshop('W1', 'L1', 'Zebra Room'),
      makeWorkshop('W2', 'L2', 'Alpha Room'),
      makeWorkshop('W3', 'L3', 'Beta Room'),
    ];
    const { locations } = buildMasterSchedule(workshops, []);
    expect(locations).toEqual(['Alpha Room', 'Beta Room', 'Zebra Room']);
  });

  it('passes through timeslots unchanged', () => {
    const workshops = [makeWorkshop('Pottery', 'J', 'Art Studio')];
    const timeslots = [makeSlot('MorningFirstPeriod', 'Morning First Period', '09:15', '10:45')];
    const { timeslots: out } = buildMasterSchedule(workshops, timeslots);
    expect(out).toHaveLength(1);
    expect(out[0].startTime).toBe('09:15');
  });

  it('excludes locationless workshops from the workshops list', () => {
    const workshops = [makeWorkshop('Pottery', 'J', 'Art Studio'), makeWorkshop('Dance', 'K', '')];
    const { workshops: out } = buildMasterSchedule(workshops, []);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Pottery');
  });
});

// ---------------------------------------------------------------------------
// buildRosters
// ---------------------------------------------------------------------------

describe('buildRosters', () => {
  it('only includes first-choice selections', () => {
    const workshop = makeWorkshop('Pottery', 'J', 'Art Studio', 'MorningFirstPeriod', 'Morning First Period', 1, 4, [
      makeSelection('1', 'Alice Johnson', 1),
      makeSelection('2', 'Bob Williams', 2), // backup choice — should be excluded
    ]);
    const rosters = buildRosters([workshop]);
    expect(rosters[0].attendees).toHaveLength(1);
    expect(rosters[0].attendees[0].fullName).toBe('Alice Johnson');
  });

  it('sorts attendees by last name', () => {
    const workshop = makeWorkshop('Pottery', 'J', 'Art Studio', 'MorningFirstPeriod', 'Morning First Period', 1, 4, [
      makeSelection('1', 'Alice Johnson', 1),
      makeSelection('2', 'Carol Adams', 1),
      makeSelection('3', 'Bob Williams', 1),
    ]);
    const rosters = buildRosters([workshop]);
    const names = rosters[0].attendees.map((a) => a.fullName);
    expect(names[0]).toBe('Carol Adams');
    expect(names[1]).toBe('Alice Johnson');
    expect(names[2]).toBe('Bob Williams');
  });

  it('includes workshop metadata', () => {
    const workshop = makeWorkshop('Pottery', 'John Smith', 'Art Studio', 'MorningFirstPeriod', 'Morning First Period');
    const rosters = buildRosters([workshop]);
    expect(rosters[0].workshopName).toBe('Pottery');
    expect(rosters[0].leader).toBe('John Smith');
    expect(rosters[0].location).toBe('Art Studio');
    expect(rosters[0].period).toBe('Morning First Period');
  });

  it('uses (No Location) placeholder when location empty', () => {
    const workshop = makeWorkshop('Pottery', 'J', '');
    const rosters = buildRosters([workshop]);
    expect(rosters[0].location).toBe('(No Location)');
  });

  it('returns empty attendees array when no first-choice selections', () => {
    const workshop = makeWorkshop('Pottery', 'J', 'Art Studio', 'MorningFirstPeriod', 'Morning First Period', 1, 4, [
      makeSelection('1', 'Alice Johnson', 2),
    ]);
    const rosters = buildRosters([workshop]);
    expect(rosters[0].attendees).toHaveLength(0);
  });

  it('sorts by period, then breaks ties by workshop name', () => {
    const pottery = makeWorkshop('Pottery', 'J', 'Art Studio', 'MorningFirstPeriod', 'Morning First Period');
    const dance = makeWorkshop('Dance', 'K', 'Rec Hall', 'MorningFirstPeriod', 'Morning First Period');
    const yoga = makeWorkshop('Yoga', 'L', 'Elm Room', 'AfternoonFirstPeriod', 'Afternoon First Period');
    const rosters = buildRosters([pottery, yoga, dance]);
    // "Afternoon First Period" sorts before "Morning First Period"; within the
    // tied "Morning First Period" pair, workshopName breaks the tie.
    expect(rosters.map((r) => r.workshopName)).toEqual(['Yoga', 'Dance', 'Pottery']);
  });
});

// ---------------------------------------------------------------------------
// getUniquePeriods
// ---------------------------------------------------------------------------

describe('getUniquePeriods', () => {
  it('dedupes workshops sharing the same sheetName, keeping first-seen order', () => {
    const workshops = [
      makeWorkshop('Pottery', 'J', 'Art Studio', 'MorningFirstPeriod', 'Morning First Period'),
      makeWorkshop('Dance', 'K', 'Rec Hall', 'MorningFirstPeriod', 'Morning First Period'),
      makeWorkshop('Yoga', 'L', 'Elm Room', 'AfternoonFirstPeriod', 'Afternoon First Period'),
    ];
    expect(getUniquePeriods(workshops)).toEqual([
      { sheetName: 'MorningFirstPeriod', displayName: 'Morning First Period' },
      { sheetName: 'AfternoonFirstPeriod', displayName: 'Afternoon First Period' },
    ]);
  });

  it('returns an empty array for no workshops', () => {
    expect(getUniquePeriods([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildIndividualSchedules
// ---------------------------------------------------------------------------

describe('buildIndividualSchedules', () => {
  it('only includes first-choice workshops per attendee', () => {
    const workshop1 = makeWorkshop('Pottery', 'J', 'Art Studio', 'MorningFirstPeriod', 'Morning First Period', 1, 4, [
      makeSelection('1', 'Alice Johnson', 1, 'Pottery'),
    ]);
    const workshop2 = makeWorkshop(
      'Backup Workshop',
      'K',
      'Other',
      'MorningFirstPeriod',
      'Morning First Period',
      1,
      4,
      [
        makeSelection('1', 'Alice Johnson', 2, 'Backup Workshop'), // backup
      ]
    );
    const schedules = buildIndividualSchedules([workshop1, workshop2], []);
    expect(schedules).toHaveLength(1);
    expect(schedules[0].entries).toHaveLength(1);
    expect(schedules[0].entries[0].workshopName).toBe('Pottery');
  });

  it('sorts attendees by last name', () => {
    const w1 = makeWorkshop('Pottery', 'J', 'Art Studio', 'MorningFirstPeriod', 'Morning First Period', 1, 4, [
      makeSelection('1', 'Alice Zebra', 1),
    ]);
    const w2 = makeWorkshop('Dance', 'K', 'Gym', 'AfternoonPeriod', 'Afternoon Period', 1, 4, [
      makeSelection('2', 'Bob Apple', 1),
    ]);
    const schedules = buildIndividualSchedules([w1, w2], []);
    expect(schedules[0].fullName).toBe('Bob Apple');
    expect(schedules[1].fullName).toBe('Alice Zebra');
  });

  it('groups multiple workshops for the same attendee', () => {
    const w1 = makeWorkshop('Pottery', 'J', 'Art Studio', 'MorningFirstPeriod', 'Morning First Period', 1, 4, [
      makeSelection('1', 'Alice Johnson', 1),
    ]);
    const w2 = makeWorkshop('Dance', 'K', 'Gym', 'AfternoonPeriod', 'Afternoon Period', 1, 4, [
      makeSelection('1', 'Alice Johnson', 1),
    ]);
    const schedules = buildIndividualSchedules([w1, w2], []);
    expect(schedules).toHaveLength(1);
    expect(schedules[0].entries).toHaveLength(2);
  });

  it('preserves both half-block entries when attendee has split classes in same period', () => {
    const half12 = makeWorkshop('Chair Yoga', 'Judi', 'Elm Room', 'MorningFirstPeriod', 'Morning First Period', 1, 2, [
      makeSelection('1', 'Jacquie Adain', 1, 'Chair Yoga'),
    ]);
    const half34 = makeWorkshop(
      'Breathe & Be',
      'Heather',
      'Chapel A',
      'MorningFirstPeriod',
      'Morning First Period',
      3,
      4,
      [makeSelection('1', 'Jacquie Adain', 1, 'Breathe & Be')]
    );
    const schedules = buildIndividualSchedules([half12, half34], []);
    expect(schedules).toHaveLength(1);
    expect(schedules[0].entries).toHaveLength(2);
    const days12 = schedules[0].entries.find((e) => e.startDay === 1);
    const days34 = schedules[0].entries.find((e) => e.startDay === 3);
    expect(days12?.workshopName).toBe('Chair Yoga');
    expect(days34?.workshopName).toBe('Breathe & Be');
  });

  it('uses timeslot displayName in entries', () => {
    const w1 = makeWorkshop('Pottery', 'J', 'Art Studio', 'MorningFirstPeriod', 'Morning First Period', 1, 4, [
      makeSelection('1', 'Alice Johnson', 1),
    ]);
    const timeslots: TimeSlot[] = [makeSlot('MorningFirstPeriod', 'Morning First Period')];
    const schedules = buildIndividualSchedules([w1], timeslots);
    expect(schedules[0].entries[0].periodDisplay).toBe('Morning First Period');
  });
});
