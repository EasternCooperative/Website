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
    x1: 316,
    y0: 720,
    shoulder: 830,
    floor: 830,
    hole: [60, 316],
  },
  { chamber: 'class', label: 'Leads a class', x0: 60, x1: 316, y0: 830, shoulder: 940, floor: 940, hole: [60, 316] },
  { chamber: 'serving', label: 'Serving now', x0: 324, x1: 580, y0: 720, shoulder: 940, floor: 940, hole: [324, 580] },
];

/**
 * The split below the trunk. Marbles leave the last gate into a bay with no walls between the two
 * sides until a slim divider at its foot. Across the bay is a sorting zone: each marble leans a
 * random way at first, then commits to its own channel at a random depth, so the chance of
 * heading for the wrong side falls steadily and is nothing by the time it reaches the divider.
 */
export const WEDGE = { apexX: 320, apexY: 700, shoulderY: 720, left: 314, right: 326, bottom: 940 };
export const BAY = { x0: 60, x1: 580, ceiling: 565 };
export const ZONE = { top: BAY.ceiling, bottom: WEDGE.apexY };
/** Where each channel's marbles are steered toward. */
export const CHANNEL_X = { teaching: 188, service: 452 };
/** No marble commits later than this fraction of the way through the zone, so all have time to cross. */
export const LATEST_COMMIT = 0.4;

/** The zone is thick like syrup: each step a marble keeps this fraction of its speed falling, so it sinks slowly. */
export const ZONE_DRAG = 0.85;
/** Sideways it meets resistance too, but less, or the steering could not get across. */
export const ZONE_DRAG_X = 0.95;

/**
 * Where to put a marble that has somehow left the funnel (a crowded pile can squeeze one through a
 * wall): back at the top of its own chamber, or null while it is still inside.
 */
export function rescue(chamber: Chamber, x: number, y: number): { x: number; y: number } | null {
  if (x > 0 && x < WORLD.w && y > 0 && y < WORLD.h) return null;
  const room = ROOMS.find((r) => r.chamber === chamber) as Room;
  return { x: (room.x0 + room.x1) / 2, y: room.y0 + 14 };
}

/** How far through the sorting zone a height is: 0 at the top, 1 at the divider. */
export const zoneDepth = (y: number): number => Math.min(1, Math.max(0, (y - ZONE.top) / (ZONE.bottom - ZONE.top)));

/**
 * Sideways acceleration, as a multiple of gravity, for a marble in the sorting zone. Before it commits
 * it drifts a little in its own random direction (`wobble`, 1 or -1); after, it is steered toward the
 * middle of its channel, harder the deeper it is. Trunk marbles are not sorted.
 */
export function zoneForce(branch: Branch, x: number, depth: number, commit: number, wobble: number): number {
  if (branch === 'trunk' || depth <= 0 || depth >= 1) return 0;
  if (depth < commit) return 0.3 * wobble;
  const pull = Math.min(1, Math.max(-1, (CHANNEL_X[branch] - x) / 100));
  return 8 * (0.5 + depth) * pull;
}

/**
 * The funnel's outline as one unbroken line: down the left wall, narrowing through each gate, round
 * the teaching channel, up and over the divider, round the service channel, and back up the right.
 * Drawn from the same numbers the walls are built from.
 */
export function outline(): [number, number][] {
  const trunk = ROOMS.slice(0, 3);
  const left: [number, number][] = [[trunk[0].x0, trunk[0].y0]];
  for (const r of trunk) left.push([r.x0, r.shoulder], [r.hole[0], r.floor]);
  left.push([trunk[2].hole[0], BAY.ceiling], [BAY.x0, BAY.ceiling], [BAY.x0, WEDGE.bottom], [WEDGE.left, WEDGE.bottom]);
  left.push([WEDGE.left, WEDGE.shoulderY]);
  const right = left.map(([x, y]): [number, number] => [WORLD.w - x, y]).reverse();
  return [...left, [WEDGE.apexX, WEDGE.apexY], ...right];
}

/**
 * Collision categories. A marble meets the walls, its own chamber's floor, and marbles bound for
 * the same chamber. It passes through the rest, so a deep marble is never held up by the pile
 * resting on a gate above.
 */
export const CAT = { wall: 2, everything: 0xffff };
export const floorCategory = (c: Chamber): number => 4 << CHAMBERS.indexOf(c);
export const marbleCategory = (c: Chamber): number => 256 << CHAMBERS.indexOf(c);
export const marbleMask = (c: Chamber): number => marbleCategory(c) | CAT.wall | floorCategory(c);

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

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - (c / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${[f(0), f(8), f(4)]
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

/**
 * Blend two hex colors: `t` of the way from `a` to `b`, through hue, so the blend of an orange and a
 * blue is a vivid violet rather than the gray that averaging red, green, and blue would give.
 */
export function mix(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const [h1, s1, l1] = toHsl(a);
  const [h2, s2, l2] = toHsl(b);
  const turn = ((((h2 - h1) % 360) + 540) % 360) - 180; // the short way round the color wheel
  return fromHsl((h1 + turn * t + 360) % 360, s1 + (s2 - s1) * t, l1 + (l2 - l1) * t);
}
export const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/**
 * Recently active marbles are solid; older ones are paler. The trunk is the blend of the two
 * channels' colors, which a marble takes on its own channel's color from as it sorts.
 */
const TEACHING = { recent: '#c2410c', older: '#f0a77c' };
const SERVICE = { recent: '#0369a1', older: '#7cb6d9' };
export const MARBLE_COLORS = {
  trunk: { recent: mix(TEACHING.recent, SERVICE.recent, 0.5), older: mix(TEACHING.older, SERVICE.older, 0.5) },
  teaching: TEACHING,
  service: SERVICE,
  muted: '#9ca3af',
};
export function colorFor(p: Placed): string {
  if (p.muted) return MARBLE_COLORS.muted;
  return MARBLE_COLORS[p.branch][p.recent ? 'recent' : 'older'];
}
/** A marble's color at a height: the trunk blend above the sorting zone, its channel's color below. */
export function colorAt(p: Placed, y: number): string {
  if (p.muted || p.branch === 'trunk') return colorFor(p);
  const k = p.recent ? 'recent' : 'older';
  return mix(MARBLE_COLORS.trunk[k], MARBLE_COLORS[p.branch][k], smoothstep(zoneDepth(y)));
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
