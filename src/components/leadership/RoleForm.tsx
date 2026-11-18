import { useState, type SyntheticEvent } from 'react';
import { ApiError, createRole, saveRole } from './api';
import { ErrorNote, Field, Segmented, inputCls, linkBtn, primaryBtn, useAction } from './forms';
import { RoleMark } from './marks';
import {
  LEADERSHIP_TYPES,
  ROLE_LABELS,
  eventTitle,
  groupActivities,
  sortedEvents,
  type Activity,
  type Data,
  type LeadershipType,
  type Role,
  type View,
} from './model';

/** "Games Class (class)", "Tag (Active)", "Cards (class, Paper)": kind and subtype in one note. */
export const activityLabel = (a: Activity) => {
  const notes = [a.scope === 'class' ? 'class' : null, a.subtype].filter(Boolean);
  return notes.length ? `${a.name} (${notes.join(', ')})` : a.name;
};

export const ROLE_OPTIONS = LEADERSHIP_TYPES.map((t) => ({
  value: t,
  label: ROLE_LABELS[t],
  icon: <RoleMark type={t} />,
}));

/** Activities grouped by type, for a select. */
export function ActivityOptions({ activities }: { activities: Activity[] }) {
  return (
    <>
      {groupActivities(activities).map((g) => (
        <optgroup key={g.type} label={g.type}>
          {g.activities.map((a) => (
            <option key={a.id} value={a.id}>
              {activityLabel(a)}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

interface Props {
  data: Data;
  personId: number;
  /** Set when editing a role that already exists. */
  role?: Role;
  onChanged: () => Promise<void>;
  onDone: () => void;
  goTo?: (view: View) => void;
}

/** Add a role for a person, or change one they already have. */
export default function RoleForm({ data, personId, role, onChanged, onDone, goTo }: Props) {
  const events = sortedEvents(data.events);
  const [eventId, setEventId] = useState(String(role?.event_id ?? events[0]?.id ?? ''));
  const [activityId, setActivityId] = useState(String(role?.activity_id ?? ''));
  const [type, setType] = useState<LeadershipType | ''>(role?.leadership_type ?? '');
  const [how, setHow] = useState(role?.how_it_went ?? '');
  const { busy, error, run } = useAction(onChanged);

  if (events.length === 0 || data.activities.length === 0) {
    const missing = events.length === 0 ? 'an event' : 'an activity';
    return (
      <p className="text-sm text-muted">
        Add {missing} before recording a role.{' '}
        {goTo && (
          <button
            type="button"
            className="text-primary underline"
            onClick={() => goTo(events.length === 0 ? 'events' : 'activities')}
          >
            Go to {events.length === 0 ? 'Events' : 'Activities'}
          </button>
        )}
      </p>
    );
  }

  const ready = eventId !== '' && activityId !== '' && type !== '';
  const onSubmit = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (!ready) return;
    const body = {
      person_id: personId,
      activity_id: Number(activityId),
      event_id: Number(eventId),
      leadership_type: type,
      how_it_went: how.trim() || null,
    };
    const { ok } = await run(async () => {
      try {
        if (role) await saveRole(role.id, { ...body, source: role.source });
        else await createRole(body);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          throw new ApiError('That activity is already recorded for this person at this event.', 409);
        }
        throw err;
      }
    });
    if (ok) {
      setActivityId('');
      setType('');
      setHow('');
      onDone();
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3" aria-label={role ? 'Change role' : 'Add a role'}>
      <Field label="Event">
        <select value={eventId} onChange={(e) => setEventId(e.target.value)} className={inputCls}>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {eventTitle(ev)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Activity or class">
        <select value={activityId} onChange={(e) => setActivityId(e.target.value)} className={inputCls}>
          <option value="">Choose one</option>
          <ActivityOptions activities={data.activities} />
        </select>
      </Field>
      <Segmented
        name={`role-type-${role?.id ?? 'new'}`}
        legend="Role"
        value={type}
        options={ROLE_OPTIONS}
        onChange={setType}
      />
      <Field label="How it went (optional)">
        <textarea rows={2} value={how} onChange={(e) => setHow(e.target.value)} className={inputCls} />
      </Field>
      <ErrorNote message={error} />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={!ready || busy} className={primaryBtn}>
          {role ? 'Save role' : 'Add role'}
        </button>
        <button type="button" onClick={onDone} className={linkBtn}>
          Cancel
        </button>
      </div>
    </form>
  );
}
