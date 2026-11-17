import { useState, type SyntheticEvent } from 'react';
import { addNote, deleteNote, savePerson } from './api';
import { STATUSES, STATUS_LABELS, roleHistory, type Data, type Person, type Status } from './model';

interface Props {
  data: Data;
  person: Person;
  onChanged: () => Promise<void>;
  onClose: () => void;
}

const ROLE_LABELS = { solo: 'Solo', partner: 'Partner', assisting: 'Assisting' } as const;
const input = 'w-full rounded border border-gray-300 dark:border-gray-600 bg-transparent px-2 py-1 text-sm';

export default function PersonPanel({ data, person, onChanged, onClose }: Props) {
  const [status, setStatus] = useState<Status>(person.status);
  const [about, setAbout] = useState(person.notes ?? '');
  const [kind, setKind] = useState<'note' | 'ready'>('note');
  const [focus, setFocus] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const history = roleHistory(data, person.id);
  const notes = data.notes
    .filter((n) => n.person_id === person.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const dirty = status !== person.status || about !== (person.notes ?? '');

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const onSave = () => run(() => savePerson({ ...person, status, notes: about.trim() || null }));

  const onAddNote = (e: SyntheticEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    void run(async () => {
      await addNote({ person_id: person.id, kind, focus: focus.trim(), body: body.trim() });
      setBody('');
      setFocus('');
    });
  };

  return (
    <aside aria-label={`${person.name} details`} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-heading text-heading text-xl font-bold">{person.name}</h2>
        <button type="button" onClick={onClose} className="text-sm text-muted hover:underline">
          Close
        </button>
      </div>
      {person.email && <p className="text-sm text-muted break-all">{person.email}</p>}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 p-2 text-sm"
        >
          {error}
        </p>
      )}

      <div className="mt-4 space-y-3">
        <label className="block text-sm">
          <span className="block text-muted mb-1">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className={input}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="block text-muted mb-1">About this person (private)</span>
          <textarea rows={3} value={about} onChange={(e) => setAbout(e.target.value)} className={input} />
        </label>
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || busy}
          className="rounded bg-primary text-white px-3 py-1 text-sm disabled:opacity-50"
        >
          Save
        </button>
      </div>

      <h3 className="font-heading text-heading font-semibold mt-6 mb-2">Readiness notes</h3>
      <form onSubmit={onAddNote} className="space-y-2">
        <div className="flex gap-2">
          <select
            aria-label="Note type"
            value={kind}
            onChange={(e) => setKind(e.target.value as 'note' | 'ready')}
            className={`${input} w-auto`}
          >
            <option value="note">Note</option>
            <option value="ready">Ready for…</option>
          </select>
          <input
            aria-label="Focus (optional)"
            placeholder="Focus, e.g. games class"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            className={input}
          />
        </div>
        <textarea
          aria-label="Note"
          rows={2}
          placeholder="What you saw, or what they are ready for"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className={input}
        />
        <button
          type="submit"
          disabled={!body.trim() || busy}
          className="rounded border border-primary text-primary px-3 py-1 text-sm disabled:opacity-50"
        >
          Add note
        </button>
      </form>
      <ul className="mt-3 space-y-2">
        {notes.map((n) => (
          <li key={n.id} className="rounded border border-gray-200 dark:border-gray-700 p-2 text-sm">
            <div className="flex justify-between gap-2 text-xs text-muted">
              <span>
                {n.created_at.slice(0, 10)} · {n.author}
                {n.kind === 'ready' && ' · ready'}
              </span>
              <button
                type="button"
                onClick={() => run(() => deleteNote(n.id))}
                disabled={busy}
                className="hover:underline"
                aria-label={`Delete note from ${n.created_at.slice(0, 10)}`}
              >
                Delete
              </button>
            </div>
            {n.focus && <strong>{n.focus}: </strong>}
            {n.body}
          </li>
        ))}
        {notes.length === 0 && <li className="text-sm text-muted">No notes yet.</li>}
      </ul>

      <h3 className="font-heading text-heading font-semibold mt-6 mb-2">Experience</h3>
      {history.length === 0 ? (
        <p className="text-sm text-muted">No roles recorded.</p>
      ) : (
        <ul className="text-sm divide-y divide-gray-200 dark:divide-gray-700">
          {history.map(({ role, activity, event }) => (
            <li key={role.id} className="py-1.5">
              <span className="font-medium">{activity.name}</span>
              <span className="text-muted">
                {' '}
                · {ROLE_LABELS[role.leadership_type]} · {activity.scope === 'class' ? 'Class' : 'Activity'} ·{' '}
                {activity.type}
                {activity.subtype ? ` / ${activity.subtype}` : ''}
                {event ? ` · ${event.name} ${event.year}` : ''}
              </span>
              {role.how_it_went && <div className="text-xs">{role.how_it_went}</div>}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
