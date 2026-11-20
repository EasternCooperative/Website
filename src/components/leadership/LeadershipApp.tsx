import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, loadAll } from './api';
import Dashboard from './Dashboard';
import ActivitiesView from './ActivitiesView';
import EventsView from './EventsView';
import { Split } from './forms';
import ListsView from './ListsView';
import NewPersonPanel from './NewPersonPanel';
import DuplicatesView from './DuplicatesView';
import AdminMenu from './AdminMenu';
import { formatHash, parseHash } from './route';
import UsersView, { LEVEL_LABELS } from './UsersView';
import PersonPanel from './PersonPanel';
import { DEFAULT_FILTERS, buildRows, type Data, type Filters, type SortKey, type View } from './model';

// The main tabs, in the order people reach for them, then the admin-only views.
const MAIN_VIEWS: { id: View; label: string }[] = [
  { id: 'people', label: 'People' },
  { id: 'lists', label: 'Outreach' },
  { id: 'events', label: 'Events' },
  { id: 'activities', label: 'Activities' },
];
const NO_VIEWS: { id: View; label: string }[] = [];
const ADMIN_VIEWS: { id: View; label: string }[] = [
  { id: 'duplicates', label: 'Duplicates' },
  { id: 'users', label: 'Access' },
];

export default function LeadershipApp() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setViewState] = useState<View>('people');
  const [selectedId, setSelectedState] = useState<number | 'new' | null>(null);
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

  const admin = data?.isAdmin ? ADMIN_VIEWS : NO_VIEWS;
  const allowed = useMemo(() => [...MAIN_VIEWS, ...admin].map((v) => v.id), [admin]);

  // The address bar and the screen stay in step: opening a view or a person updates the
  // hash, and following a link or pressing Back updates the screen.
  const go = useCallback((next: View, id: number | null = null) => {
    const hash = formatHash(next, id);
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
    setViewState(next);
    setSelectedState(id);
  }, []);
  useEffect(() => {
    const read = () => {
      const r = parseHash(window.location.hash, allowed, 'people');
      setViewState(r.view);
      setSelectedState(r.id);
    };
    read();
    window.addEventListener('popstate', read);
    window.addEventListener('hashchange', read);
    return () => {
      window.removeEventListener('popstate', read);
      window.removeEventListener('hashchange', read);
    };
  }, [allowed]);
  const setView = (v: View) => go(v);
  const setSelectedId = (id: number | 'new' | null) => {
    if (id === 'new') {
      setSelectedState('new');
      return;
    }
    go(view, id);
  };
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
      <h1 className="font-heading text-heading text-3xl font-bold mb-1">Engagement</h1>
      <p className="text-muted mb-6 max-w-prose">
        Who has come, given, led, and served, and who to ask next. Add people, events, and activities as they come up,
        and record who led what. Open a person to set availability and write readiness notes. Private to the board and
        leadership team.
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
          <div className="mb-5 flex items-end border-b border-gray-200 dark:border-gray-700">
            <nav aria-label="Sections" className="flex min-w-0 flex-1 gap-1 overflow-x-auto whitespace-nowrap">
              {MAIN_VIEWS.map((v) => (
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
            {admin.length > 0 && (
              <AdminMenu label="Admin" items={admin} current={view} onSelect={(id) => setView(id as View)} />
            )}
          </div>

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
