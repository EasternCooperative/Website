import {
  STATUSES,
  STATUS_LABELS,
  filterRows,
  formatCounts,
  intensity,
  sortRows,
  type Cell,
  type Filters,
  type PersonRow,
  type SortKey,
} from './model';

const SHADE = ['', 'bg-primary/10', 'bg-primary/25', 'bg-primary/45'] as const;

interface Props {
  rows: PersonRow[];
  activityTypes: string[];
  filters: Filters;
  onFilters: (f: Filters) => void;
  sort: { key: SortKey; descending: boolean };
  onSort: (key: SortKey) => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
}

function CellContent({ cell }: { cell: Cell | undefined }) {
  if (!cell)
    return (
      <span className="text-muted" aria-label="No experience">
        ·
      </span>
    );
  const classText = formatCounts(cell.class);
  const activityText = formatCounts(cell.activity);
  return (
    <>
      {classText && (
        <div>
          <span className="text-xs text-muted">Class </span>
          {classText}
        </div>
      )}
      {activityText && (
        <div>
          <span className="text-xs text-muted">Act. </span>
          {activityText}
        </div>
      )}
    </>
  );
}

export default function Dashboard({
  rows,
  activityTypes,
  filters,
  onFilters,
  sort,
  onSort,
  selectedId,
  onSelect,
}: Props) {
  const visible = sortRows(filterRows(rows, filters), sort.key, sort.descending);
  const ariaSort = (key: SortKey) => (sort.key === key ? (sort.descending ? 'descending' : 'ascending') : 'none');
  const arrow = (key: SortKey) => (sort.key === key ? (sort.descending ? ' ▼' : ' ▲') : '');

  const header = (key: SortKey, label: string, extra = '') => (
    <th scope="col" aria-sort={ariaSort(key)} className={`px-2 py-2 text-left font-semibold align-bottom ${extra}`}>
      <button type="button" onClick={() => onSort(key)} className="font-semibold hover:underline text-left">
        {label}
        {arrow(key)}
      </button>
    </th>
  );

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <label className="text-sm">
          <span className="block text-muted mb-1">Find a person</span>
          <input
            type="search"
            value={filters.query}
            onChange={(e) => onFilters({ ...filters, query: e.target.value })}
            className="rounded border border-gray-300 dark:border-gray-600 bg-transparent px-2 py-1"
          />
        </label>
        <label className="text-sm">
          <span className="block text-muted mb-1">Status</span>
          <select
            value={filters.status}
            onChange={(e) => onFilters({ ...filters, status: e.target.value as Filters['status'] })}
            className="rounded border border-gray-300 dark:border-gray-600 bg-transparent px-2 py-1"
          >
            <option value="all">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted basis-full sm:basis-auto">
          S = solo, P = partner, A = assisting. Shading shows how much, not who is ready.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 dark:bg-gray-800/50">
            <tr>
              {header('name', 'Person', 'sticky left-0 bg-gray-50 dark:bg-gray-800 min-w-[11rem]')}
              {activityTypes.map((t) => header(`type:${t}`, t, 'min-w-[6.5rem]'))}
              {header('total', 'Total')}
              {header('recent', 'Last led')}
              <th scope="col" className="px-2 py-2 text-left font-semibold align-bottom min-w-[12rem]">
                Latest “ready” note
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={row.person.id}
                className={`border-t border-gray-200 dark:border-gray-700 ${row.person.id === selectedId ? 'bg-primary/5' : ''}`}
              >
                <th
                  scope="row"
                  className="sticky left-0 bg-white dark:bg-gray-900 px-2 py-2 text-left font-normal align-top"
                >
                  <button
                    type="button"
                    onClick={() => onSelect(row.person.id)}
                    aria-pressed={row.person.id === selectedId}
                    className="font-semibold text-left hover:underline"
                  >
                    {row.person.name}
                  </button>
                  {row.person.status !== 'active' && (
                    <span className="block text-xs text-muted">{STATUS_LABELS[row.person.status]}</span>
                  )}
                </th>
                {activityTypes.map((t) => {
                  const cell = row.cells.get(t);
                  return (
                    <td key={t} className={`px-2 py-2 align-top ${SHADE[intensity(cell?.total ?? 0)]}`}>
                      <CellContent cell={cell} />
                    </td>
                  );
                })}
                <td className="px-2 py-2 align-top tabular-nums">{row.total}</td>
                <td className="px-2 py-2 align-top tabular-nums">{row.lastYear ?? '·'}</td>
                <td className="px-2 py-2 align-top text-xs">
                  {row.latestReady ? (
                    <>
                      {row.latestReady.focus && <strong>{row.latestReady.focus}: </strong>}
                      {row.latestReady.body}
                      <span className="block text-muted">{row.latestReady.created_at.slice(0, 10)}</span>
                    </>
                  ) : (
                    <span className="text-muted">·</span>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={activityTypes.length + 4} className="px-2 py-6 text-center text-muted">
                  No one matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
