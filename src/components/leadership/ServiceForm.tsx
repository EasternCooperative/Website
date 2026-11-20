import { useState, type SyntheticEvent } from 'react';
import { createService, saveService } from './api';
import { ErrorNote, Field, inputCls, linkBtn, primaryBtn, useAction } from './forms';
import type { Data, Service } from './model';

const DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

interface Props {
  data: Data;
  personId: number;
  /** Set when changing a row that already exists. */
  service?: Service;
  onChanged: () => Promise<void>;
  onDone: () => void;
}

/** Add a board or committee term for a person, or change one. Dates can be a year, or a year and month. */
export default function ServiceForm({ data, personId, service, onChanged, onDone }: Props) {
  const [body, setBody] = useState(service?.body ?? '');
  const [title, setTitle] = useState(service?.title ?? '');
  const [started, setStarted] = useState(service?.started_on ?? '');
  const [ended, setEnded] = useState(service?.ended_on ?? '');
  const [note, setNote] = useState(service?.note ?? '');
  const { busy, error, run } = useAction(onChanged);

  const bodies = [...new Set(['Board of Directors', ...(data.service ?? []).map((s) => s.body)])].sort();
  const datesOk = [started, ended].every((d) => !d.trim() || DATE.test(d.trim()));
  const ready = body.trim() !== '' && datesOk;

  const onSubmit = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (!ready) return;
    const input = {
      person_id: personId,
      body: body.trim(),
      title: title.trim() || null,
      started_on: started.trim() || null,
      ended_on: ended.trim() || null,
      note: note.trim() || null,
      source: service?.source,
    };
    const { ok } = await run(async () => {
      if (service) await saveService(service.id, input);
      else await createService(input);
    });
    if (ok) onDone();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3" aria-label={service ? 'Change service' : 'Add service'}>
      <Field label="Board or committee">
        <input value={body} onChange={(e) => setBody(e.target.value)} list="service-bodies" className={inputCls} />
        <datalist id="service-bodies">
          {bodies.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
      </Field>
      <Field label="Role (optional)" hint="For example Chair, Co-chair, or Board Rep.">
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Started (optional)">
          <input
            value={started}
            onChange={(e) => setStarted(e.target.value)}
            placeholder="2024 or 2024-06"
            className={inputCls}
          />
        </Field>
        <Field label="Ended (optional)">
          <input
            value={ended}
            onChange={(e) => setEnded(e.target.value)}
            placeholder="2027 or 2027-12"
            className={inputCls}
          />
        </Field>
      </div>
      {!datesOk && (
        <p className="text-xs text-red-700 dark:text-red-300">Use a year, or a year and month, like 2024 or 2024-06.</p>
      )}
      <Field label="Note (optional)">
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
      </Field>
      <ErrorNote message={error} />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={!ready || busy} className={primaryBtn}>
          {service ? 'Save' : 'Add'}
        </button>
        <button type="button" onClick={onDone} className={linkBtn}>
          Cancel
        </button>
      </div>
    </form>
  );
}
