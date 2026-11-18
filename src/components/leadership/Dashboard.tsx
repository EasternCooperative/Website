import type { ReactNode } from 'react';
import { Icon, Legend, PersonTags, RoleCounts, TONES } from './marks';
import {
  STATUSES,
  STATUS_LABELS,
  describeCounts,
  filterRows,
  intensity,
  scopedCounts,
  sortRows,
  statusCounts,
  totalIn,
  type Filters,
  type PersonRow,
  type ScopeFilter,
  type SortKey,
  type Status,
} from './model';

const SHADE = ['', 'bg-primary/10', 'bg-primary/20', 'bg-primary/35'] as const;
const SCOPES: { value: ScopeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'class', label: 'Classes' },
  { value: 'activity', label: 'Activities' },
];
const STATUS_TONE: Record<Status, string> = {
  active: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-200',
  hiatus: TONES.hiatus,
  inactive: TONES.inactive,
};

interface Props {
  rows: PersonRow[];
  activityTypes: string[];
  filters: Filters;
  onFilters: (f: Filters) => void;
  sort: { key: SortKey; descending: boolean };
  onSort: (key: SortKey) => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onAdd: () => void;
}

/** A toggle chip: pressed means "show these people". */
function Chip({
  pressed,
  onClick,
  tone,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  tone: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
        pressed
          ? `border-transparent ${tone}`
          : 'border-gray-300 text-muted hover:border-gray-400 hover:text-default dark:border-gray-600'
      }`}
    >
      {pressed && <Icon name="check" size={14} />}
      {children}
    </button>
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
  onAdd,
}: Props) {
  const visible = sortRows(filterRows(rows, filters), sort.key, sort.descending, filters.scope);
  const counts = statusCounts(rows);
  const toggleStatus = (s: Status) =>
    onFilters({
      ...filters,
      statuses: filters.statuses.includes(s) ? filters.statuses.filter((x) => x !== s) : [...filters.statuses, s],
    });

  const ariaSort = (key: SortKey) => (sort.key === key ? (sort.descending ? 'descending' : 'ascending') : 'none');
  const sortedCol = (key: SortKey) => (sort.key === key ? 'bg-primary/[0.04] dark:bg-white/[0.03]' : '');

  const header = (key: SortKey, label: string, extra = 'z-10') => (
    <th
      key={key}
      scope="col"
      aria-sort={ariaSort(key)}
      className={`sticky top-0 bg-[color-mix(in_srgb,var(--aw-color-text-default)_6%,var(--aw-color-bg-page))] px-2 py-2 text-left align-bottom font-semibold ${extra}`}
    >
      <button
        type="button"
        onClick={() => onSort(key)}
        className={`group inline-flex items-end gap-1 text-left leading-tight hover:text-primary ${
          sort.key === key ? 'text-primary' : ''
        }`}
      >
        {label}
        <Icon
          name={sort.key === key ? (sort.descending ? 'down' : 'up') : 'sortable'}
          size={13}
          className={sort.key === key ? '' : 'opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60'}
        />
      </button>
    </th>
  );

  const total = (row: PersonRow) => (filters.scope === 'all' ? row.total : totalIn(row, filters.scope));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-3">
        <label className="relative">
          <span className="sr-only">Find a person</span>
          <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            placeholder="Find a person"
            value={filters.query}
            onChange={(e) => onFilters({ ...filters, query: e.target.value })}
            className="w-56 rounded-full border border-gray-300 bg-transparent py-1.5 pl-8 pr-3 text-sm dark:border-gray-600"
          />
        </label>

        <div role="group" aria-label="Show people who are" className="flex flex-wrap items-center gap-1.5">
          {STATUSES.map((s) => (
            <Chip key={s} pressed={filters.statuses.includes(s)} onClick={() => toggleStatus(s)} tone={STATUS_TONE[s]}>
              {STATUS_LABELS[s]}
              <span className="tabular-nums opacity-70">{counts[s]}</span>
            </Chip>
          ))}
          <span className="mx-1 hidden h-5 w-px bg-gray-300 sm:block dark:bg-gray-600" aria-hidden="true" />
          <Chip
            pressed={filters.mentorsOnly}
            onClick={() => onFilters({ ...filters, mentorsOnly: !filters.mentorsOnly })}
            tone={TONES.mentor}
          >
            {!filters.mentorsOnly && <Icon name="mentor" size={14} />}
            Mentors only
            <span className="tabular-nums opacity-70">{counts.mentor}</span>
          </Chip>
        </div>

        <fieldset className="flex items-center gap-2 text-sm">
          <legend className="sr-only">Count roles in</legend>
          <span className="text-muted" aria-hidden="true">
            Count roles in
          </span>
          <div className="inline-flex rounded-full border border-gray-300 p-0.5 dark:border-gray-600">
            {SCOPES.map(({ value, label }) => (
              <label
                key={value}
                className={`cursor-pointer rounded-full px-3 py-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${
                  filters.scope === value
                    ? 'bg-(--aw-color-primary-strong) text-white'
                    : 'text-muted hover:text-default'
                }`}
              >
                <input
                  type="radio"
                  name="scope"
                  value={value}
                  checked={filters.scope === value}
                  onChange={() => onFilters({ ...filters, scope: value })}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <button
          type="button"
          onClick={onAdd}
          className="ml-auto rounded-full border border-primary px-4 py-1.5 text-sm font-medium text-primary"
        >
          Add a person
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <Legend />
        <p className="text-sm text-muted" aria-live="polite">
          Showing {visible.length} of {rows.length}
        </p>
      </div>

      <div className="relative max-h-[calc(100dvh-8rem)] overflow-auto rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              {header('name', 'Person', 'left-0 z-20 min-w-[12rem]')}
              {activityTypes.map((t) => header(`type:${t}`, t, 'z-10 min-w-[5.5rem]'))}
              {header('total', 'Total', 'z-10 text-right')}
              {header('recent', 'Last led')}
              <th
                scope="col"
                className="sticky top-0 z-10 min-w-[14rem] bg-[color-mix(in_srgb,var(--aw-color-text-default)_6%,var(--aw-color-bg-page))] px-2 py-2 text-left align-bottom font-semibold"
              >
                Latest “ready for”
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const selected = row.person.id === selectedId;
              const dim = row.person.status === 'inactive' ? 'text-muted' : '';
              return (
                <tr
                  key={row.person.id}
                  onClick={() => onSelect(row.person.id)}
                  className={`group cursor-pointer ${dim} [&>*]:border-t [&>*]:border-gray-200 dark:[&>*]:border-gray-700`}
                >
                  <th
                    scope="row"
                    className={`sticky left-0 z-[1] px-2 py-2 text-left align-top font-normal ${
                      selected
                        ? // Opaque, since the sticky name cell covers cells that scroll under it.
                          'bg-[color-mix(in_srgb,var(--aw-color-primary)_12%,var(--aw-color-bg-page))] shadow-[inset_3px_0_0_var(--aw-color-primary)]'
                        : 'bg-page group-hover:bg-[color-mix(in_srgb,var(--aw-color-text-default)_6%,var(--aw-color-bg-page))]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(row.person.id);
                      }}
                      aria-pressed={selected}
                      data-person-id={row.person.id}
                      className="text-left font-semibold hover:text-primary hover:underline"
                    >
                      {row.person.name}
                    </button>
                    <span className="mt-0.5 flex flex-wrap gap-1 empty:hidden">
                      <PersonTags person={row.person} />
                    </span>
                  </th>
                  {activityTypes.map((t) => {
                    const { counts, total: n } = scopedCounts(row.cells.get(t), filters.scope);
                    return (
                      <td
                        key={t}
                        title={n ? `${t}: ${describeCounts(counts)}` : undefined}
                        className={`px-2 py-2 align-top ${n ? SHADE[intensity(n)] : sortedCol(`type:${t}`)}`}
                      >
                        {n > 0 && <RoleCounts counts={counts} />}
                      </td>
                    );
                  })}
                  <td className={`px-2 py-2 text-right align-top tabular-nums ${sortedCol('total')}`}>
                    {total(row) || ''}
                  </td>
                  <td className={`px-2 py-2 align-top tabular-nums ${sortedCol('recent')}`}>{row.lastYear ?? ''}</td>
                  <td className="px-2 py-2 align-top text-xs">
                    {row.latestReady && (
                      <span className="line-clamp-2" title={row.latestReady.body}>
                        {row.latestReady.focus && <strong>{row.latestReady.focus}: </strong>}
                        {row.latestReady.body}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={activityTypes.length + 4} className="px-2 py-8 text-center text-muted">
                  No one matches. Try turning on more statuses above, or clearing the search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
