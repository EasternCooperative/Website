// Shared building blocks for the tracker's editors: the side panel frame, form
// controls, and the busy/error handling every save goes through.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from './api';
import { Icon } from './marks';

export const inputCls =
  'w-full rounded-lg border border-gray-300 bg-transparent px-2.5 py-1.5 text-sm dark:border-gray-600 focus-visible:outline-2 focus-visible:outline-primary';
// Buttons look like buttons: filled for the main action, outlined for the rest, and a
// link you can see is a link before it is hovered. Every one darkens or fills on hover.
export const primaryBtn =
  'rounded-full bg-(--aw-color-primary-strong) px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-[color-mix(in_srgb,var(--aw-color-primary-strong)_85%,black)] hover:shadow disabled:opacity-40 disabled:shadow-none';
export const secondaryBtn =
  'rounded-full border border-primary px-4 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-40 disabled:hover:bg-transparent';
export const linkBtn =
  'text-sm text-muted underline decoration-gray-400 underline-offset-2 hover:text-default hover:decoration-current disabled:opacity-40 dark:decoration-gray-500';
export const dangerLink =
  'text-sm text-muted underline decoration-gray-400 underline-offset-2 hover:text-red-700 hover:decoration-current dark:decoration-gray-500 dark:hover:text-red-300';
export const tabCls = (on: boolean) =>
  `-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm font-medium ${
    on
      ? 'border-primary text-primary'
      : 'border-transparent text-muted hover:border-gray-400 hover:bg-[color-mix(in_srgb,var(--aw-color-text-default)_6%,transparent)] hover:text-default'
  }`;
/** A faint wash that works on either theme. */
export const surface = 'bg-[color-mix(in_srgb,var(--aw-color-text-default)_6%,var(--aw-color-bg-page))]';
// Tailwind only sees whole class names, so the hover form is spelled out.
export const surfaceHover = 'hover:bg-[color-mix(in_srgb,var(--aw-color-text-default)_6%,var(--aw-color-bg-page))]';

/** Runs a save, then reloads. Tracks busy and the last error so every form reports failures the same way. */
export function useAction(onChanged: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(fn: () => Promise<T>): Promise<{ ok: boolean; value?: T }> => {
    setBusy(true);
    setError(null);
    try {
      const value = await fn();
      await onChanged();
      return { ok: true, value };
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
      return { ok: false };
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-200">
      {message}
    </p>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-700">
      <h3 className="font-heading text-heading mb-3 text-lg font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  // The hint sits outside the label, so it is not read out as part of the field's name.
  return (
    <div className="text-sm">
      <label className="block">
        <span className="mb-1 block text-muted">{label}</span>
        {children}
      </label>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </div>
  );
}

interface Option<T> {
  value: T;
  label: string;
  icon?: ReactNode;
}

/** One choice out of a few, as a row of radio buttons. */
export function Segmented<T extends string>({
  name,
  legend,
  value,
  options,
  onChange,
  tones = {},
}: {
  name: string;
  legend: string;
  value: T | '';
  options: Option<T>[];
  onChange: (v: T) => void;
  tones?: Partial<Record<T, string>>;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm text-muted">{legend}</legend>
      <div
        className="grid gap-1 rounded-lg border border-gray-300 p-1 dark:border-gray-600"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-center text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${
              value === o.value
                ? `font-medium ${tones[o.value] ?? 'bg-primary/10 text-primary'}`
                : 'text-muted hover:text-default'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.icon}
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The frame every detail panel shares: full screen on phones, a card beside the
 * list on desktop. Focus moves to the heading on open, and Escape closes it
 * unless the person is typing, so a half-written form is not lost.
 */
export function PanelFrame({
  label,
  title,
  meta,
  onClose,
  children,
}: {
  label: string;
  title: string;
  meta?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

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

  return (
    <aside
      aria-label={label}
      className="fixed inset-0 z-50 overflow-y-auto bg-page p-4 sm:p-5 lg:static lg:z-auto lg:max-h-[calc(100dvh-2rem)] lg:rounded-xl lg:border lg:border-gray-200 lg:dark:border-gray-700"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2
            ref={heading}
            tabIndex={-1}
            className="font-heading text-heading text-2xl font-bold leading-tight focus:outline-none"
          >
            {title}
          </h2>
          {meta}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={`-mr-1 rounded-full p-1.5 text-muted hover:text-default ${surfaceHover}`}
        >
          <Icon name="close" size={20} />
        </button>
      </div>
      {children}
    </aside>
  );
}

/** A list on the left and, once something is open, its panel on the right. */
export function Split({ open, list, panel }: { open: boolean; list: ReactNode; panel: ReactNode }) {
  return (
    <div className={open ? 'grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_26rem]' : ''}>
      {list}
      {open && <div className="lg:sticky lg:top-20">{panel}</div>}
    </div>
  );
}

/** Asks "Are you sure?" in place, so a stray click never removes anything. */
export function ConfirmRemove({
  what,
  onConfirm,
  disabled,
  blocked,
  short = false,
}: {
  what: string;
  onConfirm: () => void;
  disabled?: boolean;
  /** Why removal is not possible right now, shown instead of the button. */
  blocked?: string;
  /** For rows in a list: show just "Remove", and keep the full name for screen readers. */
  short?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  if (blocked) return <p className="text-xs text-muted">{blocked}</p>;
  if (!asking)
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        aria-label={short ? `Remove ${what}` : undefined}
        className={dangerLink}
      >
        {short ? 'Remove' : `Remove ${what}`}
      </button>
    );
  return (
    <span role="group" aria-label={`Remove ${what}?`} className="inline-flex flex-wrap items-center gap-x-3 text-sm">
      <span>{short ? 'Remove?' : `Remove ${what}?`}</span>
      <button
        type="button"
        onClick={onConfirm}
        disabled={disabled}
        className="font-medium text-red-700 hover:underline disabled:opacity-40 dark:text-red-300"
      >
        Yes, remove
      </button>
      <button type="button" onClick={() => setAsking(false)} className={linkBtn}>
        Keep
      </button>
    </span>
  );
}
