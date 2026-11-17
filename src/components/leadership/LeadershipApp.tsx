import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, loadAll } from './api';
import Dashboard from './Dashboard';
import PersonPanel from './PersonPanel';
import { buildRows, type Data, type Filters, type SortKey } from './model';

export default function LeadershipApp() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filters, setFilters] = useState<Filters>({ query: '', status: 'all' });
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
      <p className="text-muted mb-6">
        Everyone’s leading experience at a glance. Private to the board and leadership team.
        {data?.me && <span className="block text-xs">Signed in as {data.me}</span>}
      </p>

      {error && !data && (
        <p role="alert" className="rounded bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 p-3">
          {error}
        </p>
      )}
      {!data && !error && <p className="text-muted">Loading…</p>}

      {data && (
        <div className={selected ? 'grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] items-start' : ''}>
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
            <div className="lg:sticky lg:top-4">
              <PersonPanel
                key={selected.id}
                data={data}
                person={selected}
                onChanged={reload}
                onClose={() => setSelectedId(null)}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
