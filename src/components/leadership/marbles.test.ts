import { describe, expect, it } from 'vitest';
import {
  BRANCH_OF,
  CAT,
  CHAMBERS,
  LATEST_COMMIT,
  MARBLE_COLORS,
  ROOMS,
  ZONE,
  colorAt,
  colorFor,
  floorCategory,
  marbleCategory,
  marbleMask,
  marbleRadius,
  mix,
  outline,
  place,
  roomAt,
  smoothstep,
  summary,
  tally,
  zoneDepth,
  zoneForce,
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

  it('measures how far through the sorting zone a height is', () => {
    expect(zoneDepth(0)).toBe(0);
    expect(zoneDepth(ZONE.top)).toBe(0);
    expect(zoneDepth((ZONE.top + ZONE.bottom) / 2)).toBeCloseTo(0.5);
    expect(zoneDepth(ZONE.bottom)).toBe(1);
    expect(zoneDepth(900)).toBe(1);
  });

  it('drifts at random before it commits, then steers toward its own channel', () => {
    expect(zoneForce('trunk', 300, 0.5, 0.2, 1)).toBe(0);
    expect(zoneForce('service', 300, 0, 0.2, 1)).toBe(0);
    expect(zoneForce('service', 300, 1, 0.2, 1)).toBe(0);
    // Before committing: a small nudge in its own direction, wrong or right.
    expect(zoneForce('service', 330, 0.1, 0.4, -1)).toBeLessThan(0);
    expect(zoneForce('service', 330, 0.1, 0.4, 1)).toBeGreaterThan(0);
    // After: toward the channel's middle from either side, and harder the deeper it is.
    expect(zoneForce('service', 250, 0.5, 0.4, -1)).toBeGreaterThan(0);
    expect(zoneForce('teaching', 400, 0.5, 0.4, 1)).toBeLessThan(0);
    expect(Math.abs(zoneForce('service', 250, 0.9, 0.4, 1))).toBeGreaterThan(
      Math.abs(zoneForce('service', 250, 0.5, 0.4, 1))
    );
    // Everyone has committed by the time the zone is mostly crossed.
    expect(LATEST_COMMIT).toBeLessThan(1);
  });

  it('mixes colors and blends the trunk from the two channels', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(MARBLE_COLORS.trunk.recent).toBe(mix(MARBLE_COLORS.teaching.recent, MARBLE_COLORS.service.recent, 0.5));
    expect(MARBLE_COLORS.trunk.older).toBe(mix(MARBLE_COLORS.teaching.older, MARBLE_COLORS.service.older, 0.5));
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
  });

  it('takes on its channel color through the sorting zone', () => {
    const base = place(row({ stage: 'class' }), 2026)!;
    expect(colorAt(base, ZONE.top - 50)).toBe(MARBLE_COLORS.trunk.recent);
    expect(colorAt(base, ZONE.bottom + 50)).toBe(MARBLE_COLORS.teaching.recent);
    const middle = colorAt(base, (ZONE.top + ZONE.bottom) / 2);
    expect(middle).not.toBe(MARBLE_COLORS.trunk.recent);
    expect(middle).not.toBe(MARBLE_COLORS.teaching.recent);
    expect(colorAt({ ...base, recent: false }, ZONE.bottom + 50)).toBe(MARBLE_COLORS.teaching.older);
    expect(colorAt({ ...base, muted: true }, ZONE.bottom + 50)).toBe('#9ca3af');
    const trunk = place(row({ stage: 'attendee' }), 2026)!;
    expect(colorAt(trunk, ZONE.bottom + 50)).toBe(MARBLE_COLORS.trunk.recent);
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

  it('draws the funnel as one line that starts and ends at the top, mirrored, over the divider', () => {
    const line = outline();
    expect(line[0]).toEqual([20, 30]);
    expect(line[line.length - 1]).toEqual([620, 30]);
    expect(line.length % 2).toBe(1); // the divider's apex is the middle point
    const mid = line[(line.length - 1) / 2];
    expect(mid[0]).toBe(320);
    for (let i = 0; i < (line.length - 1) / 2; i++) {
      expect(line[i][1]).toBe(line[line.length - 1 - i][1]);
      expect(line[i][0] + line[line.length - 1 - i][0]).toBe(640);
    }
  });

  it('finds the chamber under a point', () => {
    expect(roomAt(300, 100)?.chamber).toBe('supporter');
    expect(roomAt(100, 770)?.chamber).toBe('activity');
    expect(roomAt(450, 800)?.chamber).toBe('serving');
    expect(roomAt(320, 600)).toBeNull();
  });
});
