// The marble funnel's rules and geometry, kept apart from the canvas so they can be tested.
// One marble per person. The funnel is a trunk (Supporter, Attendee, Volunteer) that splits
// into two channels: Teaching (Leads an activity, Leads a class) and Service (Serving now).

import type { JourneyStage } from './model';

export type Chamber = JourneyStage | 'serving';
export type Branch = 'trunk' | 'teaching' | 'service';

export interface MarbleRow {
  person_id: number;
  name: string;
  stage: JourneyStage | null;
  serving_now: number;
  on_board_now: number;
  last_active_year: number | null;
  do_not_contact: number;
}

export interface Placed {
  id: number;
  name: string;
  chamber: Chamber;
  branch: Branch;
  /** Serving now and also led an activity or class: drawn with a ring. */
  alsoLed: boolean;
  /** Last active this year or last: drawn brighter. */
  recent: boolean;
  muted: boolean;
}

export const BRANCH_OF: Record<Chamber, Branch> = {
  supporter: 'trunk',
  attendee: 'trunk',
  volunteer: 'trunk',
  activity: 'teaching',
  class: 'teaching',
  serving: 'service',
};

/**
 * Where a person's marble goes. Someone serving now goes down the Service channel, even if
 * they have led, because a marble can only be in one place (the bars above count both).
 * People with no stage and no service have no marble.
 */
export function place(row: MarbleRow, thisYear: number): Placed | null {
  const serving = row.serving_now > 0;
  if (!serving && !row.stage) return null;
  const chamber: Chamber = serving ? 'serving' : (row.stage as JourneyStage);
  return {
    id: row.person_id,
    name: row.name,
    chamber,
    branch: BRANCH_OF[chamber],
    alsoLed: serving && (row.stage === 'activity' || row.stage === 'class'),
    recent: row.last_active_year !== null && row.last_active_year >= thisYear - 1,
    muted: row.do_not_contact > 0,
  };
}

export const CHAMBERS: Chamber[] = ['supporter', 'attendee', 'volunteer', 'activity', 'class', 'serving'];

export function tally(placed: Placed[]): Record<Chamber, number> {
  const out = { supporter: 0, attendee: 0, volunteer: 0, activity: 0, class: 0, serving: 0 };
  for (const p of placed) out[p.chamber]++;
  return out;
}

// --- Geometry, in a 640 by 900 world. -----------------------------------------------------

export const WORLD = { w: 640, h: 960 };

/** The open area each chamber's marbles rest in: a rectangle, with its gate (the floor) at `floor`. */
export interface Room {
  chamber: Chamber;
  label: string;
  x0: number;
  x1: number;
  y0: number;
  floor: number;
  /** Where the funnel narrows to this chamber's gate: the walls slope in from here. */
  shoulder: number;
  /** The gate's opening, left and right. */
  hole: [number, number];
}

export const ROOMS: Room[] = [
  { chamber: 'supporter', label: 'Supporter', x0: 20, x1: 620, y0: 30, shoulder: 170, floor: 225, hole: [100, 540] },
  { chamber: 'attendee', label: 'Attendee', x0: 100, x1: 540, y0: 225, shoulder: 340, floor: 395, hole: [180, 460] },
  { chamber: 'volunteer', label: 'Volunteer', x0: 180, x1: 460, y0: 395, shoulder: 505, floor: 560, hole: [240, 400] },
  {
    chamber: 'activity',
    label: 'Leads an activity',
    x0: 60,
    x1: 300,
    y0: 720,
    shoulder: 830,
    floor: 830,
    hole: [60, 300],
  },
  { chamber: 'class', label: 'Leads a class', x0: 60, x1: 300, y0: 830, shoulder: 940, floor: 940, hole: [60, 300] },
  { chamber: 'serving', label: 'Serving now', x0: 340, x1: 580, y0: 720, shoulder: 940, floor: 940, hole: [340, 580] },
];

/**
 * The split below the trunk. Marbles leave the last gate into a bay, where two crossing chutes
 * sort them: each is solid only to one branch, so service marbles slide to the right and teaching
 * marbles to the left. A wedge under the crossing then keeps the two channels apart.
 */
export const WEDGE = { apexX: 320, apexY: 690, shoulderY: 720, left: 300, right: 340, bottom: 940 };
export const BAY = { x0: 60, x1: 580, ceiling: 565 };
/** Chutes as [x1, y1, x2, y2], sloping down from the first point to the second. */
export const CHUTES = {
  service: [235, 590, 365, 665],
  teaching: [405, 590, 275, 665],
} as const;

/**
 * Collision categories. A marble meets the walls, its own chamber's floor, and marbles bound for
 * the same chamber. It passes through the rest, so a deep marble is never held up by the pile
 * resting on a gate above.
 */
export const CAT = { wall: 2, everything: 0xffff };
/** The chutes: solid only to one branch. */
export const CHUTE_CAT = { teaching: 1 << 14, service: 1 << 15 };
export const floorCategory = (c: Chamber): number => 4 << CHAMBERS.indexOf(c);
export const marbleCategory = (c: Chamber): number => 256 << CHAMBERS.indexOf(c);
export const marbleMask = (c: Chamber): number => {
  const branch = BRANCH_OF[c];
  return marbleCategory(c) | CAT.wall | floorCategory(c) | (branch === 'trunk' ? 0 : CHUTE_CAT[branch]);
};

/** Marbles shrink as the biggest chamber fills, within sensible limits. */
export function marbleRadius(counts: Record<Chamber, number>): number {
  let r = 9;
  for (const room of ROOMS) {
    const n = counts[room.chamber];
    if (!n) continue;
    const area = (room.x1 - room.x0) * (room.floor - room.y0);
    r = Math.min(r, Math.sqrt((area * 0.4) / (n * Math.PI)));
  }
  return Math.max(2.5, Math.round(r * 10) / 10);
}

/** Recently active marbles are solid; older ones are paler. */
export const MARBLE_COLORS = {
  trunk: { recent: '#2f7a6d', older: '#8fbdb4' },
  teaching: { recent: '#c2410c', older: '#f0a77c' },
  service: { recent: '#0369a1', older: '#7cb6d9' },
  muted: '#9ca3af',
};
export function colorFor(p: Placed): string {
  if (p.muted) return MARBLE_COLORS.muted;
  return MARBLE_COLORS[p.branch][p.recent ? 'recent' : 'older'];
}

/** Text a screen reader gets in place of the picture. */
export function summary(counts: Record<Chamber, number>): string {
  const n = (c: Chamber) => counts[c];
  return (
    `Marble funnel. Trunk: ${n('supporter')} supporters, ${n('attendee')} attendees, ${n('volunteer')} volunteers. ` +
    `Teaching branch: ${n('activity')} lead an activity, ${n('class')} lead a class. ` +
    `Service branch: ${n('serving')} serving now.`
  );
}

/** Which chamber, if any, holds a point in the world. */
export function roomAt(x: number, y: number): Room | null {
  return ROOMS.find((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.floor) ?? null;
}
