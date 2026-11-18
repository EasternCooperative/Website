import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  buildRows,
  describeCounts,
  eventLabel,
  filterRows,
  groupByEvent,
  intensity,
  roleHistory,
  scopedCounts,
  sortedEvents,
  groupActivities,
  eventTitle,
  sortRows,
  statusCounts,
  summarizeByType,
  type Data,
  type Filters,
  type Person,
} from './model';

const person = (id: number, name: string, status: Person['status'] = 'active', mentor = 0): Person => ({
  id,
  name,
  email: null,
  leader_slug: null,
  status,
  mentor,
  notes: null,
});

// Placeholder names only.
const data: Data = {
  people: [person(1, 'Person A'), person(2, 'Person B', 'hiatus', 1), person(3, 'Person C', 'inactive', 1)],
  activities: [
    { id: 1, name: 'Games Class', scope: 'class', type: 'Games', subtype: null },
    { id: 2, name: 'Tag', scope: 'activity', type: 'Games', subtype: 'Active' },
    { id: 3, name: 'Folk Dance', scope: 'activity', type: 'Dancing', subtype: null },
  ],
  events: [
    { id: 1, name: 'Event One', event_type: 'extended', year: 2024 },
    { id: 2, name: 'Event Two', event_type: 'extended', year: 2025 },
  ],
  roles: [
    { id: 1, person_id: 1, activity_id: 1, event_id: 1, leadership_type: 'assisting', how_it_went: null },
    { id: 2, person_id: 1, activity_id: 2, event_id: 2, leadership_type: 'solo', how_it_went: null },
    { id: 3, person_id: 1, activity_id: 3, event_id: 2, leadership_type: 'partner', how_it_went: null },
    { id: 4, person_id: 2, activity_id: 3, event_id: 1, leadership_type: 'solo', how_it_went: null },
    { id: 5, person_id: 99, activity_id: 3, event_id: 1, leadership_type: 'solo', how_it_went: null },
  ],
  notes: [
    {
      id: 1,
      person_id: 1,
      kind: 'ready',
      focus: 'games class',
      body: 'old',
      author: 'x',
      created_at: '2025-01-01T00:00:00Z',
    },
    {
      id: 2,
      person_id: 1,
      kind: 'ready',
      focus: 'dance class',
      body: 'new',
      author: 'x',
      created_at: '2025-06-01T00:00:00Z',
    },
    { id: 3, person_id: 1, kind: 'note', focus: null, body: 'plain', author: 'x', created_at: '2025-09-01T00:00:00Z' },
  ],
  activityTypes: ['Dancing', 'Games'],
};

describe('buildRows', () => {
  const rows = buildRows(data);
  const a = rows.find((r) => r.person.id === 1)!;

  it('splits counts by type, scope, and role', () => {
    expect(a.cells.get('Games')!.class).toEqual({ solo: 0, partner: 0, assisting: 1 });
    expect(a.cells.get('Games')!.activity).toEqual({ solo: 1, partner: 0, assisting: 0 });
    expect(a.cells.get('Dancing')!.activity.partner).toBe(1);
    expect(a.total).toBe(3);
  });

  it('tracks the most recent event year', () => {
    expect(a.lastYear).toBe(2025);
    expect(rows.find((r) => r.person.id === 2)!.lastYear).toBe(2024);
    expect(rows.find((r) => r.person.id === 3)!.lastYear).toBeNull();
  });

  it('uses only the newest "ready" note, ignoring plain notes', () => {
    expect(a.latestReady?.body).toBe('new');
  });

  it('ignores roles for unknown people and keeps people with no roles', () => {
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.person.id === 3)!.total).toBe(0);
  });
});

describe('display helpers', () => {
  it('describes counts in words, omitting zeros', () => {
    expect(describeCounts({ solo: 2, partner: 0, assisting: 1 })).toBe('2 solo, 1 assisting');
    expect(describeCounts({ solo: 0, partner: 0, assisting: 0 })).toBe('');
  });

  it('counts a cell for classes, activities, or both', () => {
    const games = buildRows(data)
      .find((r) => r.person.id === 1)!
      .cells.get('Games');
    expect(scopedCounts(games, 'all')).toEqual({ counts: { solo: 1, partner: 0, assisting: 1 }, total: 2 });
    expect(scopedCounts(games, 'class')).toEqual({ counts: { solo: 0, partner: 0, assisting: 1 }, total: 1 });
    expect(scopedCounts(games, 'activity').total).toBe(1);
    expect(scopedCounts(undefined, 'all').total).toBe(0);
  });

  it('drops the year from an event name, unless that leaves nothing', () => {
    const e = (name: string) => eventLabel({ id: 1, name, event_type: 'weekend', year: 2025 });
    expect(e('Camping Weekend 2025')).toBe('Camping Weekend');
    expect(e('2025 Summer  Weekend')).toBe('Summer Weekend');
    expect(e('Winter Adventure')).toBe('Winter Adventure');
    expect(e('Event 20251')).toBe('Event 20251'); // only the whole year
    expect(e('2025')).toBe('2025');
  });

  it('buckets shading', () => {
    expect([0, 1, 2, 3, 4, 10].map(intensity)).toEqual([0, 1, 2, 2, 3, 3]);
  });
});

describe('events and activities for the editors', () => {
  it('sorts events newest first, then by name, then id', () => {
    const e = (id: number, name: string, year: number) => ({ id, name, event_type: 'weekend', year });
    const sorted = sortedEvents([e(4, 'B', 2024), e(3, 'A', 2024), e(2, 'A', 2024), e(1, 'Z', 2025)]);
    expect(sorted.map((x) => x.id)).toEqual([1, 2, 3, 4]);
  });

  it('titles an event by year, then name without the year', () => {
    expect(eventTitle({ id: 1, name: 'Camp 2025', event_type: 'weekend', year: 2025 })).toBe('2025 Camp');
  });

  it('groups activities by type, A to Z, each by name', () => {
    const a = (id: number, name: string, type: string) => ({ id, name, scope: 'class' as const, type, subtype: null });
    const groups = groupActivities([a(1, 'Zed', 'Games'), a(2, 'Alpha', 'Games'), a(3, 'Reel', 'Dancing')]);
    expect(groups.map((g) => [g.type, g.activities.map((x) => x.name)])).toEqual([
      ['Dancing', ['Reel']],
      ['Games', ['Alpha', 'Zed']],
    ]);
    expect(groupActivities([])).toEqual([]);
  });
});

describe('filter and sort', () => {
  const rows = buildRows(data);

  it('filters by name, leading status, and mentoring', () => {
    const all: Filters = { ...DEFAULT_FILTERS, statuses: ['active', 'hiatus', 'inactive'] };
    const ids = (f: Partial<Filters>) => filterRows(rows, { ...all, ...f }).map((r) => r.person.id);
    expect(ids({ query: ' person b' })).toEqual([2]);
    expect(ids({ statuses: ['hiatus'] })).toEqual([2]);
    expect(ids({})).toHaveLength(3);
    expect(ids({ statuses: [] })).toEqual([]);
    expect(ids({ mentorsOnly: true })).toEqual([2, 3]); // mentors, whatever their leading status
    expect(ids({ mentorsOnly: true, statuses: ['inactive'] })).toEqual([3]); // a mentor who no longer leads
    expect(filterRows(rows, DEFAULT_FILTERS).map((r) => r.person.id)).toEqual([1, 2]); // inactive hidden at first
  });

  it('counts people by status and mentoring', () => {
    expect(statusCounts(rows)).toEqual({ active: 1, hiatus: 1, inactive: 1, mentor: 2 });
  });

  it('sorts by the chosen scope only', () => {
    const ids = (key: Parameters<typeof sortRows>[1], scope: 'class' | 'activity') =>
      sortRows(rows, key, true, scope).map((r) => r.person.id);
    expect(ids('type:Games', 'class')).toEqual([1, 2, 3]);
    expect(ids('type:Dancing', 'class')).toEqual([1, 2, 3]); // nobody: all tie, by name
    expect(ids('total', 'class')).toEqual([1, 2, 3]); // 1 class role against none
    expect(ids('total', 'activity')).toEqual([1, 2, 3]); // 2 against 1 against 0
  });

  it('sorts by name, total, a type column, and recency, breaking ties by name', () => {
    const ids = (key: Parameters<typeof sortRows>[1], desc: boolean) =>
      sortRows(rows, key, desc).map((r) => r.person.id);
    expect(ids('name', false)).toEqual([1, 2, 3]);
    expect(ids('name', true)).toEqual([3, 2, 1]);
    expect(ids('total', true)).toEqual([1, 2, 3]);
    expect(ids('type:Dancing', true)).toEqual([1, 2, 3]); // 1 and 2 tie, name breaks it
    expect(ids('recent', true)).toEqual([1, 2, 3]);
  });
});

describe('roleHistory', () => {
  it('lists a person’s roles newest event first', () => {
    const lines = roleHistory(data, 1);
    expect(lines.map((l) => l.activity.name)).toEqual(['Folk Dance', 'Tag', 'Games Class']);
    expect(roleHistory(data, 3)).toEqual([]);
  });

  it('groups by event, keeping same-year events apart', () => {
    const sameYear: Data = {
      ...data,
      events: [
        { id: 1, name: 'Spring', event_type: 'weekend', year: 2025 },
        { id: 2, name: 'Fall', event_type: 'weekend', year: 2025 },
        { id: 3, name: 'Fall', event_type: 'weekend', year: 2025 },
      ],
      roles: [
        { id: 1, person_id: 1, activity_id: 1, event_id: 1, leadership_type: 'solo', how_it_went: null },
        { id: 2, person_id: 1, activity_id: 2, event_id: 2, leadership_type: 'solo', how_it_went: null },
        { id: 3, person_id: 1, activity_id: 3, event_id: 1, leadership_type: 'solo', how_it_went: null },
        { id: 4, person_id: 1, activity_id: 1, event_id: 3, leadership_type: 'solo', how_it_went: null },
      ],
    };
    const groups = groupByEvent(roleHistory(sameYear, 1));
    expect(groups.map((g) => [g.event?.id, g.lines.map((l) => l.activity.name)])).toEqual([
      [2, ['Tag']],
      [3, ['Games Class']],
      [1, ['Folk Dance', 'Games Class']],
    ]);
    expect(groupByEvent([])).toEqual([]);
  });

  it('sums roles per type, busiest first, then by name', () => {
    expect(summarizeByType(roleHistory(data, 1))).toEqual([
      { type: 'Games', counts: { solo: 1, partner: 0, assisting: 1 }, total: 2 },
      { type: 'Dancing', counts: { solo: 0, partner: 1, assisting: 0 }, total: 1 },
    ]);
    const tie = summarizeByType(roleHistory({ ...data, roles: data.roles.filter((r) => r.id !== 1) }, 1));
    expect(tie.map((t) => t.type)).toEqual(['Dancing', 'Games']);
  });
});

describe('edge cases', () => {
  it('keeps the newest "ready" note even when an older one is listed after it', () => {
    const reversed: Data = { ...data, notes: [...data.notes].reverse() };
    expect(buildRows(reversed).find((r) => r.person.id === 1)!.latestReady?.body).toBe('new');
  });

  it('skips roles whose activity is gone and sorts roles with no event last', () => {
    const odd: Data = {
      ...data,
      roles: [
        { id: 1, person_id: 1, activity_id: 42, event_id: 1, leadership_type: 'solo', how_it_went: null },
        { id: 2, person_id: 1, activity_id: 1, event_id: 99, leadership_type: 'solo', how_it_went: null },
        { id: 3, person_id: 1, activity_id: 2, event_id: 2, leadership_type: 'solo', how_it_went: null },
      ],
    };
    const lines = roleHistory(odd, 1);
    expect(lines.map((l) => l.activity.name)).toEqual(['Tag', 'Games Class']);
    expect(lines[1].event).toBeUndefined();
  });

  it('orders several roles with no known event by activity name', () => {
    const odd: Data = {
      ...data,
      roles: [
        { id: 1, person_id: 1, activity_id: 2, event_id: 98, leadership_type: 'solo', how_it_went: null },
        { id: 2, person_id: 1, activity_id: 1, event_id: 99, leadership_type: 'solo', how_it_went: null },
        { id: 3, person_id: 1, activity_id: 3, event_id: 97, leadership_type: 'solo', how_it_went: null },
      ],
    };
    expect(roleHistory(odd, 1).map((l) => l.activity.name)).toEqual(['Folk Dance', 'Games Class', 'Tag']);
  });

  it('breaks ties by name when sorting a type column ascending', () => {
    const ids = sortRows(buildRows(data), 'type:Dancing', false).map((r) => r.person.id);
    expect(ids).toEqual([3, 1, 2]); // no dancing, then the 1-and-1 tie broken by name
  });
});
