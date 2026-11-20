import { useEffect, useState } from 'react';
import { ApiError, getTimeline } from './api';
import { ErrorNote, Section, linkBtn } from './forms';
import { describeItem, dollars, formatPartialDate, groupByYear, type Timeline as TimelineData } from './model';

const FIRST = 12;

/**
 * One person's history across everything we record: what they led, attended, helped
 * with, and served on, plus notes and outreach. Gifts show only as "Gift" and a tier,
 * unless the server says this person may see amounts.
 */
export default function Timeline({ personId, refresh }: { personId: number; refresh: unknown }) {
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let current = true;
    getTimeline(personId)
      .then((t) => {
        if (current) {
          setTimeline(t);
          setError(null);
        }
      })
      .catch((e: ApiError) => current && setError(e.message)); // request() only ever throws ApiError
    return () => {
      current = false;
    };
  }, [personId, refresh]);

  const items = timeline?.items ?? [];
  const shown = all ? items : items.slice(0, FIRST);
  const giving = timeline?.giving;
  const hasGifts = items.some((i) => i.type === 'gift');

  return (
    <Section title="Timeline">
      <ErrorNote message={error} />
      {!timeline && !error && <p className="text-sm text-muted">Loading…</p>}
      {timeline && (
        <>
          {hasGifts && giving && (
            <p className="mb-3 text-sm">
              <span className="text-muted">Giving: </span>
              {giving.total_cents !== undefined ? `${dollars(giving.total_cents)} in all` : (giving.tier ?? '')}
            </p>
          )}
          {items.length === 0 ? (
            <p className="text-sm text-muted">Nothing recorded yet.</p>
          ) : (
            <ol className="space-y-3">
              {groupByYear(shown).map((g) => (
                <li key={g.year}>
                  <h4 className="mb-1 text-sm font-semibold tabular-nums">{g.year}</h4>
                  <ul className="space-y-1.5 border-l border-gray-200 pl-3 dark:border-gray-700">
                    {g.items.map((item) => {
                      const { label, text, sub } = describeItem(item);
                      return (
                        <li key={`${item.type}-${item.id}`} className="grid grid-cols-[5.5rem_1fr] gap-x-2 text-sm">
                          <span className="text-xs leading-5 text-muted">{label}</span>
                          <span>
                            {text}
                            {sub && <span className="block text-xs text-muted">{sub}</span>}
                            {item.type === 'gift' && item.at.length > 4 && (
                              <span className="block text-xs text-muted">{formatPartialDate(item.at)}</span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          )}
          {items.length > FIRST && (
            <button type="button" onClick={() => setAll(!all)} className={`${linkBtn} mt-2`}>
              {all ? 'Show fewer' : `Show all ${items.length}`}
            </button>
          )}
        </>
      )}
    </Section>
  );
}
