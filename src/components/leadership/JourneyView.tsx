import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { ApiError, clearPlan, getJourney, getJourneyColumn, getJourneyPerson, savePlan } from './api';
import Funnel from './Funnel';
import JourneyStrip from './JourneyStrip';
import { ErrorNote, Field, PanelFrame, Split, inputCls, linkBtn, primaryBtn, useAction } from './forms';
import { PersonTags } from './marks';
import {
  JOURNEY_STAGES,
  TARGET_LABELS,
  isOverdue,
  journeyEvidence,
  type Data,
  type JourneyBoard,
  type JourneyRow,
  type JourneyStage,
  type JourneyTarget,
  type View,
} from './model';

type Lane = JourneyStage | 'serving';
const LANES: { id: Lane; label: string }[] = [...JOURNEY_STAGES, { id: 'serving', label: 'Serving now' }];
const today = () => new Date().toISOString().slice(0, 10);

interface Toggles {
  mine: boolean;
  overdue: boolean;
  hasTarget: boolean;
  stalled: boolean;
  hideDnc: boolean;
}
const TOGGLES: { key: keyof Toggles; label: string }[] = [
  { key: 'mine', label: 'Mine' },
  { key: 'overdue', label: 'Next step date has passed' },
  { key: 'hasTarget', label: 'Has a target' },
  { key: 'stalled', label: 'Nothing in 3+ years' },
  { key: 'hideDnc', label: 'Hide do not contact' },
];

function query(q: string, t: Toggles, year: number | null): string {
  const p = new URLSearchParams();
  if (q.trim()) p.set('q', q.trim());
  if (t.mine) p.set('mine', '1');
  if (t.overdue) p.set('overdue', '1');
  if (t.hasTarget) p.set('has_target', '1');
  if (t.stalled) p.set('stalled_years', '3');
  if (t.hideDnc) p.set('exclude_do_not_contact', '1');
  if (year !== null) p.set('year', String(year));
  return p.toString();
}

function PlanPanel({
  personId,
  me,
  onChanged,
  onClose,
  goTo,
}: {
  personId: number;
  me: string;
  onChanged: () => Promise<void>;
  onClose: () => void;
  goTo: (v: View, id: number) => void;
}) {
  const [row, setRow] = useState<JourneyRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  const [step, setStep] = useState('');
  const [due, setDue] = useState('');
  const [mine, setMine] = useState(false);
  const [saved, setSaved] = useState(false);
  const act = useAction(onChanged);

  useEffect(() => {
    // The panel is keyed by person, so a late answer can only land in the panel it was asked for.
    getJourneyPerson(personId)
      .then((r) => {
        setRow(r);
        setTarget(r.target ?? '');
        setStep(r.next_step ?? '');
        setDue(r.due_on ?? '');
        setMine(!!r.owner && r.owner === me.toLowerCase());
      })
      .catch((e: ApiError) => setLoadError(e.message)); // request() only ever throws ApiError
  }, [personId, me]);

  const onSubmit = async (e: SyntheticEvent) => {
    e.preventDefault();
    setSaved(false);
    const { ok } = await act.run(() =>
      savePlan(personId, {
        target: target || null,
        next_step: step.trim() || null,
        due_on: due || null,
        owner: mine ? me.toLowerCase() : row?.owner && row.owner !== me.toLowerCase() ? row.owner : null,
      })
    );
    if (ok) setSaved(true);
  };

  return (
    <PanelFrame label={`${row?.name ?? 'Person'} journey`} title={row?.name ?? 'Loading…'} onClose={onClose}>
      <ErrorNote message={loadError} />
      {row && (
        <>
          <p className="mt-1 text-sm text-muted">{journeyEvidence(row)}</p>
          <JourneyStrip row={row} />
          <form onSubmit={onSubmit} className="mt-5 space-y-3">
            <h3 className="font-heading text-heading text-lg">Plan</h3>
            <Field label="Aiming to">
              <select value={target} onChange={(e) => setTarget(e.target.value)} className={inputCls}>
                <option value="">No target yet</option>
                {(Object.keys(TARGET_LABELS) as JourneyTarget[]).map((t) => (
                  <option key={t} value={t}>
                    {TARGET_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Next step">
              <input value={step} onChange={(e) => setStep(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Due">
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={inputCls} />
            </Field>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />I am following up
            </label>
            <ErrorNote message={act.error} />
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={act.busy} className={primaryBtn}>
                Save plan
              </button>
              {(row.target || row.next_step || row.due_on) && (
                <button
                  type="button"
                  disabled={act.busy}
                  onClick={async () => {
                    if ((await act.run(() => clearPlan(personId))).ok) onClose();
                  }}
                  className={linkBtn}
                >
                  Clear plan
                </button>
              )}
              {saved && (
                <span role="status" className="text-sm text-muted">
                  Saved
                </span>
              )}
              <button type="button" onClick={() => goTo('people', personId)} className={`${linkBtn} ml-auto`}>
                Open full record
              </button>
            </div>
          </form>
        </>
      )}
    </PanelFrame>
  );
}

function Card({ row, open, onOpen, now }: { row: JourneyRow; open: boolean; onOpen: () => void; now: string }) {
  const late = isOverdue(row.due_on, now);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-pressed={open}
        data-person-id={row.person_id}
        className={`w-full rounded-lg border p-2.5 text-left text-sm hover:border-primary focus-visible:outline-2 focus-visible:outline-primary ${
          open ? 'border-primary bg-primary/10' : 'border-gray-200 dark:border-gray-700'
        }`}
      >
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-semibold">{row.name}</span>
          <PersonTags
            person={{ status: row.status, mentor: row.mentor }}
            showStatus={row.stage !== 'attendee' && row.stage !== 'supporter'}
          />
        </span>
        <span className="mt-0.5 block text-xs text-muted">{journeyEvidence(row)}</span>
        {row.serving_now > 0 && <span className="mt-1 block text-xs text-sky-700 dark:text-sky-300">Serving now</span>}
        {row.target && (
          <span className="mt-1 inline-block rounded-full border border-dashed border-primary px-2 py-0.5 text-xs text-primary">
            Aiming: {TARGET_LABELS[row.target]}
          </span>
        )}
        {row.next_step && (
          <span className="mt-1 block text-xs">
            {row.next_step}
            {row.due_on && (
              <span className={late ? 'font-semibold text-red-700 dark:text-red-300' : 'text-muted'}>
                {' '}
                · {late ? 'date passed, ' : 'due '}
                {row.due_on}
              </span>
            )}
          </span>
        )}
      </button>
    </li>
  );
}

export default function JourneyView({
  data,
  selectedId,
  onSelect,
  goTo,
}: {
  data: Data;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  goTo: (v: View, id: number) => void;
}) {
  const [q, setQ] = useState('');
  const [toggles, setToggles] = useState<Toggles>({
    mine: false,
    overdue: false,
    hasTarget: false,
    stalled: false,
    hideDnc: true,
  });
  const [year, setYear] = useState<number | null>(null);
  const [board, setBoard] = useState<JourneyBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [active, setActive] = useState<Lane | null>(null);
  const refs = useRef<Partial<Record<Lane, HTMLElement | null>>>({});
  const key = query(q, toggles, year);

  useEffect(() => {
    let current = true;
    const t = setTimeout(
      () =>
        getJourney(key)
          .then((b) => {
            if (current) {
              setBoard(b);
              setError(null);
            }
          })
          .catch((e: ApiError) => current && setError(e.message)), // request() only ever throws ApiError
      q ? 250 : 0
    );
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [key, version, q]);

  const more = async (lane: Lane) => {
    const col = (board as JourneyBoard).columns[lane];
    try {
      const next = await getJourneyColumn(`${key}&stage=${lane}&offset=${col.people.length}`);
      setBoard({
        ...(board as JourneyBoard),
        columns: { ...(board as JourneyBoard).columns, [lane]: { ...next, people: [...col.people, ...next.people] } },
      });
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const reload = useCallback(async () => setVersion((v) => v + 1), []);
  const pick = (lane: Lane) => {
    setActive(lane);
    refs.current[lane]?.scrollIntoView?.({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  };
  const now = today();
  const years = board ? Array.from({ length: 6 }, (_, i) => board.thisYear - i) : [];

  return (
    <Split
      open={selectedId !== null}
      list={
        <div>
          <p className="mb-3 max-w-prose text-sm text-muted">
            Each person sits at the furthest step their records show. Serving on a committee or the board is its own
            lane, since it does not need leading first. Set a target and a next step to plan where someone could go.
          </p>
          <ErrorNote message={error} />
          {!board && !error && <p className="text-sm text-muted">Loading…</p>}
          {board && (
            <>
              <Funnel funnel={board.funnel} year={year} years={years} onYear={setYear} active={active} onPick={pick} />
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Find a person"
                  aria-label="Find a person"
                  className={`${inputCls} max-w-56`}
                />
                {TOGGLES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    aria-pressed={toggles[t.key]}
                    onClick={() => setToggles({ ...toggles, [t.key]: !toggles[t.key] })}
                    className={`rounded-full border px-3 py-1 text-sm ${
                      toggles[t.key]
                        ? 'border-transparent bg-(--aw-color-primary-strong) text-white'
                        : 'border-gray-300 text-muted hover:text-default dark:border-gray-600'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-3 overflow-x-auto pb-3">
                {LANES.map((lane) => {
                  const col = board.columns[lane.id];
                  return (
                    <section
                      key={lane.id}
                      ref={(el) => {
                        refs.current[lane.id] = el;
                      }}
                      aria-label={lane.label}
                      className={`w-64 shrink-0 rounded-xl border p-2 ${
                        active === lane.id ? 'border-primary' : 'border-gray-200 dark:border-gray-700'
                      } ${lane.id === 'serving' ? 'bg-sky-50/50 dark:bg-sky-900/10' : ''}`}
                    >
                      <h3 className="mb-2 flex items-baseline justify-between px-1 font-heading text-heading">
                        {lane.label}
                        <span className="text-sm text-muted tabular-nums">{col.total}</span>
                      </h3>
                      {col.people.length === 0 && <p className="px-1 py-4 text-sm text-muted">No one here.</p>}
                      <ul className="space-y-2">
                        {col.people.map((p) => (
                          <Card
                            key={p.person_id}
                            row={p}
                            open={selectedId === p.person_id}
                            onOpen={() => onSelect(p.person_id)}
                            now={now}
                          />
                        ))}
                      </ul>
                      {col.people.length < col.total && (
                        <button type="button" onClick={() => more(lane.id)} className={`${linkBtn} mt-2 px-1`}>
                          Show more ({col.total - col.people.length})
                        </button>
                      )}
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </div>
      }
      panel={
        selectedId !== null && (
          <PlanPanel
            key={selectedId}
            personId={selectedId}
            me={data.me as string}
            onChanged={reload}
            onClose={() => onSelect(null)}
            goTo={goTo}
          />
        )
      }
    />
  );
}
