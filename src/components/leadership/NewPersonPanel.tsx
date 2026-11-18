import { useState, type SyntheticEvent } from 'react';
import { createPerson } from './api';
import { ErrorNote, Field, PanelFrame, Segmented, inputCls, linkBtn, primaryBtn, useAction } from './forms';
import { Icon } from './marks';
import { STATUSES, STATUS_LABELS, type Data, type Status } from './model';

interface Props {
  data: Data;
  onChanged: () => Promise<void>;
  /** Called with the new person's id once saved and reloaded. */
  onCreated: (id: number) => void;
  onClose: () => void;
}

/** Adds someone who has never been on the list. Roles come after, from their own panel. */
export default function NewPersonPanel({ data, onChanged, onCreated, onClose }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('active');
  const [mentor, setMentor] = useState(false);
  const { busy, error, run } = useAction(onChanged);

  const trimmed = name.trim();
  const twin = trimmed && data.people.find((p) => p.name.toLowerCase() === trimmed.toLowerCase());

  const onSubmit = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (!trimmed) return;
    const { ok, value } = await run(() =>
      createPerson({ name: trimmed, email: email.trim() || null, status, mentor, notes: null })
    );
    if (ok && value) onCreated(value.id);
  };

  return (
    <PanelFrame label="Add a person" title="Add a person" onClose={onClose}>
      <form onSubmit={onSubmit} className="mt-4 space-y-3">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>
        {twin && (
          <p role="status" className="text-sm text-amber-800 dark:text-amber-200">
            {twin.name} is already on the list. Add another only if they are a different person.
          </p>
        )}
        <Field label="Email (optional)">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </Field>
        <Segmented
          name="new-status"
          legend="Leading"
          value={status}
          options={STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
          onChange={setStatus}
        />
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={mentor} onChange={(e) => setMentor(e.target.checked)} />
          <Icon name="mentor" size={16} className="text-sky-700 dark:text-sky-300" />
          Available as a mentor
        </label>
        <ErrorNote message={error} />
        <div className="flex items-center gap-3">
          <button type="submit" disabled={!trimmed || busy} className={primaryBtn}>
            Add person
          </button>
          <button type="button" onClick={onClose} className={linkBtn}>
            Cancel
          </button>
        </div>
      </form>
    </PanelFrame>
  );
}
