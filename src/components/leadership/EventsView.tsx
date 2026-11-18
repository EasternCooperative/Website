import { useState, type SyntheticEvent } from 'react';
import { ApiError, addRoles, createEvent, deleteEvent, deleteRole, saveEvent } from './api';
import {
  ConfirmRemove,
  ErrorNote,
  Field,
  PanelFrame,
  Section,
  Segmented,
  Split,
  inputCls,
  linkBtn,
  primaryBtn,
  secondaryBtn,
  surfaceHover,
  useAction,
} from './forms';
import { RoleMark } from './marks';
import { ActivityOptions, ROLE_OPTIONS, activityLabel } from './RoleForm';
import {
  EVENT_TYPES,
  EVENT_TYPE_LABELS,
  ROLE_LABELS,
  eventTitle,
  sortedEvents,
  type Data,
  type EventRow,
  type EventType,
  type LeadershipType,
  type View,
} from './model';

interface Props {
  data: Data;
  onChanged: () => Promise<void>;
  goTo: (view: View) => void;
}

const TYPE_OPTIONS = EVENT_TYPES.map((t) => ({ value: t, label: EVENT_TYPE_LABELS[t] }));
const thisYear = () => new Date().getFullYear();

function Details({
  event,
  onChanged,
  onSaved,
  onClose,
}: {
  event: EventRow | undefined;
  onChanged: () => Promise<void>;
  onSaved: (id: number) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(event?.name ?? '');
  const [type, setType] = useState<EventType | ''>((event?.event_type as EventType) ?? '');
  const [year, setYear] = useState(String(event?.year ?? thisYear()));
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction(onChanged);

  const yearNum = Number(year);
  const ready = name.trim() !== '' && type !== '' && Number.isInteger(yearNum) && yearNum >= 1970 && yearNum <= 2100;
  const dirty = !event || name.trim() !== event.name || type !== event.event_type || yearNum !== event.year;

  const onSubmit = async (e: SyntheticEvent) => {
    e.preventDefault();
    setSaved(false);
    if (!ready) return;
    const input = { name: name.trim(), event_type: type, year: yearNum, site_event_id: event?.site_event_id };
    const { ok, value } = await run(async () => {
      try {
        return event ? (await saveEvent(event.id, input), event.id) : (await createEvent(input)).id;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          throw new ApiError('An event with that name and year already exists.', 409);
        }
        throw err;
      }
    });
    if (ok && value !== undefined) {
      setSaved(true);
      onSaved(value);
    }
  };

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3">
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Year">
        <input
          type="number"
          inputMode="numeric"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          className={`${inputCls} max-w-28`}
        />
      </Field>
      <Segmented name="event-type" legend="Kind of event" value={type} options={TYPE_OPTIONS} onChange={setType} />
      <ErrorNote message={error} />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={!ready || !dirty || busy} className={primaryBtn}>
          {event ? 'Save' : 'Add event'}
        </button>
        {event && saved && !dirty && (
          <span role="status" className="text-sm text-muted">
            Saved
          </span>
        )}
        {!event && (
          <button type="button" onClick={onClose} className={linkBtn}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/** Adds one activity's roles for several people at once: the quick way to backfill an event. */
function AddRoles({
  data,
  event,
  onChanged,
  goTo,
}: {
  data: Data;
  event: EventRow;
  onChanged: () => Promise<void>;
  goTo: (view: View) => void;
}) {
  const [activityId, setActivityId] = useState('');
  const [type, setType] = useState<LeadershipType | ''>('');
  const [picked, setPicked] = useState<number[]>([]);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const { busy, error, run } = useAction(onChanged);

  if (data.activities.length === 0 || data.people.length === 0) {
    return (
      <p className="text-sm text-muted">
        {data.people.length === 0 ? 'Add a person' : 'Add an activity'} before recording roles.{' '}
        <button
          type="button"
          className="text-primary underline"
          onClick={() => goTo(data.people.length === 0 ? 'people' : 'activities')}
        >
          Go to {data.people.length === 0 ? 'People' : 'Activities'}
        </button>
      </p>
    );
  }

  const q = query.trim().toLowerCase();
  const people = [...data.people]
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
  const ready = activityId !== '' && type !== '' && picked.length > 0;
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const onSubmit = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (!ready) return;
    const rows = picked.map((person_id) => ({
      person_id,
      activity_id: Number(activityId),
      event_id: event.id,
      leadership_type: type,
      how_it_went: null,
    }));
    const { ok, value } = await run(() => addRoles(rows));
    if (ok && value) {
      const skipped = rows.length - value.added;
      setResult(
        `Added ${value.added} ${value.added === 1 ? 'role' : 'roles'}.` +
          (skipped ? ` ${skipped} ${skipped === 1 ? 'was' : 'were'} already recorded.` : '')
      );
      setPicked([]);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3" aria-label="Add roles">
      <Field label="Activity or class">
        <select value={activityId} onChange={(e) => setActivityId(e.target.value)} className={inputCls}>
          <option value="">Choose one</option>
          <ActivityOptions activities={data.activities} />
        </select>
      </Field>
      <Segmented name="bulk-role" legend="Role" value={type} options={ROLE_OPTIONS} onChange={setType} />
      <fieldset>
        <legend className="mb-1 text-sm text-muted">People</legend>
        <input
          type="search"
          aria-label="Find a person to add"
          placeholder="Find a person"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`${inputCls} mb-1.5`}
        />
        <ul className="max-h-48 overflow-y-auto rounded-lg border border-gray-300 dark:border-gray-600">
          {people.map((p) => (
            <li key={p.id}>
              <label className={`flex cursor-pointer items-center gap-2 px-2.5 py-1 text-sm ${surfaceHover}`}>
                <input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} />
                {p.name}
              </label>
            </li>
          ))}
          {people.length === 0 && <li className="px-2.5 py-2 text-sm text-muted">No one matches.</li>}
        </ul>
      </fieldset>
      <ErrorNote message={error} />
      {result && (
        <p role="status" className="text-sm text-muted">
          {result}
        </p>
      )}
      <button type="submit" disabled={!ready || busy} className={primaryBtn}>
        {picked.length > 1 ? `Add ${picked.length} roles` : 'Add role'}
      </button>
    </form>
  );
}

function EventPanel({
  data,
  event,
  onChanged,
  onSaved,
  onClose,
  goTo,
}: {
  data: Data;
  event: EventRow | undefined;
  onChanged: () => Promise<void>;
  onSaved: (id: number) => void;
  onClose: () => void;
  goTo: (view: View) => void;
}) {
  const remove = useAction(onChanged);
  const people = new Map(data.people.map((p) => [p.id, p]));
  const activities = new Map(data.activities.map((a) => [a.id, a]));
  const roles = event
    ? data.roles.filter((r) => r.event_id === event.id && people.has(r.person_id) && activities.has(r.activity_id))
    : [];
  const byActivity = [...new Set(roles.map((r) => r.activity_id))]
    .map((id) => activities.get(id)!)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <PanelFrame
      label={event ? `${eventTitle(event)} details` : 'Add an event'}
      title={event ? eventTitle(event) : 'Add an event'}
      onClose={onClose}
    >
      <Details key={event?.id ?? 'new'} event={event} onChanged={onChanged} onSaved={onSaved} onClose={onClose} />

      {event && (
        <>
          <Section title="Add roles">
            <AddRoles data={data} event={event} onChanged={onChanged} goTo={goTo} />
          </Section>

          <Section title="Roles at this event">
            {byActivity.length === 0 ? (
              <p className="text-sm text-muted">No roles recorded yet.</p>
            ) : (
              <ul className="space-y-3">
                {byActivity.map((a) => (
                  <li key={a.id}>
                    <h4 className="mb-1 text-sm font-semibold">{activityLabel(a)}</h4>
                    <ul className="space-y-1 border-l border-gray-200 pl-3 dark:border-gray-700">
                      {roles
                        .filter((r) => r.activity_id === a.id)
                        .map((r) => (
                          <li
                            key={r.id}
                            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-sm"
                          >
                            <span className="flex items-center gap-2">
                              <RoleMark type={r.leadership_type} />
                              {people.get(r.person_id)!.name}
                              <span className="text-muted">{ROLE_LABELS[r.leadership_type]}</span>
                            </span>
                            <ConfirmRemove
                              what={`${people.get(r.person_id)!.name} from ${a.name}`}
                              short
                              disabled={remove.busy}
                              onConfirm={() => void remove.run(() => deleteRole(r.id))}
                            />
                          </li>
                        ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
            <ErrorNote message={remove.error} />
          </Section>

          <Section title="Remove">
            <ConfirmRemove
              what={eventTitle(event)}
              disabled={remove.busy}
              blocked={
                roles.length
                  ? `Has ${roles.length} ${roles.length === 1 ? 'role' : 'roles'}. Remove them first.`
                  : undefined
              }
              onConfirm={async () => {
                if ((await remove.run(() => deleteEvent(event.id))).ok) onClose();
              }}
            />
          </Section>
        </>
      )}
    </PanelFrame>
  );
}

export default function EventsView({ data, onChanged, goTo }: Props) {
  const [sel, setSel] = useState<number | 'new' | null>(null);
  const events = sortedEvents(data.events);
  const selected = typeof sel === 'number' ? data.events.find((e) => e.id === sel) : undefined;
  const stats = new Map<number, { roles: number; people: Set<number> }>();
  for (const r of data.roles) {
    const s = stats.get(r.event_id) ?? { roles: 0, people: new Set<number>() };
    s.roles += 1;
    s.people.add(r.person_id);
    stats.set(r.event_id, s);
  }

  return (
    <Split
      open={sel === 'new' || selected !== undefined}
      list={
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {events.length} {events.length === 1 ? 'event' : 'events'}
            </p>
            <button type="button" onClick={() => setSel('new')} className={secondaryBtn}>
              Add an event
            </button>
          </div>
          {events.length === 0 ? (
            <p className="rounded-xl border border-gray-200 px-3 py-8 text-center text-muted dark:border-gray-700">
              No events yet. Add one to start recording roles.
            </p>
          ) : (
            <ul className="divide-y divide-gray-200 rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
              {events.map((e) => {
                const s = stats.get(e.id);
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => setSel(e.id)}
                      aria-pressed={sel === e.id}
                      className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm ${surfaceHover} ${
                        sel === e.id ? 'bg-primary/10' : ''
                      }`}
                    >
                      <span>
                        <span className="font-medium">{eventTitle(e)}</span>{' '}
                        <span className="text-muted">
                          {EVENT_TYPE_LABELS[e.event_type as EventType] ?? e.event_type}
                        </span>
                      </span>
                      <span className="whitespace-nowrap text-xs text-muted tabular-nums">
                        {s
                          ? `${s.roles} ${s.roles === 1 ? 'role' : 'roles'}, ${s.people.size} ${s.people.size === 1 ? 'person' : 'people'}`
                          : 'No roles'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      }
      panel={
        <EventPanel
          key={sel ?? 'none'}
          data={data}
          event={selected}
          onChanged={onChanged}
          onSaved={(id) => setSel(id)}
          onClose={() => setSel(null)}
          goTo={goTo}
        />
      }
    />
  );
}
