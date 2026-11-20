import { useState, type SyntheticEvent } from 'react';
import { addNote, deleteNote, deleteRole, deleteService, savePerson } from './api';
import {
  ConfirmRemove,
  ErrorNote,
  Field,
  PanelFrame,
  Section,
  Segmented,
  inputCls,
  linkBtn,
  primaryBtn,
  secondaryBtn,
  surface,
  useAction,
} from './forms';
import { Icon, PersonTags, RoleCounts, RoleMark, TONES } from './marks';
import {
  ROLE_LABELS,
  eventLabel,
  formatTerm,
  STATUSES,
  STATUS_LABELS,
  groupByEvent,
  roleHistory,
  summarizeByType,
  type Data,
  type Person,
  type Service,
  type Status,
  type View,
} from './model';
import RoleForm from './RoleForm';
import ServiceForm from './ServiceForm';
import PersonJourney from './PersonJourney';
import Timeline from './Timeline';

interface Props {
  data: Data;
  person: Person;
  onChanged: () => Promise<void>;
  onClose: () => void;
  goTo?: (view: View, id?: number) => void;
}

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

/** Newest first: by start, else by end, and terms with no dates last. */
const termKey = (s: Service) => s.started_on ?? s.ended_on ?? '';

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function PersonPanel({ data, person, onChanged, onClose, goTo }: Props) {
  const [name, setName] = useState(person.name);
  const [email, setEmail] = useState(person.email ?? '');
  const [status, setStatus] = useState<Status>(person.status);
  const [mentor, setMentor] = useState(person.mentor === 1);
  const [about, setAbout] = useState(person.notes ?? '');
  const [kind, setKind] = useState<'note' | 'ready'>('note');
  const [focus, setFocus] = useState('');
  const [body, setBody] = useState('');
  const [saved, setSaved] = useState(false);
  const [addingRole, setAddingRole] = useState(false);
  const [editingRole, setEditingRole] = useState<number | null>(null);
  const [addingService, setAddingService] = useState(false);
  const [editingService, setEditingService] = useState<number | null>(null);
  const { busy, error, run } = useAction(onChanged);

  const history = roleHistory(data, person.id);
  const byType = summarizeByType(history);
  const groups = groupByEvent(history);
  const services = (data.service ?? [])
    .filter((x) => x.person_id === person.id)
    .sort((x, y) => termKey(y).localeCompare(termKey(x)));
  const notes = data.notes
    .filter((n) => n.person_id === person.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const dirty =
    name.trim() !== person.name ||
    email.trim() !== (person.email ?? '') ||
    status !== person.status ||
    mentor !== (person.mentor === 1) ||
    about !== (person.notes ?? '');

  const onSave = async () => {
    const { ok } = await run(() =>
      savePerson({
        ...person,
        name: name.trim(),
        email: email.trim() || null,
        status,
        mentor: mentor ? 1 : 0,
        notes: about.trim() || null,
      })
    );
    if (ok) setSaved(true);
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
    <PanelFrame
      label={`${person.name} details`}
      title={person.name}
      onClose={onClose}
      meta={
        <>
          {person.email && <p className="break-all text-sm text-muted">{person.email}</p>}
          <p className="mt-1 flex flex-wrap gap-1 empty:hidden">
            <PersonTags person={person} />
          </p>
        </>
      }
    >
      <ErrorNote message={error} />

      <PersonJourney personId={person.id} refresh={data} onPlan={goTo && (() => goTo('journey', person.id))} />

      {byType.length > 0 && (
        <div className={`mt-4 rounded-lg p-3 ${surface}`}>
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

      <Section title="Details">
        <div className="space-y-3">
          <Field label="Name">
            <input value={name} onChange={(e) => edit(setName)(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Email (optional)">
            <input type="email" value={email} onChange={(e) => edit(setEmail)(e.target.value)} className={inputCls} />
          </Field>
        </div>

        <div className="mt-3">
          <Segmented
            name="status"
            legend="Leading"
            value={status}
            options={STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
            tones={SELECTED_TONE}
            onChange={edit(setStatus)}
          />
          <p className="mt-1 text-xs text-muted">{STATUS_HINT[status]}</p>
        </div>

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

        <div className="mt-3">
          <Field label="Private notes about this person">
            <textarea rows={3} value={about} onChange={(e) => edit(setAbout)(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <button type="button" onClick={onSave} disabled={!dirty || !name.trim() || busy} className={primaryBtn}>
            Save
          </button>
          {saved && !dirty && (
            <span role="status" className="inline-flex items-center gap-1 text-sm text-muted">
              <Icon name="check" size={14} /> Saved
            </span>
          )}
        </div>
      </Section>

      <Timeline personId={person.id} refresh={data} />

      <Section title="Board and committees">
        {addingService ? (
          <div className="mb-4 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <ServiceForm
              data={data}
              personId={person.id}
              onChanged={onChanged}
              onDone={() => setAddingService(false)}
            />
          </div>
        ) : (
          <button type="button" onClick={() => setAddingService(true)} className={`${secondaryBtn} mb-4`}>
            Add service
          </button>
        )}
        {services.length === 0 ? (
          <p className="text-sm text-muted">None recorded.</p>
        ) : (
          <ul className="space-y-2">
            {services.map((s) => (
              <li key={s.id} className="text-sm">
                {editingService === s.id ? (
                  <ServiceForm
                    data={data}
                    personId={person.id}
                    service={s}
                    onChanged={onChanged}
                    onDone={() => setEditingService(null)}
                  />
                ) : (
                  <>
                    <span className="font-medium">{s.body}</span>
                    {s.title && <span>, {s.title}</span>}
                    <span className="block text-xs text-muted">{formatTerm(s.started_on, s.ended_on)}</span>
                    {s.note && <span className="block text-xs">{s.note}</span>}
                    <span className="mt-0.5 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setEditingService(s.id)}
                        className={linkBtn}
                        aria-label={`Change ${s.body}`}
                      >
                        Change
                      </button>
                      <ConfirmRemove
                        what={s.body}
                        short
                        disabled={busy}
                        onConfirm={() => void run(() => deleteService(s.id))}
                      />
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
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
              className={inputCls}
            />
          )}
          <textarea
            aria-label="Note"
            rows={2}
            placeholder={kind === 'ready' ? 'What you saw that makes them ready' : 'What you saw'}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={inputCls}
          />
          <button type="submit" disabled={!body.trim() || busy} className={secondaryBtn}>
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
        {addingRole ? (
          <div className="mb-4 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <RoleForm
              data={data}
              personId={person.id}
              onChanged={onChanged}
              onDone={() => setAddingRole(false)}
              goTo={goTo}
            />
          </div>
        ) : (
          <button type="button" onClick={() => setAddingRole(true)} className={`${secondaryBtn} mb-4`}>
            Add a role
          </button>
        )}
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
                <ul className="space-y-2 border-l border-gray-200 pl-3 dark:border-gray-700">
                  {lines.map(({ role, activity }) => (
                    <li key={role.id} className="text-sm">
                      {editingRole === role.id ? (
                        <RoleForm
                          data={data}
                          personId={person.id}
                          role={role}
                          onChanged={onChanged}
                          onDone={() => setEditingRole(null)}
                        />
                      ) : (
                        <>
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
                          <span className="mt-0.5 flex items-center gap-3 pl-5">
                            <button
                              type="button"
                              onClick={() => setEditingRole(role.id)}
                              className={linkBtn}
                              aria-label={`Change ${activity.name}`}
                            >
                              Change
                            </button>
                            <ConfirmRemove
                              what={activity.name}
                              short
                              disabled={busy}
                              onConfirm={() => void run(() => deleteRole(role.id))}
                            />
                          </span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </PanelFrame>
  );
}
