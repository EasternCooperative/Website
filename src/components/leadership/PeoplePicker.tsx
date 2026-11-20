import { useState } from 'react';
import { inputCls, surfaceHover } from './forms';
import type { Person } from './model';

/** Tick several people from the list, with a box to find them by name. */
export default function PeoplePicker({
  people,
  picked,
  onChange,
}: {
  people: Person[];
  picked: number[];
  onChange: (ids: number[]) => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = people
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
  const toggle = (id: number) => onChange(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  return (
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
        {shown.map((p) => (
          <li key={p.id}>
            <label className={`flex cursor-pointer items-center gap-2 px-2.5 py-1 text-sm ${surfaceHover}`}>
              <input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} />
              {p.name}
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="px-2.5 py-2 text-sm text-muted">No one matches.</li>}
      </ul>
    </fieldset>
  );
}
