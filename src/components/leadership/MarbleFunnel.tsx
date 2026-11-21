import { useEffect, useMemo, useRef, useState } from 'react';
import type Matter from 'matter-js';
import {
  BAY,
  CAT,
  ROOMS,
  STEER,
  WEDGE,
  WORLD,
  colorFor,
  floorCategory,
  marbleCategory,
  marbleMask,
  marbleRadius,
  place,
  roomAt,
  summary,
  tally,
  type Chamber,
  type MarbleRow,
  type Placed,
} from './marbles';

interface Props {
  people: MarbleRow[];
  thisYear: number;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onPickLane: (lane: Chamber) => void;
}

interface Live {
  engine: Matter.Engine;
  bodies: { body: Matter.Body; p: Placed }[];
  statics: Matter.Body[];
  radius: number;
  pending: Placed[][];
}

const TINT = { trunk: '47,122,109', teaching: '194,65,12', service: '3,105,161' };

/**
 * Everyone as a marble in a funnel. The pictured geometry is the physics geometry: each gate is
 * a plank only that chamber's marbles can rest on, so everyone deeper falls through, and the
 * trunk splits into a Teaching channel and a Service channel. Marbles are steered toward their
 * channel just below the last gate. The lanes below are the accessible version of this view.
 */
export default function MarbleFunnel({ people, thisYear, selectedId, onSelect, onPickLane }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<Live | null>(null);
  const hover = useRef<number | null>(null);
  const select = useRef(selectedId);
  const redraw = useRef<() => void>(() => {});
  const wake = useRef<() => void>(() => {});
  const callbacks = useRef({ onSelect, onPickLane });
  callbacks.current = { onSelect, onPickLane };
  const [caption, setCaption] = useState('');
  const placed = useMemo(
    () => people.map((r) => place(r, thisYear)).filter((p): p is Placed => p !== null),
    [people, thisYear]
  );
  const counts = useMemo(() => tally(placed), [placed]);

  useEffect(() => {
    select.current = selectedId;
    redraw.current();
  }, [selectedId]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext?.('2d');
    if (!el || !ctx) return;
    let dead = false;
    let frame = 0;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    import('matter-js').then((mod) => {
      if (dead) return;
      const { Engine, Bodies, Body, Composite } = mod.default ?? mod;
      const engine = Engine.create({ enableSleeping: true, gravity: { x: 0, y: 1, scale: 0.002 } });
      const radius = marbleRadius(counts);

      // Static pieces. `wall` is solid to everyone; a plank is solid only to its chamber's marbles.
      const statics: Matter.Body[] = [];
      const add = (label: string, body: Matter.Body) => {
        body.label = label;
        statics.push(body);
      };
      const wall = { isStatic: true, friction: 0.05, collisionFilter: { category: CAT.wall, mask: CAT.everything } };
      const seg = (label: string, x1: number, y1: number, x2: number, y2: number, thick = 16) => {
        const len = Math.hypot(x2 - x1, y2 - y1);
        add(
          label,
          Bodies.rectangle((x1 + x2) / 2, (y1 + y2) / 2, len, thick, { ...wall, angle: Math.atan2(y2 - y1, x2 - x1) })
        );
      };
      for (const r of ROOMS.slice(0, 3)) {
        seg('wall', r.x0, r.y0, r.x0, r.shoulder);
        seg('wall', r.x1, r.y0, r.x1, r.shoulder);
        seg('wall', r.x0, r.shoulder, r.hole[0], r.floor); // the funnel narrows to the gate
        seg('wall', r.x1, r.shoulder, r.hole[1], r.floor);
      }
      // The bay under the trunk: a ceiling either side of the last gate, outer walls, the wedge.
      const last = ROOMS[2];
      seg('wall', BAY.x0, BAY.ceiling, last.hole[0], BAY.ceiling);
      seg('wall', last.hole[1], BAY.ceiling, BAY.x1, BAY.ceiling);
      seg('wall', BAY.x0, BAY.ceiling, BAY.x0, WEDGE.bottom);
      seg('wall', BAY.x1, BAY.ceiling, BAY.x1, WEDGE.bottom);
      seg('wall', WEDGE.apexX, WEDGE.apexY, WEDGE.right, WEDGE.shoulderY);
      seg('wall', WEDGE.apexX, WEDGE.apexY, WEDGE.left, WEDGE.shoulderY);
      seg('wall', WEDGE.apexX, WEDGE.shoulderY, WEDGE.apexX, WEDGE.bottom, WEDGE.right - WEDGE.left);
      for (const r of ROOMS) {
        add(
          'plank',
          Bodies.rectangle((r.hole[0] + r.hole[1]) / 2, r.floor, r.hole[1] - r.hole[0], 6, {
            isStatic: true,
            collisionFilter: { category: floorCategory(r.chamber), mask: CAT.everything },
          })
        );
      }
      Composite.add(engine.world, statics);

      // Rows of marbles, poured into the top chamber a row at a time.
      const step = radius * 2 + 1;
      const top = ROOMS[0];
      const cols = Math.max(1, Math.floor((top.x1 - top.x0 - 20) / step));
      const shuffled = [...placed].sort(() => Math.random() - 0.5);
      const pending: Placed[][] = [];
      for (let i = 0; i < shuffled.length; i += cols) pending.push(shuffled.slice(i, i + cols));
      const bodies: Live['bodies'] = [];
      const spawn = () => {
        const row = pending.shift();
        row?.forEach((p, i) => {
          const body = Bodies.circle(top.x0 + 10 + radius + i * step + Math.random(), top.y0 + radius, radius, {
            restitution: 0.25,
            friction: 0,
            frictionStatic: 0,
            frictionAir: 0.01,
            collisionFilter: { category: marbleCategory(p.chamber), mask: marbleMask(p.chamber) },
          });
          bodies.push({ body, p });
          Composite.add(engine.world, body);
        });
      };
      live.current = { engine, bodies, statics, radius, pending };

      const steer = () => {
        for (const { body, p } of bodies) {
          if (p.branch === 'trunk' || body.position.y < STEER.y0 || body.position.y > STEER.y1) continue;
          const dir = p.branch === 'teaching' ? -1 : 1;
          Body.setVelocity(body, { x: Math.max(-3, Math.min(3, body.velocity.x + dir * 0.3)), y: body.velocity.y });
        }
      };

      const draw = () => {
        const w = el.clientWidth;
        if (!w) return;
        const dpr = window.devicePixelRatio || 1;
        const scale = w / WORLD.w;
        const pw = Math.round(w * dpr);
        const ph = Math.round(WORLD.h * scale * dpr);
        if (el.width !== pw || el.height !== ph) {
          el.width = pw;
          el.height = ph;
          el.style.height = `${WORLD.h * scale}px`;
        }
        ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
        const dark = document.documentElement.classList.contains('dark');
        ctx.clearRect(0, 0, WORLD.w, WORLD.h);
        // Branch tints, so the split reads at a glance.
        const tint = (x: number, y: number, ww: number, hh: number, rgb: string) => {
          ctx.fillStyle = `rgba(${rgb},${dark ? 0.14 : 0.08})`;
          ctx.fillRect(x, y, ww, hh);
        };
        for (const r of ROOMS.slice(0, 3)) tint(r.x0, r.y0, r.x1 - r.x0, r.floor - r.y0, TINT.trunk);
        tint(BAY.x0, BAY.ceiling, WEDGE.left - BAY.x0, WEDGE.bottom - BAY.ceiling, TINT.teaching);
        tint(WEDGE.right, BAY.ceiling, BAY.x1 - WEDGE.right, WEDGE.bottom - BAY.ceiling, TINT.service);
        const ink = dark ? '#e5e7eb' : '#374151';
        for (const b of statics) {
          ctx.beginPath();
          b.vertices.forEach((v, i) => (i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)));
          ctx.closePath();
          ctx.fillStyle =
            b.label === 'plank' ? (dark ? 'rgba(229,231,235,.35)' : 'rgba(55,65,81,.3)') : dark ? '#9ca3af' : '#6b7280';
          ctx.fill();
        }
        // The wedge is solid: fill between its two slopes.
        ctx.beginPath();
        ctx.moveTo(WEDGE.apexX, WEDGE.apexY);
        ctx.lineTo(WEDGE.right, WEDGE.shoulderY);
        ctx.lineTo(WEDGE.left, WEDGE.shoulderY);
        ctx.closePath();
        ctx.fillStyle = dark ? '#9ca3af' : '#6b7280';
        ctx.fill();
        // Marbles.
        for (const { body, p } of bodies) {
          ctx.beginPath();
          ctx.arc(body.position.x, body.position.y, radius, 0, Math.PI * 2);
          ctx.fillStyle = colorFor(p);
          ctx.fill();
          const isSel = select.current === p.id;
          if (p.alsoLed || isSel || hover.current === p.id) {
            ctx.lineWidth = isSel || hover.current === p.id ? 2.5 : 1.5;
            ctx.strokeStyle = isSel || hover.current === p.id ? (dark ? '#fff' : '#111827') : ink;
            ctx.stroke();
          }
        }
        // Labels.
        const px = Math.max(15, 11 / scale); // keep labels readable on a narrow screen
        ctx.font = `600 ${px}px system-ui, sans-serif`;
        ctx.fillStyle = ink;
        ctx.textBaseline = 'top';
        for (const r of ROOMS) {
          ctx.textAlign = 'left';
          ctx.fillText(`${r.label}  ${counts[r.chamber]}`, r.x0 + 10, r.y0 + 8);
        }
        ctx.font = `700 ${Math.max(13, 10 / scale)}px system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText('TEACHING', BAY.x0 + 10, BAY.ceiling + 12);
        ctx.textAlign = 'right';
        ctx.fillText('SERVICE', BAY.x1 - 10, BAY.ceiling + 12);
      };
      redraw.current = draw;

      const asleep = () => bodies.length > 0 && pending.length === 0 && bodies.every((b) => b.body.isSleeping);
      let ticks = 0;
      const tick = () => {
        frame = 0;
        if (dead) return;
        if (pending.length && ticks++ % 4 === 0) spawn();
        steer();
        Engine.update(engine, 1000 / 120); // two small steps a frame, so fast marbles cannot skip a wall
        Engine.update(engine, 1000 / 120);
        draw();
        if (!asleep()) frame = requestAnimationFrame(tick);
      };
      wake.current = () => {
        if (!frame && !dead) frame = requestAnimationFrame(tick);
      };

      if (reduced) {
        // No animation: pour everything and let it settle before the first picture.
        for (let i = 0; i < 2400 && !(pending.length === 0 && asleep()); i++) {
          if (pending.length && i % 6 === 0) spawn();
          steer();
          Engine.update(engine, 1000 / 120);
          Engine.update(engine, 1000 / 120);
        }
        draw();
      } else {
        spawn();
        wake.current();
      }
    });

    const onResize = () => {
      redraw.current();
    };
    window.addEventListener('resize', onResize);
    const theme = new MutationObserver(() => redraw.current());
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      dead = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      theme.disconnect();
      live.current = null;
      redraw.current = () => {};
    };
  }, [placed, counts]);

  const at = (e: { clientX: number; clientY: number }) => {
    const el = canvas.current as HTMLCanvasElement;
    const box = el.getBoundingClientRect();
    const k = WORLD.w / box.width;
    const x = (e.clientX - box.left) * k;
    const y = (e.clientY - box.top) * k;
    const l = live.current;
    let best: { p: Placed; d: number } | null = null;
    for (const b of l?.bodies ?? []) {
      const d = Math.hypot(b.body.position.x - x, b.body.position.y - y);
      if (d <= (l as Live).radius + 5 && (!best || d < best.d)) best = { p: b.p, d };
    }
    return { x, y, marble: best?.p ?? null };
  };

  return (
    <div className="mx-auto max-w-xl">
      <canvas
        ref={canvas}
        role="img"
        aria-label={summary(counts)}
        className="w-full touch-manipulation"
        style={{ cursor: caption ? 'pointer' : 'default' }}
        onPointerMove={(e) => {
          const { marble } = at(e);
          const next = marble?.id ?? null;
          if (next !== hover.current) {
            hover.current = next;
            setCaption(marble ? marble.name : '');
            redraw.current();
          }
        }}
        onPointerLeave={() => {
          hover.current = null;
          setCaption('');
          redraw.current();
        }}
        onClick={(e) => {
          const { x, y, marble } = at(e);
          if (marble) {
            setCaption(marble.name);
            callbacks.current.onSelect(marble.id);
            return;
          }
          const room = roomAt(x, y);
          if (room) callbacks.current.onPickLane(room.chamber);
        }}
      />
      <p aria-live="polite" className="mt-1 min-h-6 text-center text-sm text-muted">
        {caption || 'Hover or tap a marble for a name. Tap a chamber to jump to its list.'}
      </p>
      <ul className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted" aria-label="Key">
        {[
          ['#2f7a6d', 'Trunk'],
          ['#c2410c', 'Teaching'],
          ['#0369a1', 'Service'],
          ['#9ca3af', 'Do not contact'],
        ].map(([c, t]) => (
          <li key={t} className="flex items-center gap-1">
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} />
            {t}
          </li>
        ))}
        <li>Paler: not active in the last two years</li>
        <li>Ring: serving, and has also led</li>
      </ul>
    </div>
  );
}
