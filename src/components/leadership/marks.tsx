// The tracker's visual vocabulary. A role's mark shows how much of the class was
// on that person: a full disc for solo, half for partner, a ring for assisting.
// Shape carries the meaning, so it reads without color and in either theme.

import type { ReactNode } from 'react';
import {
  LEADERSHIP_TYPES,
  ROLE_LABELS,
  STATUS_LABELS,
  describeCounts,
  type Counts,
  type LeadershipType,
  type Person,
} from './model';

export function RoleMark({ type, className = '' }: { type: LeadershipType; className?: string }) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" className={`shrink-0 text-primary ${className}`}>
      {type === 'solo' && <circle cx="6" cy="6" r="5" fill="currentColor" />}
      {type === 'partner' && (
        <>
          <circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M6 1a5 5 0 0 0 0 10z" fill="currentColor" />
        </>
      )}
      {type === 'assisting' && <circle cx="6" cy="6" r="4.3" fill="none" stroke="currentColor" strokeWidth="1.4" />}
    </svg>
  );
}

/** Mark and count for each role that has any, e.g. ●9 ◐3. */
export function RoleCounts({ counts, className = '' }: { counts: Counts; className?: string }) {
  const present = LEADERSHIP_TYPES.filter((t) => counts[t] > 0);
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums ${className}`}>
      <span className="sr-only">{describeCounts(counts)}</span>
      {present.map((t) => (
        <span key={t} aria-hidden="true" className="inline-flex items-center gap-0.5">
          <RoleMark type={t} />
          {counts[t]}
        </span>
      ))}
    </span>
  );
}

const MEANING: Record<LeadershipType, string> = {
  solo: 'led alone',
  partner: 'co-led',
  assisting: 'helped a leader',
};

export function Legend() {
  return (
    <ul aria-label="Key" className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
      {LEADERSHIP_TYPES.map((t) => (
        <li key={t} className="inline-flex items-center gap-1.5">
          <RoleMark type={t} />
          <span>
            <span className="text-default font-medium">{ROLE_LABELS[t]}</span> {MEANING[t]}
          </span>
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="inline-flex">
          <span className="h-3 w-2.5 bg-primary/10" />
          <span className="h-3 w-2.5 bg-primary/20" />
          <span className="h-3 w-2.5 bg-primary/35" />
        </span>
        Deeper shade, more roles of that kind
      </li>
    </ul>
  );
}

// Tabler icons (MIT), inlined so the island needs no icon runtime.
const ICONS = {
  mentor: 'M22 9L12 5L2 9l10 4zv6M6 10.6V16a6 3 0 0 0 12 0v-5.4',
  hiatus:
    'M6 6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1zm8 0a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1z',
  inactive: 'M12 3h.393a7.5 7.5 0 0 0 7.92 12.446A9 9 0 1 1 12 2.992z',
  close: 'M18 6L6 18M6 6l12 12',
  search: 'M3 10a7 7 0 1 0 14 0a7 7 0 1 0-14 0m18 11l-6-6',
  ready: 'M5 5a5 5 0 0 1 7 0a5 5 0 0 0 7 0v9a5 5 0 0 1-7 0a5 5 0 0 0-7 0zm0 16v-7',
  up: 'M12 5v14m6-8l-6-6m-6 6l6-6',
  down: 'M12 5v14m6-6l-6 6m-6-6l6 6',
  sortable: 'm3 9l4-4l4 4M7 5v14m14-4l-4 4l-4-4m4 4V5',
  check: 'm5 12l5 5L20 7',
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

/** Small labeled tag. Word and icon both say it, so color is only a hint. */
function Tag({ icon, tone, children }: { icon: IconName; tone: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-xs font-medium ${tone}`}>
      <Icon name={icon} size={12} />
      {children}
    </span>
  );
}

export const TONES = {
  hiatus: 'bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200',
  inactive: 'bg-gray-200/70 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300',
  mentor: 'bg-sky-100 text-sky-900 dark:bg-sky-400/15 dark:text-sky-200',
} as const;

/** Status tags for a person. Active is the norm, so it gets none. Pass showStatus={false} where status means nothing, such as people who have never led. */
export function PersonTags({ person, showStatus = true }: { person: Person; showStatus?: boolean }) {
  return (
    <>
      {showStatus && person.status !== 'active' && (
        <Tag icon={person.status} tone={TONES[person.status]}>
          {STATUS_LABELS[person.status]}
        </Tag>
      )}
      {person.mentor === 1 && (
        <Tag icon="mentor" tone={TONES.mentor}>
          Mentor
        </Tag>
      )}
    </>
  );
}
