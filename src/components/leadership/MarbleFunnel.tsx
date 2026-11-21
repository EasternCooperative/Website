import { useEffect, useMemo, useRef, useState } from 'react';
import type Matter from 'matter-js';
import {
  BAY,
  CAT,
  ROOMS,
  outline,
  MARBLE_COLORS,
  WEDGE,
  WORLD,
  ZONE,
  ZONE_DRAG,
  ZONE_DRAG_X,
  LATEST_COMMIT,
  cardFor,
  colorAt,
  mix,
  smoothstep,
  zoneDepth,
  zoneForce,
  floorCategory,
  marbleCategory,
  marbleMask,
  marbleRadius,
  place,
  rescue,
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
  bodies: { body: Matter.Body; p: Placed; commit: number; wobble: number }[];
  statics: Matter.Body[];
  radius: number;
  pending: Placed[][];
}

const rgba = (hex: string, a: number) =>
  `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',')},${a})`;

/**
 * Everyone as a marble in a funnel. The pictured geometry is the physics geometry: each gate is
 * a plank only that chamber's marbles can rest on, so everyone deeper falls through, and the
 * trunk splits into a Teaching channel and a Service channel. Under the last gate is a sorting zone with no walls: each
 * marble leans a random way, then commits to its own channel, so going the wrong way gets steadily less likely. The lanes below are the accessible version of this view.
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
  const [card, setCard] = useState<{ title: string; lines: string[]; left: number; top: number; width: number } | null>(
    null
  );
  const rowOf = useMemo(() => new Map(people.map((r) => [r.person_id, r])), [people]);
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
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    import('matter-js').then((mod) => {
      if (dead) return;
      const { Engine, Bodies, Body, Composite } = mod.default;
      const engine = Engine.create({ gravity: { x: 0, y: 1, scale: 0.002 } });
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
        seg('wall', r.x0, r.y0, r.hole[0], r.floor); // the cone narrows all the way to the gate
        seg('wall', r.x1, r.y0, r.hole[1], r.floor);
      }
      // The bay under the trunk: a ceiling either side of the last gate, outer walls, the divider.
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
          // Thick, with its top at the gate line, so a fast marble cannot tunnel through.
          Bodies.rectangle((r.hole[0] + r.hole[1]) / 2, r.floor + 12, r.hole[1] - r.hole[0], 30, {
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
          bodies.push({ body, p, commit: Math.random() * LATEST_COMMIT, wobble: Math.random() < 0.5 ? -1 : 1 });
          Composite.add(engine.world, body);
        });
      };
      live.current = { engine, bodies, statics, radius, pending };

      const draw = () => {
        const w = el.clientWidth;
        if (!w) return;
        const dpr = window.devicePixelRatio;
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
        const ink = dark ? '#e5e7eb' : '#374151';
        const line = dark ? '#94a3b8' : '#64748b';
        // Soft tints, so the split reads at a glance: the trunk is the blend of the two channels' colors.
        const alpha = (y: number) => (dark ? 0.26 : 0.17) - (dark ? 0.12 : 0.08) * (y / WORLD.h);
        const trunkHex = MARBLE_COLORS.trunk.recent;
        const wash = (hex: string) => {
          const g = ctx.createLinearGradient(0, 0, 0, WORLD.h);
          g.addColorStop(0, rgba(hex, alpha(0)));
          g.addColorStop(1, rgba(hex, alpha(WORLD.h)));
          return g;
        };
        const trunk = ROOMS.slice(0, 3);
        ctx.beginPath();
        ctx.moveTo(trunk[0].x0, trunk[0].y0);
        for (const r of trunk) {
          ctx.lineTo(r.hole[0], r.floor);
        }
        for (const r of [...trunk].reverse()) {
          ctx.lineTo(r.hole[1], r.floor);
        }
        ctx.lineTo(trunk[0].x1, trunk[0].y0);
        ctx.closePath();
        ctx.fillStyle = wash(trunkHex);
        ctx.fill();
        // The sorting zone, in thin strips: at each depth the middle is still the trunk's blend and the
        // sides have moved toward their channel's color, more so the deeper it goes.
        const strip = 1;
        for (let y = ZONE.top; y < ZONE.bottom; y += strip) {
          const k = smoothstep(zoneDepth(y + strip / 2));
          const g = ctx.createLinearGradient(BAY.x0, 0, BAY.x1, 0);
          const a = alpha(y);
          g.addColorStop(0, rgba(mix(trunkHex, MARBLE_COLORS.teaching.recent, k), a));
          g.addColorStop(0.5, rgba(trunkHex, a));
          g.addColorStop(1, rgba(mix(trunkHex, MARBLE_COLORS.service.recent, k), a));
          ctx.fillStyle = g;
          ctx.fillRect(BAY.x0, y, BAY.x1 - BAY.x0, strip + 0.2);
        }
        ctx.fillStyle = wash(MARBLE_COLORS.teaching.recent);
        ctx.fillRect(BAY.x0, ZONE.bottom, WEDGE.apexX - BAY.x0, WEDGE.bottom - ZONE.bottom);
        ctx.fillStyle = wash(MARBLE_COLORS.service.recent);
        ctx.fillRect(WEDGE.apexX, ZONE.bottom, BAY.x1 - WEDGE.apexX, WEDGE.bottom - ZONE.bottom);
        // Gates: dashed, since marbles of their own chamber rest here and the rest fall through.
        ctx.setLineDash([9, 7]);
        ctx.lineWidth = 3;
        ctx.strokeStyle = dark ? 'rgba(229,231,235,.55)' : 'rgba(55,65,81,.45)';
        for (const r of ROOMS.slice(0, 4)) {
          ctx.beginPath();
          ctx.moveTo(r.hole[0], r.floor);
          ctx.lineTo(r.hole[1], r.floor);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        // The outline: one unbroken line with rounded corners.
        ctx.lineWidth = 7;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = line;
        ctx.beginPath();
        outline().forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
        // Marbles, each with a small highlight.
        for (const { body, p } of bodies) {
          const { x, y } = body.position;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fillStyle = colorAt(p, y);
          ctx.fill();
          const isSel = select.current === p.id;
          const isHover = hover.current === p.id;
          if (p.alsoLed || isSel || isHover) {
            ctx.lineWidth = isSel || isHover ? 2.5 : 1.5;
            ctx.strokeStyle = isSel || isHover ? (dark ? '#fff' : '#111827') : ink;
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.arc(x - radius * 0.3, y - radius * 0.3, radius * 0.3, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,.38)';
          ctx.fill();
        }
        // Labels.
        const px = Math.max(15, 11 / scale); // keep labels readable on a narrow screen
        ctx.font = `600 ${px}px system-ui, sans-serif`;
        ctx.fillStyle = ink;
        ctx.textBaseline = 'top';
        for (const r of ROOMS) {
          ctx.textAlign = 'left';
          const text = `${r.label}  ${counts[r.chamber]}`;
          ctx.lineWidth = 4;
          ctx.strokeStyle = dark ? 'rgba(24,24,27,.85)' : 'rgba(255,255,255,.85)';
          ctx.strokeText(text, r.x0 + 14, r.y0 + 10);
          ctx.fillText(text, r.x0 + 14, r.y0 + 10);
        }
        ctx.font = `700 ${Math.max(13, 10 / scale)}px system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText('TEACHING', BAY.x0 + 10, BAY.ceiling + 12);
        ctx.textAlign = 'right';
        ctx.fillText('SERVICE', BAY.x1 - 10, BAY.ceiling + 12);
      };
      redraw.current = draw;

      // Everyone has been poured and nothing has moved for half a second (or it has run for
      // twenty-five seconds): stop asking for frames.
      let still = 0;
      let frames = 0;
      const settled = () => {
        const moving = pending.length > 0 || bodies.some((b) => b.body.speed > 0.2);
        still = moving ? 0 : still + 1;
        return still > 30 || ++frames > 1500;
      };
      // In the sorting zone each marble is nudged sideways: randomly until it commits, then toward its channel.
      const steer = () => {
        for (const b of bodies) {
          const { x, y } = b.body.position;
          const back = rescue(b.p.chamber, x, y);
          if (back) {
            Body.setPosition(b.body, back);
            Body.setVelocity(b.body, { x: 0, y: 0 });
            continue;
          }
          const f = zoneForce(b.p.branch, x, zoneDepth(y), b.commit, b.wobble);
          if (f) Body.applyForce(b.body, b.body.position, { x: f * b.body.mass * 0.002, y: 0 });
          const depth = zoneDepth(y);
          if (depth > 0 && depth < 1 && b.p.branch !== 'trunk') {
            Body.setVelocity(b.body, { x: b.body.velocity.x * ZONE_DRAG_X, y: b.body.velocity.y * ZONE_DRAG });
          }
        }
      };
      const advance = () => {
        steer();
        Engine.update(engine, 1000 / 120); // two small steps a frame, so fast marbles cannot skip a wall
        steer();
        Engine.update(engine, 1000 / 120);
      };
      let ticks = 0;
      const tick = () => {
        frame = 0;
        if (dead) return;
        if (pending.length && ticks++ % 4 === 0) spawn();
        advance();
        draw();
        if (!settled()) frame = requestAnimationFrame(tick);
      };
      wake.current = () => {
        if (!frame && !dead) frame = requestAnimationFrame(tick);
      };

      if (reduced) {
        // No animation: pour everything and let it settle before the first picture.
        for (let i = 0; i < 2400 && !settled(); i++) {
          if (pending.length && i % 6 === 0) spawn();
          advance();
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
    let best: { p: Placed; d: number; b: Matter.Body } | null = null;
    for (const b of l?.bodies ?? []) {
      const d = Math.hypot(b.body.position.x - x, b.body.position.y - y);
      if (d <= (l as Live).radius + 5 && (!best || d < best.d)) best = { p: b.p, d, b: b.body };
    }
    return { x, y, marble: best?.p ?? null, box, body: best?.b ?? null };
  };

  // The card floats over the marble: above it, or below when it is near the top, and kept inside the canvas.
  const show = (e: { clientX: number; clientY: number }) => {
    const { marble, box, body } = at(e);
    if (!body) return setCard(null);
    const scale = box.width / WORLD.w;
    const row = rowOf.get((marble as Placed).id) as MarbleRow;
    setCard({
      ...cardFor(row, marble as Placed),
      left: body.position.x * scale,
      top: body.position.y * scale,
      width: box.width,
    });
  };

  return (
    <div className="relative mx-auto max-w-xl">
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
            show(e);
            redraw.current();
          }
        }}
        onPointerLeave={() => {
          hover.current = null;
          setCaption('');
          setCard(null);
          redraw.current();
        }}
        onClick={(e) => {
          const { x, y, marble } = at(e);
          if (marble) {
            setCaption(marble.name);
            show(e);
            callbacks.current.onSelect(marble.id);
            return;
          }
          const room = roomAt(x, y);
          if (room) callbacks.current.onPickLane(room.chamber);
        }}
      />
      {card && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-10 w-max max-w-[14rem] rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-gray-600 dark:bg-gray-800"
          style={{
            left: Math.min(Math.max(card.left, 100), card.width - 100),
            top: card.top,
            transform: card.top < 110 ? 'translate(-50%, 16px)' : 'translate(-50%, calc(-100% - 12px))',
          }}
        >
          <p className="text-sm font-semibold text-heading">{card.title}</p>
          {card.lines.map((l) => (
            <p key={l} className="text-muted">
              {l}
            </p>
          ))}
        </div>
      )}
      <p aria-live="polite" className="mt-1 min-h-6 text-center text-sm text-muted">
        {caption || 'Hover or tap a marble for a name. Tap a chamber to jump to its list.'}
      </p>
      <ul className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted" aria-label="Key">
        {[
          [MARBLE_COLORS.trunk.recent, 'Trunk'],
          [MARBLE_COLORS.teaching.recent, 'Teaching'],
          [MARBLE_COLORS.service.recent, 'Service'],
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
