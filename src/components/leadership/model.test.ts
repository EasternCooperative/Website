import { describe, expect, it } from 'vitest';
import { buildRows, filterRows, formatCounts, intensity, roleHistory, sortRows, type Data, type Person } from './model';

const person = (id: number, name: string, status: Person['status'] = 'active'): Person => ({
  id,
  name,
  email: null,
  leader_slug: null,
  status,
  notes: null,
});

// Placeholder names only.
const data: Data = {
  people: [person(1, 'Person A'), person(2, 'Person B', 'hiatus'), person(3, 'Person C')],
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
  it('formats counts, omitting zeros', () => {
    expect(formatCounts({ solo: 2, partner: 0, assisting: 1 })).toBe('S2 A1');
    expect(formatCounts({ solo: 0, partner: 0, assisting: 0 })).toBe('');
  });

  it('buckets shading', () => {
    expect([0, 1, 2, 3, 4, 10].map(intensity)).toEqual([0, 1, 2, 2, 3, 3]);
  });
});

describe('filter and sort', () => {
  const rows = buildRows(data);

  it('filters by name and status', () => {
    expect(filterRows(rows, { query: ' person b', status: 'all' }).map((r) => r.person.id)).toEqual([2]);
    expect(filterRows(rows, { query: '', status: 'hiatus' }).map((r) => r.person.id)).toEqual([2]);
    expect(filterRows(rows, { query: '', status: 'all' })).toHaveLength(3);
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
