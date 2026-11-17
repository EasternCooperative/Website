import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, loadAll } from './api';
import Dashboard from './Dashboard';
import PersonPanel from './PersonPanel';
import { DEFAULT_FILTERS, buildRows, type Data, type Filters, type SortKey } from './model';

export default function LeadershipApp() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'name', descending: false });

  const reload = useCallback(async () => {
    try {
      setData(await loadAll());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the leadership data.');
      throw e;
    }
  }, []);

  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);

  const rows = useMemo(() => (data ? buildRows(data) : []), [data]);
  const selected = data?.people.find((p) => p.id === selectedId) ?? null;

  const onSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, descending: !s.descending }
        : // Counts read best biggest-first; names read best A to Z.
          { key, descending: key !== 'name' }
    );

  return (
    <section className="py-10 px-4 max-w-[96rem] mx-auto">
      <h1 className="font-heading text-heading text-3xl font-bold mb-1">Leadership Tracker</h1>
      <p className="text-muted mb-6 max-w-prose">
        Who has led what, at every event on record. Use it to see who is ready for something new and who could staff a
        class. Open a person to record availability and readiness notes. Private to the board and leadership team.
        {data?.me && <span className="mt-1 block text-xs">Signed in as {data.me}</span>}
      </p>

      {error && !data && (
        <p role="alert" className="rounded bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 p-3">
          {error}
        </p>
      )}
      {!data && !error && <p className="text-muted">Loading…</p>}

      {data && (
        <div className={selected ? 'grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_26rem]' : ''}>
          <Dashboard
            rows={rows}
            activityTypes={data.activityTypes}
            filters={filters}
            onFilters={setFilters}
            sort={sort}
            onSort={onSort}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          {selected && (
            <div className="lg:sticky lg:top-20">
              <PersonPanel
                key={selected.id}
                data={data}
                person={selected}
                onChanged={reload}
                onClose={() => {
                  setSelectedId(null);
                  // Hand focus back to the person's row, so keyboard users keep their place.
                  requestAnimationFrame(() =>
                    document.querySelector<HTMLElement>(`[data-person-id="${selected.id}"]`)?.focus()
                  );
                }}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
