import { JOURNEY_STAGES, type JourneyFunnel, type JourneyStage } from './model';

const STEPS: { id: JourneyStage | 'serving'; label: string; count: keyof JourneyFunnel; fresh: keyof JourneyFunnel }[] =
  [
    { id: 'attendee', label: 'Attended', count: 'attendee', fresh: 'attendee_new' },
    { id: 'volunteer', label: 'Volunteered or beyond', count: 'volunteer', fresh: 'volunteer_new' },
    { id: 'activity', label: 'Led an activity or beyond', count: 'activity', fresh: 'activity_new' },
    { id: 'class', label: 'Led a class', count: 'class', fresh: 'class_new' },
    { id: 'serving', label: 'Serving now', count: 'serving_now', fresh: 'serving_new' },
  ];

/**
 * How many people have reached each step, as bars. The first four are cumulative (everyone
 * at or beyond that stage), so each is no longer than the one above; the percentage is the
 * share of the step before. Serving sits apart, since it does not need leading first. With a
 * year chosen, each step also says how many first reached it that year.
 */
export default function Funnel({
  funnel,
  year,
  years,
  onYear,
  active,
  onPick,
}: {
  funnel: JourneyFunnel;
  year: number | null;
  years: number[];
  onYear: (y: number | null) => void;
  active: string | null;
  onPick: (id: JourneyStage | 'serving') => void;
}) {
  const top = Math.max(funnel.attendee, funnel.serving_now, 1);
  return (
    <section aria-label="Funnel" className="mb-5 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-heading text-lg">How far people get</h2>
        <label className="flex items-center gap-2 text-sm text-muted">
          First reached in
          <select
            value={year ?? ''}
            onChange={(e) => onYear(e.target.value ? Number(e.target.value) : null)}
            className="rounded-lg border border-gray-300 bg-transparent px-2 py-1 dark:border-gray-600"
          >
            <option value="">any year</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ul className="space-y-1.5">
        {STEPS.map((s, i) => {
          const n = funnel[s.count] as number;
          const before = i > 0 && s.id !== 'serving' ? (funnel[STEPS[i - 1].count] as number) : null;
          const share = before ? Math.round((n / before) * 100) : null;
          const fresh = funnel[s.fresh] as number;
          const label = JOURNEY_STAGES.find((j) => j.id === s.id)?.label ?? s.label;
          return (
            <li key={s.id}>
              <button
                type="button"
                aria-pressed={active === s.id}
                onClick={() => onPick(s.id)}
                className="group grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-lg px-1 py-1 text-left text-sm hover:bg-primary/5 sm:grid-cols-[13rem_1fr_auto]"
              >
                <span className={active === s.id ? 'font-semibold text-primary' : ''}>{s.label}</span>
                <span
                  className="order-3 col-span-2 h-5 overflow-hidden rounded bg-primary/10 sm:order-none sm:col-span-1"
                  aria-hidden="true"
                >
                  <span
                    className={`block h-full rounded ${s.id === 'serving' ? 'bg-sky-600/70' : 'bg-(--aw-color-primary-strong)'}`}
                    style={{ width: `${Math.max((n / top) * 100, n > 0 ? 1.5 : 0)}%` }}
                  />
                </span>
                <span className="tabular-nums">
                  <strong>{n}</strong>
                  {share !== null && (
                    <span className="text-muted">
                      {' '}
                      · {share}% of {STEPS[i - 1].label.toLowerCase()}
                    </span>
                  )}
                  {year !== null && (
                    <span className="ml-2 text-primary">
                      +{fresh} in {year}
                    </span>
                  )}
                  <span className="sr-only"> {label}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-muted">
        {funnel.supporter - funnel.attendee} more are supporters only: members or donors who have not come to an event.
        Each bar counts everyone at that step or further. Volunteering has only been recorded recently, so most leaders
        reach their step without it. Click a step to jump to its column.
      </p>
    </section>
  );
}
