import { useEffect, useState } from 'react';
import { getJourneyPerson } from './api';
import JourneyStrip from './JourneyStrip';
import { linkBtn } from './forms';
import { TARGET_LABELS, journeyEvidence, type JourneyRow } from './model';

/** A person's journey at the top of their record: the strip, the plan, and a way into the Journey view. */
export default function PersonJourney({
  personId,
  refresh,
  onPlan,
}: {
  personId: number;
  refresh: unknown;
  onPlan?: () => void;
}) {
  const [row, setRow] = useState<JourneyRow | null>(null);

  useEffect(() => {
    let current = true;
    getJourneyPerson(personId)
      .then((r) => current && setRow(r))
      .catch(() => current && setRow(null)); // the strip is a convenience: no error banner if it cannot load
    return () => {
      current = false;
    };
  }, [personId, refresh]);

  if (!row) return null;
  return (
    <section aria-label="Journey" className="mt-4">
      <p className="text-sm text-muted">{journeyEvidence(row)}</p>
      <JourneyStrip row={row} />
      {(row.target || row.next_step) && (
        <p className="mt-2 text-sm">
          {row.target && <span className="text-primary">Aiming: {TARGET_LABELS[row.target]}. </span>}
          {row.next_step}
          {row.due_on && <span className="text-muted"> · due {row.due_on}</span>}
        </p>
      )}
      {onPlan && (
        <button type="button" onClick={onPlan} className={`${linkBtn} mt-1`}>
          Plan next step
        </button>
      )}
    </section>
  );
}
