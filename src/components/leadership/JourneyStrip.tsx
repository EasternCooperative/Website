import { STEP_YEARS, TARGET_LABELS, type JourneyRow } from './model';

/**
 * Where one person is on the path: attended, volunteered, led an activity, led a class,
 * each with the year it first happened, plus serving on a committee or the board and the
 * step they are aiming for. A filled dot is reached, a ring is not yet, a dashed ring is the
 * target. The words carry the meaning, so it reads without color.
 */
export default function JourneyStrip({ row }: { row: JourneyRow }) {
  const steps = [
    ...STEP_YEARS.map((s) => ({
      id: s.id as string,
      label: s.label,
      year: row[s.key] as number | null,
      reached: row[s.key] !== null,
    })),
    {
      id: 'serving',
      label: row.on_board_now ? 'On the board' : 'Serving',
      year: row.first_service_year,
      reached: row.service_terms > 0,
    },
  ];
  const aimed = row.target === 'committee' || row.target === 'board' ? 'serving' : row.target;
  return (
    <ol aria-label="Journey" className="mt-3 flex flex-wrap gap-x-1 gap-y-2">
      {steps.map((s, i) => {
        const target = !s.reached && s.id === aimed;
        return (
          <li key={s.id} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden="true" className="mx-0.5 h-px w-3 bg-gray-300 dark:bg-gray-600" />}
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                s.reached
                  ? 'border-transparent bg-primary/15 text-default'
                  : target
                    ? 'border-dashed border-primary text-primary'
                    : 'border-gray-300 text-muted dark:border-gray-600'
              }`}
            >
              <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" className="shrink-0 text-primary">
                {s.reached ? (
                  <circle cx="5" cy="5" r="4.5" fill="currentColor" />
                ) : (
                  <circle
                    cx="5"
                    cy="5"
                    r="3.8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeDasharray={target ? '2 1.6' : undefined}
                    opacity={target ? 1 : 0.45}
                  />
                )}
              </svg>
              <span>
                {s.label}
                <span className="sr-only">{s.reached ? '' : target ? ', aiming for this' : ', not yet'}</span>
                {s.reached && s.year ? <span className="text-muted"> {s.year}</span> : null}
              </span>
            </span>
          </li>
        );
      })}
      {row.target && <li className="sr-only">Aiming to: {TARGET_LABELS[row.target]}</li>}
    </ol>
  );
}
