import { useState, type SyntheticEvent } from 'react';
import { ApiError, createActivity, deleteActivity, saveActivity } from './api';
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
import { Icon } from './marks';
import { groupActivities, type Activity, type Data, type Scope } from './model';

interface Props {
  data: Data;
  onChanged: () => Promise<void>;
}

const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: 'class', label: 'Class' },
  { value: 'activity', label: 'Activity' },
];

function ActivityPanel({
  data,
  activity,
  onChanged,
  onSaved,
  onClose,
}: {
  data: Data;
  activity: Activity | undefined;
  onChanged: () => Promise<void>;
  onSaved: (id: number) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(activity?.name ?? '');
  const [scope, setScope] = useState<Scope | ''>(activity?.scope ?? '');
  const [type, setType] = useState(activity?.type ?? '');
  const [subtype, setSubtype] = useState(activity?.subtype ?? '');
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction(onChanged);

  const roles = activity ? data.roles.filter((r) => r.activity_id === activity.id).length : 0;
  const trimmedType = type.trim();
  const subtypes = [
    ...new Set(data.activities.filter((a) => a.type === trimmedType && a.subtype).map((a) => a.subtype as string)),
  ].sort();
  const isNewType = trimmedType !== '' && !data.activityTypes.includes(trimmedType);
  const ready = name.trim() !== '' && scope !== '' && trimmedType !== '';
  const dirty =
    !activity ||
    name.trim() !== activity.name ||
    scope !== activity.scope ||
    trimmedType !== activity.type ||
    subtype.trim() !== (activity.subtype ?? '');

  const onSubmit = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (!ready) return;
    const input = {
      name: name.trim(),
      scope,
      type: trimmedType,
      subtype: subtype.trim() || null,
      site_activity_id: activity?.site_activity_id,
    };
    const { ok, value } = await run(async () => {
      try {
        return activity ? (await saveActivity(activity.id, input), activity.id) : (await createActivity(input)).id;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          throw new ApiError('A class or activity with that name already exists.', 409);
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
    <PanelFrame
      label={activity ? `${activity.name} details` : 'Add an activity'}
      title={activity ? activity.name : 'Add an activity'}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          setSaved(false);
          return onSubmit(e);
        }}
        className="mt-4 space-y-3"
      >
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>
        <div>
          <Segmented name="scope" legend="Kind" value={scope} options={SCOPE_OPTIONS} onChange={setScope} />
          <p className="mt-1 text-xs text-muted">
            A class is a whole session. An activity is one game, dance, or song.
          </p>
        </div>
        <Field
          label="Type"
          hint={
            isNewType ? 'A new type. It becomes a column in the People table.' : 'Drama, Games, Dancing, and so on.'
          }
        >
          <input value={type} onChange={(e) => setType(e.target.value)} list="activity-types" className={inputCls} />
          <datalist id="activity-types">
            {data.activityTypes.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
        <Field label="Subtype (optional)">
          <input
            value={subtype}
            onChange={(e) => setSubtype(e.target.value)}
            list="activity-subtypes"
            className={inputCls}
          />
          <datalist id="activity-subtypes">
            {subtypes.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
        <ErrorNote message={error} />
        <div className="flex items-center gap-3">
          <button type="submit" disabled={!ready || !dirty || busy} className={primaryBtn}>
            {activity ? 'Save' : 'Add activity'}
          </button>
          {activity && saved && !dirty && (
            <span role="status" className="text-sm text-muted">
              Saved
            </span>
          )}
          {!activity && (
            <button type="button" onClick={onClose} className={linkBtn}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {activity && (
        <Section title="Remove">
          <ConfirmRemove
            what={activity.name}
            disabled={busy}
            blocked={
              roles ? `Used in ${roles} ${roles === 1 ? 'role' : 'roles'}. Remove those roles first.` : undefined
            }
            onConfirm={async () => {
              if ((await run(() => deleteActivity(activity.id))).ok) onClose();
            }}
          />
        </Section>
      )}
    </PanelFrame>
  );
}

export default function ActivitiesView({ data, onChanged }: Props) {
  const [sel, setSel] = useState<number | 'new' | null>(null);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = data.activities.filter(
    (a) => !q || [a.name, a.type, a.subtype ?? ''].some((s) => s.toLowerCase().includes(q))
  );
  const groups = groupActivities(shown);
  const used = new Map<number, number>();
  for (const r of data.roles) used.set(r.activity_id, (used.get(r.activity_id) ?? 0) + 1);
  const selected = typeof sel === 'number' ? data.activities.find((a) => a.id === sel) : undefined;

  return (
    <Split
      open={sel === 'new' || selected !== undefined}
      list={
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="relative">
                <span className="sr-only">Find a class or activity</span>
                <Icon
                  name="search"
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
                />
                <input
                  type="search"
                  placeholder="Find a class or activity"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-64 rounded-full border border-gray-300 bg-transparent py-1.5 pl-8 pr-3 text-sm dark:border-gray-600"
                />
              </label>
              <p className="text-sm text-muted" aria-live="polite">
                {q
                  ? `Showing ${shown.length} of ${data.activities.length}`
                  : `${data.activities.length} ${data.activities.length === 1 ? 'class or activity' : 'classes and activities'} in ${groups.length} ${groups.length === 1 ? 'type' : 'types'}`}
              </p>
            </div>
            <button type="button" onClick={() => setSel('new')} className={secondaryBtn}>
              Add an activity
            </button>
          </div>
          {groups.length === 0 && (
            <p className="rounded-xl border border-gray-200 px-3 py-8 text-center text-muted dark:border-gray-700">
              {q ? 'No class or activity matches.' : 'No activities yet. Add one to start recording roles.'}
            </p>
          )}
          <div className="space-y-5">
            {groups.map((g) => (
              <section key={g.type} aria-labelledby={`type-${g.type}`}>
                <h3 id={`type-${g.type}`} className="font-heading text-heading mb-1 text-lg font-semibold">
                  {g.type}
                </h3>
                <ul className="divide-y divide-gray-200 rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
                  {g.activities.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => setSel(a.id)}
                        aria-pressed={sel === a.id}
                        className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm ${surfaceHover} ${
                          sel === a.id ? 'bg-primary/10' : ''
                        }`}
                      >
                        <span>
                          <span className="font-medium">{a.name}</span>{' '}
                          <span className="text-muted">
                            {a.scope === 'class' ? 'Class' : 'Activity'}
                            {a.subtype ? `, ${a.subtype}` : ''}
                          </span>
                        </span>
                        <span className="whitespace-nowrap text-xs text-muted tabular-nums">
                          {used.get(a.id) ?? 0} {used.get(a.id) === 1 ? 'role' : 'roles'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      }
      panel={
        <ActivityPanel
          key={sel ?? 'none'}
          data={data}
          activity={selected}
          onChanged={onChanged}
          onSaved={(id) => setSel(id)}
          onClose={() => setSel(null)}
        />
      }
    />
  );
}
