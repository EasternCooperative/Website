import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, loadAll } from './api';
import Dashboard from './Dashboard';
import ActivitiesView from './ActivitiesView';
import EventsView from './EventsView';
import { Split } from './forms';
import ListsView from './ListsView';
import NewPersonPanel from './NewPersonPanel';
import DuplicatesView from './DuplicatesView';
import UsersView, { LEVEL_LABELS } from './UsersView';
import PersonPanel from './PersonPanel';
import { DEFAULT_FILTERS, buildRows, type Data, type Filters, type SortKey, type View } from './model';

const ALL_VIEWS: { id: View; label: string }[] = [
  { id: 'people', label: 'People' },
  { id: 'lists', label: 'Lists' },
  { id: 'events', label: 'Events' },
  { id: 'activities', label: 'Activities' },
  { id: 'duplicates', label: 'Duplicates' },
  { id: 'users', label: 'Access' },
];

export default function LeadershipApp() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('people');
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null);
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

  const views = ALL_VIEWS.filter((v) => (v.id !== 'users' && v.id !== 'duplicates') || data?.isAdmin);
  const rows = useMemo(() => (data ? buildRows(data) : []), [data]);
  const selected = typeof selectedId === 'number' ? data?.people.find((p) => p.id === selectedId) : undefined;

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
        class. Add people, events, and activities as they come up, and record who led what. Open a person to set
        availability and write readiness notes. Private to the board and leadership team.
        {data?.me && (
          <span className="mt-1 block text-xs">
            Signed in as {data.me}
            {data.level && `, ${LEVEL_LABELS[data.level]} access${data.isAdmin ? ', admin' : ''}`}
          </span>
        )}
      </p>

      {error && !data && (
        <p role="alert" className="rounded bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 p-3">
          {error}
        </p>
      )}
      {!data && !error && <p className="text-muted">Loading…</p>}

      {data && (
        <>
          <nav
            aria-label="Sections"
            className="mb-5 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-gray-200 dark:border-gray-700"
          >
            {views.map((v) => (
              <button
                key={v.id}
                type="button"
                aria-current={view === v.id ? 'page' : undefined}
                onClick={() => setView(v.id)}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary ${
                  view === v.id ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-default'
                }`}
              >
                {v.label}
              </button>
            ))}
          </nav>

          {view === 'people' && (
            <Split
              open={selectedId === 'new' || selected !== undefined}
              list={
                <Dashboard
                  rows={rows}
                  activityTypes={data.activityTypes}
                  filters={filters}
                  onFilters={setFilters}
                  sort={sort}
                  onSort={onSort}
                  selectedId={typeof selectedId === 'number' ? selectedId : null}
                  onSelect={setSelectedId}
                  onAdd={() => setSelectedId('new')}
                />
              }
              panel={
                selectedId === 'new' ? (
                  <NewPersonPanel
                    data={data}
                    onChanged={reload}
                    onCreated={setSelectedId}
                    onClose={() => setSelectedId(null)}
                  />
                ) : (
                  selected && (
                    <PersonPanel
                      key={selected.id}
                      data={data}
                      person={selected}
                      onChanged={reload}
                      goTo={setView}
                      onClose={() => {
                        setSelectedId(null);
                        // Hand focus back to the person's row, so keyboard users keep their place.
                        requestAnimationFrame(() =>
                          document.querySelector<HTMLElement>(`[data-person-id="${selected.id}"]`)?.focus()
                        );
                      }}
                    />
                  )
                )
              }
            />
          )}
          {view === 'lists' && <ListsView data={data} onChanged={reload} goTo={setView} />}
          {view === 'events' && <EventsView data={data} onChanged={reload} goTo={setView} />}
          {view === 'activities' && <ActivitiesView data={data} onChanged={reload} />}
          {view === 'duplicates' && data.isAdmin && <DuplicatesView onChanged={reload} />}
          {view === 'users' && data.isAdmin && <UsersView me={data.me ?? ''} />}
        </>
      )}
    </section>
  );
}
