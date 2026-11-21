import { useMemo, useState } from 'react';
import { createOutreach, createVenue, deleteOutreach, markExpert, saveOutreach, unmarkExpert } from './api';
import { ErrorNote, inputCls, linkBtn, secondaryBtn, useAction } from './forms';
import { PersonTags } from './marks';
import { SEGMENT_NAMES, type Data, type Outreach, type Scope, type View } from './model';
import { venueOptions } from './venues';
import {
  DEFAULT_STAFF_FILTERS,
  DEFAULT_STAFF_WEIGHTS,
  benchDepth,
  candidatesFor,
  milesTo,
  slotLabel,
  type Brief,
  type Candidate,
  type HistoryItem,
  type SegmentKey,
  type StaffFilters,
  type Weights,
} from './staffing';
import sites from '../../data/site-geocodes.json';

const FIRST = 15;
const today = () => new Date().toISOString().slice(0, 10);

/** The address keeps the brief, so a staffing search can be shared or come back to. */
export function briefFromQuery(query: string): Brief {
  const q = new URLSearchParams(query);
  const scope = q.get('scope');
  return {
    venue: q.get('venue') || null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(q.get('date') ?? '') ? q.get('date') : null,
    scope: scope === 'class' || scope === 'activity' ? scope : 'any',
    type: q.get('type') ?? '',
  };
}
export function briefToQuery(b: Brief): string {
  const q = new URLSearchParams();
  if (b.venue) q.set('venue', b.venue);
  if (b.date) q.set('date', b.date);
  if (b.scope !== 'any') q.set('scope', b.scope);
  if (b.type) q.set('type', b.type);
  return q.toString();
}

const SEGMENT_HINT: Record<SegmentKey, string> = {
  experience: 'Times they led this type',
  availability: 'Active, on hiatus, or inactive; mentors a little higher',
  nearness: 'Led at this venue, or lives close',
  timing: 'Led near this time of year',
};

function FitBars({ c }: { c: Candidate }) {
  return (
    <dl className="mt-2 grid grid-cols-4 gap-x-2 gap-y-1">
      {c.segments.map((s) => (
        <div key={s.key} title={SEGMENT_HINT[s.key]}>
          <dt className="text-[0.7rem] uppercase tracking-wide text-muted">
            <span className="hidden sm:inline">{SEGMENT_NAMES[s.key]}</span>
            <span className="sm:hidden" aria-hidden="true">
              {SEGMENT_NAMES[s.key].slice(0, 4)}
            </span>
            <span className="sr-only sm:hidden">{SEGMENT_NAMES[s.key]}</span>
          </dt>
          <dd className="mt-0.5">
            <span className="block h-1.5 overflow-hidden rounded bg-primary/10" aria-hidden="true">
              <span
                className="block h-full rounded bg-(--aw-color-primary-strong)"
                style={{ width: `${Math.round(s.value * 100)}%` }}
              />
            </span>
            <span className="sr-only">{Math.round(s.value * 100)} percent. </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

const ASK_LABEL: Record<string, string> = {
  suggested: 'On the shortlist',
  contacted: 'Asked',
  accepted: 'Said yes',
  declined: 'Said no',
};

const often = (n: number) => (n === 1 ? 'once' : `${n} times`);

/** What someone has actually led, by title, so you can see their classes at a glance. */
function History({ c, type }: { c: Candidate; type: string }) {
  const [all, setAll] = useState(false);
  const same = c.history.filter((h) => h.sameType);
  const shown = all ? c.history : same;
  if (!c.history.length) return null;
  const when = (h: HistoryItem) =>
    [h.led > 0 && `led ${often(h.led)}`, h.assisted > 0 && `helped ${often(h.assisted)}`].filter(Boolean).join(', ');
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-muted">
        What they have led ({same.length} in {type}, {c.history.length} in all)
      </summary>
      {shown.length === 0 && <p className="mt-1 text-xs text-muted">Nothing in {type}.</p>}
      <ul className="mt-1 space-y-0.5">
        {shown.map((h) => (
          <li key={h.title}>
            <span className="font-medium">{h.title}</span>{' '}
            <span className="text-xs text-muted">
              {h.scope === 'class' ? 'class' : 'activity'}
              {all && ` · ${h.type}`} · {when(h)}, last in {h.last}
            </span>
          </li>
        ))}
      </ul>
      {c.history.length > same.length && (
        <button type="button" onClick={() => setAll(!all)} className={`${linkBtn} mt-1`}>
          {all ? `Only ${type}` : `Show all ${c.history.length}`}
        </button>
      )}
    </details>
  );
}

function CandidateCard({
  c,
  busy,
  type,
  onShortlist,
  onExpert,
  onOpen,
}: {
  c: Candidate;
  busy: boolean;
  type: string;
  onShortlist: () => void;
  onExpert: () => void;
  onOpen: () => void;
}) {
  const why = c.segments.map((s) => s.detail).filter(Boolean);
  return (
    <li className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <button
              type="button"
              onClick={onOpen}
              className="text-left font-semibold hover:text-primary hover:underline"
            >
              {c.person.name}
            </button>
            <PersonTags person={c.person} />
          </p>
          {c.place && <p className="text-xs text-muted">Near {c.place}</p>}
        </div>
        <div className="text-right">
          <p className="font-heading text-2xl leading-none tabular-nums" aria-label={`Fit ${c.total} out of 100`}>
            {c.total}
          </p>
          <p className="text-[0.7rem] uppercase tracking-wide text-muted">fit</p>
        </div>
      </div>
      <FitBars c={c} />
      <p className="mt-2 text-sm text-muted">{why.length ? why.join(' · ') : 'No history with this type yet.'}</p>
      <History c={c} type={type} />
      {c.lastContacted && !c.ask && <p className="text-xs text-muted">Contacted {c.lastContacted}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {c.ask ? (
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs">
            {ASK_LABEL[c.ask.status] ?? c.ask.status}
          </span>
        ) : (
          <button type="button" disabled={busy} onClick={onShortlist} className={secondaryBtn + ' px-3 py-1 text-sm'}>
            Shortlist
          </button>
        )}
        <button type="button" disabled={busy} onClick={onExpert} className={linkBtn}>
          {c.expert ? `Remove expert mark for ${type}` : `Mark as an expert in ${type}`}
        </button>
      </div>
    </li>
  );
}

export default function StaffView({
  data,
  query,
  onQuery,
  onChanged,
  goTo,
}: {
  data: Data;
  query: string;
  onQuery: (q: string) => void;
  onChanged: () => Promise<void>;
  goTo: (v: View, id?: number) => void;
}) {
  const brief = useMemo(() => briefFromQuery(query), [query]);
  const [filters, setFilters] = useState<StaffFilters>(DEFAULT_STAFF_FILTERS);
  const [weights, setWeights] = useState<Weights>(DEFAULT_STAFF_WEIGHTS);
  const [showAll, setShowAll] = useState(false);
  const act = useAction(onChanged);
  const now = today();

  const [adding, setAdding] = useState(false);
  const [venueName, setVenueName] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  const venues = useMemo(() => venueOptions(sites, data.venues ?? [], data.events), [data.venues, data.events]);
  const venueLabel = (id: string) => venues.find((v) => v.id === id)?.name ?? id;

  const b: Brief = brief;
  const set = (patch: Partial<Brief>) => {
    setShowAll(false);
    onQuery(briefToQuery({ ...b, ...patch }));
  };
  const pickVenue = (value: string) => {
    if (value === '__new') return setAdding(true);
    set({ venue: value || null });
  };
  const pickDate = (value: string) => {
    set({ date: value || null });
  };
  const slot = slotLabel(b);
  const ready = b.venue !== null && b.type !== '';
  const venue = venues.find((v) => v.id === b.venue && v.lat !== null) as { lat: number; lng: number } | undefined;
  const miles = useMemo(() => milesTo(data.locations, venue), [data.locations, venue]);
  const candidates = useMemo(
    () => (ready ? candidatesFor(data, b, weights, filters, now, miles) : []),
    [data, b, weights, filters, now, ready, miles]
  );
  const depth = useMemo(() => benchDepth(data, b.scope, now), [data, b.scope, now]);
  const asks = (data.outreach ?? []).filter(
    (o) => o.goal === 'staff_slot' && o.venue_id === b.venue && (o.plan_date ?? null) === b.date && o.slot === slot
  );
  const nameOf = (id: number) => data.people.find((p) => p.id === id)?.name ?? 'Someone';
  const shown = showAll ? candidates : candidates.slice(0, FIRST);
  const topDepth = Math.max(...depth.map((d) => d.ever), 1);

  const shortlist = (personId: number) =>
    act.run(() =>
      createOutreach({
        person_id: personId,
        goal: 'staff_slot',
        status: 'suggested',
        venue_id: b.venue,
        plan_date: b.date,
        slot,
      })
    );

  const move = (o: Outreach, status: string) =>
    act.run(() =>
      saveOutreach(o.id, {
        person_id: o.person_id,
        goal: 'staff_slot',
        status,
        contacted_on: status === 'contacted' ? now : o.contacted_on,
        venue_id: o.venue_id,
        plan_date: o.plan_date,
        slot: o.slot,
      })
    );

  return (
    <div>
      <p className="mb-4 max-w-prose text-sm text-muted">
        Choose the venue, and what you need to staff. People are ranked by what their records show, and each score says
        why. Shortlist, ask, and track the answers here.
      </p>

      <div className="mb-5 flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border border-gray-200 p-3 text-sm dark:border-gray-700">
        <label className="block">
          <span className="mb-1 block text-muted">Where</span>
          <select value={b.venue ?? ''} onChange={(e) => pickVenue(e.target.value)} className={`${inputCls} max-w-56`}>
            <option value="">Choose a venue</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
            <option value="__new">Add a venue…</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-muted">When (optional)</span>
          <input type="date" value={b.date ?? ''} onChange={(e) => pickDate(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-muted">Kind</span>
          <select
            value={b.scope}
            onChange={(e) => set({ scope: e.target.value as Scope | 'any' })}
            className={inputCls}
          >
            <option value="any">Class or activity</option>
            <option value="class">Class</option>
            <option value="activity">Activity</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-muted">Type</span>
          <select value={b.type} onChange={(e) => set({ type: e.target.value })} className={inputCls}>
            <option value="">Choose a type</option>
            {data.activityTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      {adding && (
        <form
          className="mb-5 flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border border-gray-200 p-3 text-sm dark:border-gray-700"
          onSubmit={async (e) => {
            e.preventDefault();
            const { ok, value } = await act.run(() =>
              createVenue({ name: venueName.trim(), address: venueAddress.trim() })
            );
            if (ok && value) {
              setAdding(false);
              setVenueName('');
              setVenueAddress('');
              set({ venue: value.id });
            }
          }}
        >
          <label className="block">
            <span className="mb-1 block text-muted">Venue name</span>
            <input value={venueName} onChange={(e) => setVenueName(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-muted">Address</span>
            <input
              value={venueAddress}
              placeholder="609 Geigel Hill Rd, Ottsville, PA"
              onChange={(e) => setVenueAddress(e.target.value)}
              className={`${inputCls} w-80 max-w-full`}
            />
          </label>
          <button
            type="submit"
            disabled={act.busy || !venueName.trim() || !venueAddress.trim()}
            className={secondaryBtn + ' px-3 py-1'}
          >
            Add venue
          </button>
          <button type="button" onClick={() => setAdding(false)} className={linkBtn}>
            Cancel
          </button>
        </form>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div>
          {!ready && (
            <p className="rounded-xl border border-gray-200 px-3 py-8 text-center text-muted dark:border-gray-700">
              Choose a venue and a type to see who could lead it.
            </p>
          )}
          {ready && (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {(
                  [
                    ['hasLed', 'Has led this type'],
                    ['ledHere', 'Has led at this venue'],
                    ['mentorsOnly', 'Mentors only'],
                    ['includeAway', 'Include hiatus and inactive'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={filters[key]}
                    onClick={() => setFilters({ ...filters, [key]: !filters[key] })}
                    className={`rounded-full border px-3 py-1 text-sm ${
                      filters[key]
                        ? 'border-transparent bg-(--aw-color-primary-strong) text-white'
                        : 'border-gray-300 text-muted hover:text-default dark:border-gray-600'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {miles.size > 0 && (
                <label className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
                  Live within
                  <select
                    value={filters.maxMiles ?? 0}
                    onChange={(e) => setFilters({ ...filters, maxMiles: Number(e.target.value) || null })}
                    className={inputCls}
                  >
                    <option value={0}>any distance</option>
                    {[25, 50, 100, 200].map((m) => (
                      <option key={m} value={m}>
                        {m} miles
                      </option>
                    ))}
                  </select>
                  of {venueLabel(b.venue as string)}. People with no known location stay in.
                </label>
              )}
              <details className="mb-3 text-sm">
                <summary className="cursor-pointer text-muted">How the fit is worked out</summary>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                  {(Object.keys(weights) as SegmentKey[]).map((k) => (
                    <label key={k} className="block" title={SEGMENT_HINT[k]}>
                      <span className="mb-1 block text-muted">{SEGMENT_NAMES[k]} weight</span>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        step={0.5}
                        value={weights[k]}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (n >= 0 && n <= 10) setWeights({ ...weights, [k]: n });
                        }}
                        className={`${inputCls} w-20`}
                      />
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted">
                  Each part is scored from 0 to 100 percent and weighted. The score only orders the list: nobody is left
                  out because of it, except people who asked not to be contacted, and people on hiatus or inactive
                  unless you include them.
                </p>
              </details>
              <ErrorNote message={act.error} />
              <p className="mb-2 text-sm text-muted" aria-live="polite">
                {candidates.length} {candidates.length === 1 ? 'person' : 'people'} for {slot} at{' '}
                {venueLabel(b.venue as string)}
                {b.date ? ` on ${b.date}` : ''}
              </p>
              {candidates.length === 0 && (
                <p className="rounded-xl border border-gray-200 px-3 py-8 text-center text-muted dark:border-gray-700">
                  No one matches. Try turning off a filter.
                </p>
              )}
              <ul className="space-y-3">
                {shown.map((c) => (
                  <CandidateCard
                    key={c.person.id}
                    c={c}
                    busy={act.busy}
                    type={b.type}
                    onShortlist={() => shortlist(c.person.id)}
                    onExpert={() =>
                      act.run(async () => {
                        if (c.expert) await unmarkExpert(c.expert.id);
                        else await markExpert(c.person.id, b.type);
                      })
                    }
                    onOpen={() => goTo('people', c.person.id)}
                  />
                ))}
              </ul>
              {candidates.length > shown.length && (
                <button type="button" onClick={() => setShowAll(true)} className={`${linkBtn} mt-3`}>
                  Show all {candidates.length}
                </button>
              )}
            </>
          )}
        </div>

        <aside className="space-y-5">
          {ready && (
            <section aria-label="Slate" className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <h2 className="font-heading text-heading text-lg">{slot}</h2>
              <p className="mb-2 text-xs text-muted">Who you are asking for this slot.</p>
              {asks.length === 0 && <p className="text-sm text-muted">No one yet. Shortlist someone from the list.</p>}
              {(['accepted', 'contacted', 'suggested', 'declined'] as const).map((status) => {
                const rows = asks.filter((o) => o.status === status);
                if (!rows.length) return null;
                return (
                  <div key={status} className="mt-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{ASK_LABEL[status]}</h3>
                    <ul className="mt-1 space-y-1.5">
                      {rows.map((o) => (
                        <li key={o.id} className="rounded-lg bg-primary/5 px-2 py-1.5 text-sm">
                          <span className="font-medium">{nameOf(o.person_id)}</span>
                          {o.contacted_on && <span className="text-muted"> · asked {o.contacted_on}</span>}
                          <span className="mt-1 flex flex-wrap gap-x-3">
                            {status === 'suggested' && (
                              <button
                                type="button"
                                disabled={act.busy}
                                onClick={() => move(o, 'contacted')}
                                className={linkBtn}
                              >
                                Mark asked
                              </button>
                            )}
                            {status === 'contacted' && (
                              <>
                                <button
                                  type="button"
                                  disabled={act.busy}
                                  onClick={() => move(o, 'accepted')}
                                  className={linkBtn}
                                >
                                  Said yes
                                </button>
                                <button
                                  type="button"
                                  disabled={act.busy}
                                  onClick={() => move(o, 'declined')}
                                  className={linkBtn}
                                >
                                  Said no
                                </button>
                              </>
                            )}
                            {status === 'accepted' && (
                              <button type="button" onClick={() => goTo('events')} className={linkBtn}>
                                Record the role
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={act.busy}
                              onClick={() => act.run(() => deleteOutreach(o.id))}
                              aria-label={`Remove ${nameOf(o.person_id)} from the slate`}
                              className={linkBtn}
                            >
                              Remove
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>
          )}

          <section aria-label="Bench depth" className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
            <h2 className="font-heading text-heading text-lg">Bench depth</h2>
            <p className="mb-2 text-xs text-muted">
              Active people who led each type in the last five years. Thinnest first. Click a type to staff it.
            </p>
            <ul className="space-y-1">
              {depth.map((d) => (
                <li key={d.type}>
                  <button
                    type="button"
                    aria-pressed={b.type === d.type}
                    onClick={() => set({ type: d.type })}
                    className="grid w-full grid-cols-[6.5rem_1fr_auto] items-center gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-primary/5"
                  >
                    <span className={b.type === d.type ? 'font-semibold text-primary' : ''}>{d.type}</span>
                    <span className="h-2 overflow-hidden rounded bg-primary/10" aria-hidden="true">
                      <span
                        className={`block h-full rounded ${d.ready < 3 ? 'bg-amber-500' : 'bg-(--aw-color-primary-strong)'}`}
                        style={{ width: `${(d.ready / topDepth) * 100}%` }}
                      />
                    </span>
                    <span className="tabular-nums text-muted">
                      <strong className="text-default">{d.ready}</strong> of {d.ever}
                      {d.mentors > 0 && `, ${d.mentors} ${d.mentors === 1 ? 'mentor' : 'mentors'}`}
                      {d.ready < 3 && <span className="sr-only"> (thin)</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
