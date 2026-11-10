import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  applyDraft,
  buildDraft,
  clearDraft,
  isEmptyDraft,
  loadDraft,
  saveDraft,
  saveLocationHistory,
  loadLocationHistory,
  workshopKey,
} from '~/components/schedule/storage';
import type { Workshop, TimeSlot } from '~/components/schedule/models';

let mockStore: Record<string, string> = {};

const mockLocalStorage = {
  getItem: (key: string) => mockStore[key] ?? null,
  setItem: (key: string, val: string) => {
    mockStore[key] = val;
  },
  removeItem: (key: string) => {
    delete mockStore[key];
  },
};

beforeAll(() => {
  vi.stubGlobal('localStorage', mockLocalStorage);
});
afterAll(() => {
  vi.unstubAllGlobals();
});
beforeEach(() => {
  mockStore = {};
});

function ws(name: string, location: string): Workshop {
  return {
    name,
    leader: '',
    location,
    period: { sheetName: 'morning', displayName: 'Morning' },
    duration: { startDay: 1, endDay: 4 },
    selections: [],
  };
}

const slots: TimeSlot[] = [{ periodKey: 'morning', displayName: 'Morning', startTime: '09:00', endTime: '10:40' }];
const published = { workshops: [ws('Folk Dance', 'Rec Hall'), ws('Chair Yoga', '')], timeslots: slots };

describe('buildDraft', () => {
  it('is empty when nothing differs from the published state', () => {
    expect(isEmptyDraft(buildDraft(published, published))).toBe(true);
  });

  it('records each changed room with the published value it replaced', () => {
    const current = { workshops: [ws('Folk Dance', 'Chapel A'), ws('Chair Yoga', 'Library')], timeslots: slots };
    const draft = buildDraft(published, current);
    expect(draft.rooms[workshopKey(ws('Folk Dance', ''))]).toEqual({ value: 'Chapel A', base: 'Rec Hall' });
    expect(draft.rooms[workshopKey(ws('Chair Yoga', ''))]).toEqual({ value: 'Library', base: '' });
    expect(draft.timeslots).toBeUndefined();
  });

  it('records edited timeslots', () => {
    const edited = [{ ...slots[0], endTime: '10:30' }];
    const draft = buildDraft(published, { workshops: published.workshops, timeslots: edited });
    expect(draft.timeslots?.value).toEqual(edited);
  });
});

describe('buildDraft with an unknown class', () => {
  it('treats a class missing from the published state as having had no room', () => {
    const draft = buildDraft(published, { workshops: [ws('New Class', 'Library')], timeslots: slots });
    expect(draft.rooms[workshopKey(ws('New Class', ''))]).toEqual({ value: 'Library', base: '' });
  });
});

describe('applyDraft', () => {
  it('returns the published state untouched when there is no draft', () => {
    const applied = applyDraft(published, null);
    expect(applied.workshops).toBe(published.workshops);
    expect(applied.restoredRooms).toBe(0);
    expect(applied.restoredTimeslots).toBe(false);
  });

  it('restores rooms and timeslots edited against the current published state', () => {
    const edited = [{ ...slots[0], endTime: '10:30' }];
    const draft = buildDraft(published, {
      workshops: [ws('Folk Dance', 'Chapel A'), ws('Chair Yoga', '')],
      timeslots: edited,
    });
    const applied = applyDraft(published, draft);
    expect(applied.workshops.map((w) => w.location)).toEqual(['Chapel A', '']);
    expect(applied.timeslots).toEqual(edited);
    expect(applied.restoredRooms).toBe(1);
    expect(applied.restoredTimeslots).toBe(true);
  });

  it('lets a newly published room win over a stale edit', () => {
    // Edit made while "Rec Hall" was published; someone has since published "Library".
    const draft = buildDraft(published, {
      workshops: [ws('Folk Dance', 'Chapel A'), ws('Chair Yoga', '')],
      timeslots: slots,
    });
    const republished = { workshops: [ws('Folk Dance', 'Library'), ws('Chair Yoga', '')], timeslots: slots };
    const applied = applyDraft(republished, draft);
    expect(applied.workshops[0].location).toBe('Library');
    expect(applied.restoredRooms).toBe(0);
  });

  it('drops edited timeslots once the published list has changed', () => {
    const draft = buildDraft(published, {
      workshops: published.workshops,
      timeslots: [{ ...slots[0], endTime: '10:30' }],
    });
    const republished = { ...published, timeslots: [{ ...slots[0], startTime: '09:15' }] };
    const applied = applyDraft(republished, draft);
    expect(applied.timeslots).toBe(republished.timeslots);
    expect(applied.restoredTimeslots).toBe(false);
  });
});

describe('saveDraft / loadDraft / clearDraft', () => {
  const draft = { rooms: { 'morning|folk dance': { value: 'Chapel A', base: 'Rec Hall' } } };

  it('round-trips a draft, scoped per event', () => {
    saveDraft('2026-winter-adventure', draft);
    expect(loadDraft('2026-winter-adventure')).toEqual({ rooms: draft.rooms, timeslots: undefined });
    expect(loadDraft('2027-winter-adventure')).toBeNull();
  });

  it('removes the entry when an empty draft is saved', () => {
    saveDraft('wa', draft);
    saveDraft('wa', { rooms: {} });
    expect(loadDraft('wa')).toBeNull();
  });

  it('clearDraft removes the draft and the legacy unscoped room map', () => {
    saveDraft('wa', draft);
    mockStore['ecrs-schedule-locations'] = '{"old":"Chapel"}';
    clearDraft('wa');
    expect(loadDraft('wa')).toBeNull();
    expect(mockStore['ecrs-schedule-locations']).toBeUndefined();
  });

  it('loadDraft fills in an empty room map when an older draft has none', () => {
    mockStore['ecrs-schedule-draft:wa'] = '{}';
    expect(loadDraft('wa')).toEqual({ rooms: {}, timeslots: undefined });
  });

  it('loadDraft returns null when storage throws or holds junk', () => {
    mockStore['ecrs-schedule-draft:wa'] = '{not json';
    expect(loadDraft('wa')).toBeNull();
    const original = mockLocalStorage.getItem;
    mockLocalStorage.getItem = () => {
      throw new Error('SecurityError');
    };
    expect(loadDraft('wa')).toBeNull();
    mockLocalStorage.getItem = original;
  });
});

describe('saveLocationHistory / loadLocationHistory', () => {
  it('saves and loads a history list', () => {
    saveLocationHistory(['Chapel A', 'Library']);
    const history = loadLocationHistory();
    expect(history).toContain('Chapel A');
    expect(history).toContain('Library');
  });

  it('loadLocationHistory returns an empty array when nothing is saved', () => {
    expect(loadLocationHistory()).toEqual([]);
  });

  it('deduplicates entries when merging with existing history', () => {
    saveLocationHistory(['Chapel A', 'Library']);
    saveLocationHistory(['Chapel A', 'Martin Room']);
    const history = loadLocationHistory();
    expect(history.filter((h) => h === 'Chapel A')).toHaveLength(1);
    expect(history).toContain('Library');
    expect(history).toContain('Martin Room');
  });

  it('caps history at 50 entries', () => {
    const many = Array.from({ length: 60 }, (_, i) => `Location ${i}`);
    saveLocationHistory(many);
    expect(loadLocationHistory().length).toBeLessThanOrEqual(50);
  });
});

describe('localStorage error handling', () => {
  it('loadLocationHistory returns empty array when getItem throws', () => {
    const original = mockLocalStorage.getItem;
    mockLocalStorage.getItem = () => {
      throw new Error('SecurityError');
    };
    expect(loadLocationHistory()).toEqual([]);
    mockLocalStorage.getItem = original;
  });
});
