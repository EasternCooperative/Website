import { useEffect, useState } from 'react';
import { ApiError, createOutreach, getEngagement } from './api';
import { ErrorNote, Split, inputCls, linkBtn, secondaryBtn, surfaceHover, useAction } from './forms';
import { PersonTags } from './marks';
import {
  LISTS,
  OUTREACH_STATUS_LABELS,
  factsFor,
  formatPartialDate,
  listQuery,
  type Data,
  type EngagementPage,
  type EngagementRow,
  type ListDef,
  type ListId,
  type View,
} from './model';
import PersonPanel from './PersonPanel';

type Values = Record<string, number | boolean>;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Where outreach for this person and list stands, from the most recent record. */
function outreachNote(data: Data, personId: number, goal: string): string {
  const mine = (data.outreach ?? []).filter((o) => o.person_id === personId && o.goal === goal);
  const last = mine.sort((a, b) => b.id - a.id)[0];
  if (!last) return '';
  const when = last.contacted_on ?? last.snooze_until;
  return `${OUTREACH_STATUS_LABELS[last.status] ?? last.status}${when ? ` ${formatPartialDate(when)}` : ''}`;
}

const ACTIONS: { label: string; status: string; days?: number }[] = [
  { label: 'Mark contacted', status: 'contacted' },
  { label: 'Snooze 6 months', status: 'snoozed', days: 182 },
  { label: 'Declined', status: 'declined' },
  { label: 'Do not contact', status: 'do_not_contact' },
];

/**
 * Who to invite, as saved lists you can adjust. Every row shows the facts behind it, and
 * a person is left out once they are contacted, snoozed, or have asked not to be.
 */
export default function ListsView({
  data,
  onChanged,
  goTo,
}: {
  data: Data;
  onChanged: () => Promise<void>;
  goTo: (v: View) => void;
}) {
  const [listId, setListId] = useState<ListId>('back');
  const [settings, setSettings] = useState<Partial<Record<ListId, Values>>>({});
  const [rows, setRows] = useState<EngagementRow[]>([]);
  const [page, setPage] = useState<EngagementPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const act = useAction(async () => {
    await onChanged();
    setVersion((v) => v + 1);
  });

  const list = LISTS.find((l) => l.id === listId) as ListDef;
  const values = { ...list.defaults, ...settings[listId] };
  const key = JSON.stringify(values);

  useEffect(() => {
    let current = true;
    setPage(null);
    getEngagement(listQuery(list, values, new Date()))
      .then((p) => {
        if (current) {
          setRows(p.people);
          setPage(p);
          setLoadError(null);
        }
      })
      .catch((e: ApiError) => current && setLoadError(e.message)); // request() only ever throws ApiError
    return () => {
      current = false;
    };
  }, [listId, key, version]);

  const more = async () => {
    try {
      const next = await getEngagement(listQuery(list, values, new Date(), rows.length));
      setRows((r) => [...r, ...next.people]);
      setPage(next);
    } catch (e) {
      setLoadError((e as ApiError).message);
    }
  };

  const setValue = (k: string, v: number | boolean) =>
    setSettings((s) => ({ ...s, [listId]: { ...s[listId], [k]: v } }));
  const record = (row: EngagementRow, a: (typeof ACTIONS)[number]) => {
    const now = new Date();
    const until = new Date(now);
    until.setDate(until.getDate() + (a.days ?? 0));
    void act.run(() =>
      createOutreach({
        person_id: row.person_id,
        goal: list.goal,
        status: a.status,
        contacted_on: a.status === 'contacted' ? isoDay(now) : null,
        snooze_until: a.status === 'snoozed' ? isoDay(until) : null,
      })
    );
  };

  const person = data.people.find((p) => p.id === selectedId);

  return (
    <Split
      open={person !== undefined}
      list={
        <div>
          <div role="group" aria-label="Lists" className="mb-3 flex flex-wrap gap-1.5">
            {LISTS.map((l) => (
              <button
                key={l.id}
                type="button"
                aria-pressed={listId === l.id}
                onClick={() => setListId(l.id)}
                className={`rounded-full border px-3.5 py-1.5 text-sm ${
                  listId === l.id
                    ? 'border-transparent bg-(--aw-color-primary-strong) text-white'
                    : 'border-gray-300 text-muted hover:text-default dark:border-gray-600'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <p className="mb-3 text-sm text-muted">
            {list.blurb} People who were contacted in the last six months, are snoozed, or asked not to be contacted are
            left out.
          </p>

          {list.controls.length > 0 && (
            <div className="mb-4 flex flex-wrap items-end gap-x-5 gap-y-3 text-sm">
              {list.controls.map((c) =>
                c.kind === 'number' ? (
                  <label key={c.key} className="block">
                    <span className="mb-1 block text-muted">{c.label}</span>
                    <input
                      type="number"
                      min={c.min}
                      max={c.max}
                      value={String(values[c.key])}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isInteger(n) && n >= c.min && n <= c.max) setValue(c.key, n);
                      }}
                      className={`${inputCls} w-24`}
                    />
                  </label>
                ) : (
                  <label key={c.key} className="flex cursor-pointer items-center gap-2 pb-1.5">
                    <input
                      type="checkbox"
                      checked={Boolean(values[c.key])}
                      onChange={(e) => setValue(c.key, e.target.checked)}
                    />
                    {c.label}
                  </label>
                )
              )}
            </div>
          )}

          <ErrorNote message={loadError ?? act.error} />
          {!page && !loadError && <p className="text-sm text-muted">Loading…</p>}
          {page && (
            <p className="mb-2 text-sm text-muted" aria-live="polite">
              {page.total} {page.total === 1 ? 'person' : 'people'}
            </p>
          )}
          {page && rows.length === 0 && (
            <p className="rounded-xl border border-gray-200 px-3 py-8 text-center text-muted dark:border-gray-700">
              {list.empty}
            </p>
          )}
          {rows.length > 0 && (
            <ul className="divide-y divide-gray-200 rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
              {rows.map((r) => {
                const p = data.people.find((x) => x.id === r.person_id);
                const note = outreachNote(data, r.person_id, list.goal);
                return (
                  <li key={r.person_id} className={`px-3 py-2.5 ${selectedId === r.person_id ? 'bg-primary/10' : ''}`}>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <button
                        type="button"
                        onClick={() => setSelectedId(r.person_id)}
                        aria-pressed={selectedId === r.person_id}
                        className="text-left font-semibold hover:text-primary hover:underline"
                      >
                        {r.name}
                      </button>
                      {p && (
                        <span className="inline-flex gap-1">
                          <PersonTags person={p} showStatus={r.roles_total > 0} />
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-muted">{factsFor(r).join(' · ')}</p>
                    {note && <p className="text-xs text-muted">{note}</p>}
                    <div className={`mt-1.5 flex flex-wrap gap-x-3 gap-y-1 rounded ${surfaceHover}`}>
                      {ACTIONS.map((a) => (
                        <button
                          key={a.status}
                          type="button"
                          disabled={act.busy}
                          onClick={() => record(r, a)}
                          aria-label={`${a.label}: ${r.name}`}
                          className={linkBtn}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {page && rows.length < page.total && (
            <button type="button" onClick={more} className={`${secondaryBtn} mt-3`}>
              Show more
            </button>
          )}
        </div>
      }
      panel={
        person && (
          <PersonPanel
            key={person.id}
            data={data}
            person={person}
            goTo={goTo}
            onClose={() => setSelectedId(null)}
            onChanged={async () => {
              await onChanged();
              setVersion((v) => v + 1);
            }}
          />
        )
      }
    />
  );
}
