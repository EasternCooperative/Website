import { useEffect, useRef, useState } from 'react';
import { tabCls } from './forms';

export interface MenuItem {
  id: string;
  label: string;
}

/** A tab that opens a small menu of related views, for things most people never need. */
export default function AdminMenu({
  label,
  items,
  current,
  onSelect,
}: {
  label: string;
  items: MenuItem[];
  current: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const active = items.some((i) => i.id === current);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!(box.current as HTMLDivElement).contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(!open)}
        className={tabCls(active)}
      >
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul className="absolute right-0 z-20 mt-1 min-w-40 rounded-xl border border-gray-200 bg-page p-1 shadow-lg dark:border-gray-700">
          {items.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                aria-current={current === i.id ? 'page' : undefined}
                onClick={() => {
                  setOpen(false);
                  onSelect(i.id);
                }}
                className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-primary/10 aria-[current=page]:text-primary"
              >
                {i.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
