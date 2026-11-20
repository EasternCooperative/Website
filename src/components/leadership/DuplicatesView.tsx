import { useCallback, useEffect, useState } from 'react';
import { listDuplicates, mergePeople, previewMerge, type ApiError, type DuplicatePair, type MergePreview } from './api';
import { ErrorNote, linkBtn, primaryBtn, secondaryBtn, surface, useAction } from './forms';

const LABELS: Record<string, string> = {
  registration: 'registrations',
  donation: 'gifts',
  membership: 'membership years',
  volunteer: 'volunteer entries',
  service: 'board or committee terms',
  outreach: 'outreach records',
  journey_note: 'notes',
  role: 'leadership roles',
  email: 'email addresses',
};

const describe = (counts: Record<string, number>) => {
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${LABELS[k] ?? k}`);
  return parts.length ? parts.join(', ') : 'nothing else';
};

function PairCard({ pair, onMerged }: { pair: DuplicatePair; onMerged: () => Promise<void> }) {
  // `keep` is the record that stays. The other one is folded into it.
  const [keep, setKeep] = useState<'a' | 'b' | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const { busy, error, setError, run } = useAction(onMerged);

  const choose = async (which: 'a' | 'b') => {
    const [from, into] = which === 'a' ? [pair.b, pair.a] : [pair.a, pair.b];
    setKeep(which);
    setPreview(null);
    try {
      setPreview(await previewMerge(from.id, into.id));
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  return (
    <li className={`rounded-xl p-4 ${surface}`}>
      <p className="font-medium">
        {pair.a.name} <span className="text-muted">and</span> {pair.b.name}
      </p>
      <p className="text-xs text-muted">{pair.reasons.join(', ')}</p>
      {!keep && (
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" className={secondaryBtn} onClick={() => choose('a')}>
            Keep {pair.a.name}
          </button>
          <button type="button" className={secondaryBtn} onClick={() => choose('b')}>
            Keep {pair.b.name}
          </button>
        </div>
      )}
      {keep && (
        <div className="mt-3 text-sm">
          {preview && (
            <>
              <p>
                Move {describe(preview.counts)} from {preview.from.name} to {preview.into.name}, then retire{' '}
                {preview.from.name}. This cannot be undone from the screen.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className={primaryBtn}
                  disabled={busy}
                  onClick={() => run(() => mergePeople(preview.from.id, preview.into.id))}
                >
                  Merge into {preview.into.name}
                </button>
                <button type="button" className={linkBtn} onClick={() => setKeep(null)}>
                  Cancel
                </button>
              </div>
            </>
          )}
          {!preview && !error && <p className="text-muted">Checking what would move.</p>}
          {!preview && error && (
            <button type="button" className={linkBtn} onClick={() => setKeep(null)}>
              Back
            </button>
          )}
        </div>
      )}
      <ErrorNote message={error} />
    </li>
  );
}

export default function DuplicatesView({ onChanged }: { onChanged: () => Promise<void> }) {
  const [pairs, setPairs] = useState<DuplicatePair[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPairs((await listDuplicates()).pairs);
      setError(null);
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const merged = async () => {
    await onChanged();
    await load();
  };

  return (
    <div className="mt-6 max-w-3xl">
      <p className="text-sm text-muted">
        People who may be one person, from a shared email address or a similar name. Choose which record to keep. Its
        history, and the other record&apos;s, end up together, and the other name is remembered so future imports still
        match.
      </p>
      <ErrorNote message={error} />
      {pairs && pairs.length === 0 && <p className="mt-4">No likely duplicates.</p>}
      <ul className="mt-4 space-y-3">
        {pairs?.map((p) => (
          <PairCard key={`${p.a.id}-${p.b.id}`} pair={p} onMerged={merged} />
        ))}
      </ul>
    </div>
  );
}
