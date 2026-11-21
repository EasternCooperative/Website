// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, render, settle } from '../../__tests__/react';
import MarbleFunnel from './MarbleFunnel';
import type { MarbleRow } from './marbles';

const people: MarbleRow[] = [
  {
    person_id: 1,
    name: 'Person A',
    stage: 'supporter',
    serving_now: 0,
    on_board_now: 0,
    last_active_year: 2026,
    do_not_contact: 0,
  },
  {
    person_id: 2,
    name: 'Person B',
    stage: 'attendee',
    serving_now: 0,
    on_board_now: 0,
    last_active_year: 2020,
    do_not_contact: 0,
  },
  {
    person_id: 3,
    name: 'Person C',
    stage: 'class',
    serving_now: 0,
    on_board_now: 0,
    last_active_year: 2026,
    do_not_contact: 1,
  },
  {
    person_id: 4,
    name: 'Person D',
    stage: 'activity',
    serving_now: 1,
    on_board_now: 0,
    last_active_year: 2026,
    do_not_contact: 0,
  },
];

// jsdom has no canvas: give it a drawing context that accepts everything.
const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
const reduce = (on: boolean) =>
  vi.stubGlobal('matchMedia', () => ({ matches: on, addEventListener() {}, removeEventListener() {} }));

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 640,
    height: 920,
  } as DOMRect);
});
afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const pointer = (el: Element, type: string, x: number, y: number) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
  });

describe('MarbleFunnel', () => {
  it('describes the funnel in words for a screen reader, and keys the colors', async () => {
    reduce(true);
    const { container } = await render(
      <MarbleFunnel people={people} thisYear={2026} selectedId={null} onSelect={() => {}} onPickLane={() => {}} />
    );
    await settle();
    const img = container.querySelector('canvas[role="img"]') as HTMLCanvasElement;
    expect(img.getAttribute('aria-label')).toContain('1 supporters, 1 attendees, 0 volunteers');
    expect(img.getAttribute('aria-label')).toContain('Service branch: 1 serving now');
    expect(container.textContent).toContain('Teaching');
    expect(container.textContent).toContain('Ring: serving, and has also led');
  });

  it('names a marble on hover, opens it on click, and jumps to a lane when a chamber is clicked', async () => {
    reduce(true);
    const onSelect = vi.fn();
    const onPickLane = vi.fn();
    const { container } = await render(
      <MarbleFunnel people={people} thisYear={2026} selectedId={2} onSelect={onSelect} onPickLane={onPickLane} />
    );
    await settle(6);
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    // Settled marbles rest on their gates: the supporter, on the top gate.
    let found: number | null = null;
    for (let y = 120; y < 230 && found === null; y += 3) {
      for (let x = 100; x < 540 && found === null; x += 4) {
        await pointer(canvas, 'pointermove', x, y);
        if (container.textContent?.includes('Person A')) {
          found = x;
          await pointer(canvas, 'click', x, y);
        }
      }
    }
    expect(found).not.toBeNull();
    expect(onSelect).toHaveBeenCalledWith(1);
    await pointer(canvas, 'pointerout', 0, 0);
    expect(container.textContent).toContain('Hover or tap a marble');
    await pointer(canvas, 'click', 10, 600); // a chamber with no marble under the pointer: nothing
    await pointer(canvas, 'click', 100, 700); // the Leads an activity chamber
    expect(onPickLane).toHaveBeenCalledWith('activity');
  });

  it('animates when motion is allowed, and stops when it is unmounted', async () => {
    reduce(false);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    await render(
      <MarbleFunnel people={people} thisYear={2026} selectedId={null} onSelect={() => {}} onPickLane={() => {}} />
    );
    await settle(6);
    await cleanup();
    expect(cancel).toHaveBeenCalled();
  });

  it('does nothing without a canvas context', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { container } = await render(
      <MarbleFunnel people={[]} thisYear={2026} selectedId={null} onSelect={() => {}} onPickLane={() => {}} />
    );
    expect(container.querySelector('canvas')).not.toBeNull();
  });
});
