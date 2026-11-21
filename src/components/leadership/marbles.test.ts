import { describe, expect, it } from 'vitest';
import {
  BRANCH_OF,
  CAT,
  CHAMBERS,
  ROOMS,
  colorFor,
  floorCategory,
  marbleCategory,
  marbleMask,
  marbleRadius,
  place,
  roomAt,
  summary,
  tally,
  type MarbleRow,
} from './marbles';

const row = (over: Partial<MarbleRow> = {}): MarbleRow => ({
  person_id: 1,
  name: 'Person A',
  stage: 'attendee',
  serving_now: 0,
  on_board_now: 0,
  last_active_year: 2026,
  do_not_contact: 0,
  ...over,
});

describe('place', () => {
  it('puts a person at their furthest stage, in that stage branch', () => {
    expect(place(row({ stage: 'volunteer' }), 2026)).toMatchObject({ chamber: 'volunteer', branch: 'trunk' });
    expect(place(row({ stage: 'activity' }), 2026)).toMatchObject({ chamber: 'activity', branch: 'teaching' });
    expect(place(row({ stage: 'class' }), 2026)).toMatchObject({ chamber: 'class', branch: 'teaching' });
  });
  it('sends anyone serving now down the service side, ringed if they have also led', () => {
    expect(place(row({ stage: 'class', serving_now: 1 }), 2026)).toMatchObject({
      chamber: 'serving',
      branch: 'service',
      alsoLed: true,
    });
    expect(place(row({ stage: 'attendee', serving_now: 1 }), 2026)?.alsoLed).toBe(false);
    expect(place(row({ stage: null, serving_now: 2 }), 2026)).toMatchObject({ chamber: 'serving', alsoLed: false });
  });
  it('gives no marble to someone with no stage and no service', () => {
    expect(place(row({ stage: null }), 2026)).toBeNull();
  });
  it('marks recent and do-not-contact people', () => {
    expect(place(row({ last_active_year: 2025 }), 2026)?.recent).toBe(true);
    expect(place(row({ last_active_year: 2024 }), 2026)?.recent).toBe(false);
    expect(place(row({ last_active_year: null }), 2026)?.recent).toBe(false);
    expect(place(row({ do_not_contact: 1 }), 2026)?.muted).toBe(true);
  });
});

describe('the funnel', () => {
  it('has a trunk of three chambers that splits into two branches', () => {
    expect(CHAMBERS.map((c) => BRANCH_OF[c])).toEqual(['trunk', 'trunk', 'trunk', 'teaching', 'teaching', 'service']);
    const trunk = ROOMS.slice(0, 3);
    // Each chamber is narrower than the one above, and each room sits on the gate of the one before.
    for (let i = 1; i < trunk.length; i++) {
      expect(trunk[i].x1 - trunk[i].x0).toBeLessThan(trunk[i - 1].x1 - trunk[i - 1].x0);
      expect(trunk[i].y0).toBe(trunk[i - 1].floor);
    }
    // The two channels sit side by side, with the teaching one on the left.
    const [activity, , serving] = [ROOMS[3], ROOMS[4], ROOMS[5]];
    expect(activity.x1).toBeLessThan(serving.x0);
  });

  it('counts marbles per chamber and describes them in words', () => {
    const placed = [row(), row({ person_id: 2, stage: 'class' }), row({ person_id: 3, serving_now: 1 })].map((r) =>
      place(r, 2026)!
    );
    const counts = tally(placed);
    expect(counts).toMatchObject({ attendee: 1, class: 1, serving: 1, supporter: 0 });
    expect(summary(counts)).toBe(
      'Marble funnel. Trunk: 0 supporters, 1 attendees, 0 volunteers. Teaching branch: 0 lead an activity, 1 lead a class. Service branch: 1 serving now.'
    );
  });

  it('lets a marble rest only on its own chamber floor, and pass through the other marbles', () => {
    for (const c of CHAMBERS) {
      expect(marbleMask(c) & floorCategory(c)).toBeTruthy();
      expect(marbleMask(c) & CAT.wall).toBeTruthy();
      expect(marbleMask(c) & marbleCategory(c)).toBeTruthy();
      for (const other of CHAMBERS.filter((o) => o !== c)) {
        expect(marbleMask(c) & floorCategory(other)).toBe(0);
        expect(marbleMask(c) & marbleCategory(other)).toBe(0);
      }
    }
  });

  it('shrinks marbles as chambers fill, within limits', () => {
    const none = Object.fromEntries(CHAMBERS.map((c) => [c, 0])) as Record<(typeof CHAMBERS)[number], number>;
    expect(marbleRadius(none)).toBe(9);
    expect(marbleRadius({ ...none, attendee: 226 })).toBeLessThan(9);
    expect(marbleRadius({ ...none, serving: 100000 })).toBe(2.5);
  });

  it('colors by branch, paler when older, gray when do not contact', () => {
    const base = place(row(), 2026)!;
    expect(colorFor(base)).not.toBe(colorFor({ ...base, recent: false }));
    expect(colorFor({ ...base, branch: 'teaching' })).not.toBe(colorFor(base));
    expect(colorFor({ ...base, muted: true })).toBe('#9ca3af');
  });

  it('finds the chamber under a point', () => {
    expect(roomAt(300, 100)?.chamber).toBe('supporter');
    expect(roomAt(100, 700)?.chamber).toBe('activity');
    expect(roomAt(450, 800)?.chamber).toBe('serving');
    expect(roomAt(320, 700)).toBeNull();
  });
});
