import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { ApiError, addNote, deleteNote, savePerson } from './api';
import { Icon, PersonTags, RoleCounts, RoleMark, TONES } from './marks';
import {
  ROLE_LABELS,
  eventLabel,
  STATUSES,
  STATUS_LABELS,
  groupByEvent,
  roleHistory,
  summarizeByType,
  type Data,
  type Person,
  type Status,
} from './model';

interface Props {
  data: Data;
  person: Person;
  onChanged: () => Promise<void>;
  onClose: () => void;
}

const input =
  'w-full rounded-lg border border-gray-300 bg-transparent px-2.5 py-1.5 text-sm dark:border-gray-600 focus-visible:outline-2 focus-visible:outline-primary';
const STATUS_HINT: Record<Status, string> = {
  active: 'Can be asked to lead',
  hiatus: 'Taking a break for now',
  inactive: 'Not leading any more',
};
const SELECTED_TONE: Record<Status, string> = {
  active: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-200',
  hiatus: TONES.hiatus,
  inactive: TONES.inactive,
};

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-gray-200 pt-4 mt-5 dark:border-gray-700">
      <h3 className="font-heading text-heading mb-3 text-lg font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export default function PersonPanel({ data, person, onChanged, onClose }: Props) {
  const [status, setStatus] = useState<Status>(person.status);
  const [mentor, setMentor] = useState(person.mentor === 1);
  const [about, setAbout] = useState(person.notes ?? '');
  const [kind, setKind] = useState<'note' | 'ready'>('note');
  const [focus, setFocus] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  // Move focus into the panel when it opens (it remounts per person), and let
  // Escape close it, except while typing, so a half-written note is not lost.
  useEffect(() => {
    heading.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof Element && e.target.matches('textarea, input:not([type=radio]):not([type=checkbox])');
      if (e.key === 'Escape' && !typing) close.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const history = roleHistory(data, person.id);
  const byType = summarizeByType(history);
  const groups = groupByEvent(history);
  const notes = data.notes
    .filter((n) => n.person_id === person.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const dirty = status !== person.status || mentor !== (person.mentor === 1) || about !== (person.notes ?? '');

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onSave = async () => {
    if (await run(() => savePerson({ ...person, status, mentor: mentor ? 1 : 0, notes: about.trim() || null })))
      setSaved(true);
  };
  const edit =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setSaved(false);
    };

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
    <aside
      aria-label={`${person.name} details`}
      className="fixed inset-0 z-50 overflow-y-auto bg-page p-4 sm:p-5 lg:static lg:z-auto lg:max-h-[calc(100dvh-2rem)] lg:rounded-xl lg:border lg:border-gray-200 lg:dark:border-gray-700"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2
            ref={heading}
            tabIndex={-1}
            className="font-heading text-heading text-2xl font-bold leading-tight focus:outline-none"
          >
            {person.name}
          </h2>
          {person.email && <p className="break-all text-sm text-muted">{person.email}</p>}
          <p className="mt-1 flex flex-wrap gap-1 empty:hidden">
            <PersonTags person={person} />
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 rounded-full p-1.5 text-muted hover:text-default hover:bg-[color-mix(in_srgb,var(--aw-color-text-default)_6%,var(--aw-color-bg-page))]"
        >
          <Icon name="close" size={20} />
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-200"
        >
          {error}
        </p>
      )}

      {byType.length > 0 && (
        <div className="mt-4 rounded-lg p-3 bg-[color-mix(in_srgb,var(--aw-color-text-default)_6%,var(--aw-color-bg-page))]">
          <p className="mb-2 text-sm text-muted">
            {history.length} {history.length === 1 ? 'role' : 'roles'} across {groups.length}{' '}
            {groups.length === 1 ? 'event' : 'events'}
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {byType.map(({ type, counts }) => (
              <div key={type} className="contents">
                <dt className="font-medium">{type}</dt>
                <dd>
                  <RoleCounts counts={counts} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <Section title="Availability">
        <fieldset>
          <legend className="mb-1.5 text-sm text-muted">Leading</legend>
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-gray-300 p-1 dark:border-gray-600">
            {STATUSES.map((s) => (
              <label
                key={s}
                className={`cursor-pointer rounded-md px-2 py-1.5 text-center text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${
                  status === s ? `font-medium ${SELECTED_TONE[s]}` : 'text-muted hover:text-default'
                }`}
              >
                <input
                  type="radio"
                  name="status"
                  value={s}
                  checked={status === s}
                  onChange={() => edit(setStatus)(s)}
                  className="sr-only"
                />
                {STATUS_LABELS[s]}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">{STATUS_HINT[status]}</p>
        </fieldset>

        <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <Icon name="mentor" size={16} className="text-sky-700 dark:text-sky-300" />
            Available as a mentor
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={mentor}
            onChange={(e) => edit(setMentor)(e.target.checked)}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className="relative h-5 w-9 rounded-full bg-gray-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-sky-600 peer-checked:after:translate-x-4 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary dark:bg-gray-600"
          />
        </label>

        <label className="mt-3 block text-sm">
          <span className="mb-1 block text-muted">Private notes about this person</span>
          <textarea rows={3} value={about} onChange={(e) => edit(setAbout)(e.target.value)} className={input} />
        </label>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || busy}
            className="rounded-full bg-(--aw-color-primary-strong) px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Save
          </button>
          {saved && !dirty && (
            <span role="status" className="inline-flex items-center gap-1 text-sm text-muted">
              <Icon name="check" size={14} /> Saved
            </span>
          )}
        </div>
      </Section>

      <Section title="Readiness notes">
        <form onSubmit={onAddNote} className="space-y-2">
          <div role="radiogroup" aria-label="Note type" className="flex gap-1 text-sm">
            {(
              [
                ['note', 'Note'],
                ['ready', 'Ready for…'],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-3 py-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${
                  kind === value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-gray-300 text-muted dark:border-gray-600'
                }`}
              >
                <input
                  type="radio"
                  name="note-kind"
                  value={value}
                  checked={kind === value}
                  onChange={() => setKind(value)}
                  className="sr-only"
                />
                {value === 'ready' && <Icon name="ready" size={13} />}
                {label}
              </label>
            ))}
          </div>
          {kind === 'ready' && (
            <input
              aria-label="Ready for what"
              placeholder="What for, e.g. co-leading a games class"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              className={input}
            />
          )}
          <textarea
            aria-label="Note"
            rows={2}
            placeholder={kind === 'ready' ? 'What you saw that makes them ready' : 'What you saw'}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={input}
          />
          <button
            type="submit"
            disabled={!body.trim() || busy}
            className="rounded-full border border-primary px-4 py-1.5 text-sm font-medium text-primary disabled:opacity-40"
          >
            Add note
          </button>
        </form>
        <ul className="mt-4 space-y-2">
          {notes.map((n) => (
            <li
              key={n.id}
              className={`rounded-lg p-2.5 text-sm ${
                n.kind === 'ready'
                  ? 'border-l-[3px] border-primary bg-primary/5'
                  : 'border border-gray-200 dark:border-gray-700'
              }`}
            >
              <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted">
                <span className="inline-flex items-center gap-1">
                  {n.kind === 'ready' && <Icon name="ready" size={12} className="text-primary" />}
                  {date(n.created_at)}, {n.author}
                </span>
                <button
                  type="button"
                  onClick={() => run(() => deleteNote(n.id))}
                  disabled={busy}
                  className="hover:text-red-700 hover:underline dark:hover:text-red-300"
                  aria-label={`Delete note from ${date(n.created_at)}`}
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
      </Section>

      <Section title="History">
        {groups.length === 0 ? (
          <p className="text-sm text-muted">No roles recorded.</p>
        ) : (
          <ol className="space-y-4">
            {groups.map(({ event, lines }) => (
              <li key={event?.id ?? 'unknown'}>
                <h4 className="mb-1 flex items-baseline gap-2 text-sm">
                  <span className="font-semibold tabular-nums">{event?.year ?? ''}</span>
                  <span className="text-muted">{event ? eventLabel(event) : 'Unknown event'}</span>
                </h4>
                <ul className="space-y-1 border-l border-gray-200 pl-3 dark:border-gray-700">
                  {lines.map(({ role, activity }) => (
                    <li key={role.id} className="text-sm">
                      <span className="flex items-start gap-2">
                        <RoleMark type={role.leadership_type} className="mt-1" />
                        <span>
                          <span className="font-medium">{activity.name}</span>{' '}
                          <span className="text-muted">
                            {ROLE_LABELS[role.leadership_type]}, {activity.type}
                            {activity.subtype ? ` (${activity.subtype})` : ''}
                            {activity.scope === 'activity' ? ', activity' : ''}
                          </span>
                          {role.how_it_went && <span className="block text-xs">{role.how_it_went}</span>}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </aside>
  );
}
